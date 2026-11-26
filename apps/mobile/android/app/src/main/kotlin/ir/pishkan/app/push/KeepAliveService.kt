package ir.pishkan.app.push

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import android.util.Log
import androidx.core.app.NotificationCompat
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedReader
import java.io.IOException
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.URL
import java.nio.charset.StandardCharsets
import kotlin.concurrent.thread

/**
 * The fourth way to reach the notification shade: our own open connection.
 *
 * ## Why this exists
 *
 * Each of the three existing paths has a hole you can fall through:
 *  * FCM needs Google Play Services, a Firebase project and a working network
 *    path to Google — a phone without them, or an office on a LAN, has nothing;
 *  * the background check is at the mercy of Doze and the vendor's battery
 *    manager, which is why a case update can sit for an hour;
 *  * the in-app poll is instant, but only while the app is up.
 *
 * A service holding a socket, with the ongoing notification Android requires for
 * exactly that, closes the gap without a third party: the message arrives the
 * second the office saves it, while the customer is in another app.
 *
 * ## What it does not pretend to be
 *
 * Not a replacement for FCM. If the OS kills the process — force stop, a vendor
 * cleaner, a reboot — the service dies with it, because nothing here persists a
 * credential that would let it authenticate unsupervised. Dart re-arms it on the
 * next start, and the other two paths cover the interval. That is why the ongoing
 * notification says "connected" and never "delivered": the honest claim is that
 * we are not waiting for a poll.
 *
 * ## Why it stays quiet while the app is in the foreground
 *
 * The shell already pulls the feed every thirty seconds there and raises in-app
 * banners, so a tray item on top of that would be the same notice twice. Events
 * arriving in that mode are ignored here, and going to the background reopens the
 * connection — which makes the server replay everything still unconfirmed. Staying
 * quiet therefore costs nothing but ordering.
 *
 * ## Threads
 *
 * One reader thread, one socket, guarded by [running]. `HttpURLConnection` blocks,
 * so the work cannot live on the main thread; and because the shared state is all
 * `@Volatile` there is no lock to order and nothing to deadlock against the UI.
 */
class KeepAliveService : Service() {

    @Volatile private var running = false
    @Volatile private var stream: HttpURLConnection? = null

    /** Held in memory only — see [companion] for why they are never persisted. */
    @Volatile private var baseUrl: String = ""
    @Volatile private var token: String = ""

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        ensureChannel()
    }

    /**
     * Called on every arm: first start, re-login, and each return to the
     * background. An intent without credentials — a system-initiated restart after
     * the process was killed — stops the service instead of retrying, because the
     * only way to authenticate is a token the app holds.
     */
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val nextBase = intent?.getStringExtra(EXTRA_BASE_URL).orEmpty()
        val nextToken = intent?.getStringExtra(EXTRA_TOKEN).orEmpty()
        if (nextBase.isEmpty() || nextToken.isEmpty()) {
            stopSelf()
            return START_NOT_STICKY
        }
        baseUrl = nextBase.trimEnd('/')
        token = nextToken
        if (!running) {
            running = true
            startForegroundCompat(ongoingNotification())
            thread(name = "pishkan-keepalive", isDaemon = true) { loop() }
        } else {
            // Already connected with the same credentials: drop the socket so the
            // reader reconnects and the server replays what it owes us. This is
            // the line that makes "it happened while I was in the app" impossible.
            dropSocket()
        }
        return START_STICKY
    }

    override fun onDestroy() {
        running = false
        dropSocket()
        super.onDestroy()
    }

    private fun loop() {
        var backoffSec = BACKOFF_MIN_SEC
        while (running) {
            var sawActivity = false
            try {
                sawActivity = readStream()
            } catch (_: Exception) {
                // Every failure is a reconnect: wifi dropped, the server
                // restarted, a proxy closed an idle socket. Waiting briefly and
                // trying again is the whole recovery, because connecting replays
                // unconfirmed notices — a missed event costs latency, never loss.
            }
            backoffSec = if (sawActivity) BACKOFF_MIN_SEC else (backoffSec * 2).coerceAtMost(BACKOFF_MAX_SEC)
            try {
                Thread.sleep(backoffSec * 1000L)
            } catch (_: InterruptedException) {
                return
            }
        }
    }

    /** @return true when this connection carried a notice, to reset the backoff. */
    private fun readStream(): Boolean {
        var activity = false
        val connection = (URL("$baseUrl/api/notifications/stream").openConnection() as HttpURLConnection).apply {
            requestMethod = "GET"
            setRequestProperty("Accept", "text/event-stream")
            setRequestProperty("Authorization", "Bearer $token")
            connectTimeout = 15_000
            // The server comments a heartbeat every 25 seconds, so three silent
            // ones mean the socket is gone even though nothing has errored.
            readTimeout = 90_000
        }
        stream = connection
        try {
            val code = connection.responseCode
            if (code == 401 || code == 403) {
                // Signed out, or the token rotated. Retrying a dead credential
                // would wake the phone forever for nothing; Dart re-arms after
                // the next sign-in.
                Log.i(TAG, "stream refused ($code); keep-alive disarmed")
                stopSelf()
                return activity
            }
            if (code == 503) {
                // The office switched the live channel off (`push.live_enabled`).
                // Retrying a door that is deliberately shut would burn battery for
                // a year and change nothing, so disarm and let Dart's setting
                // decide whether to arm it again.
                Log.i(TAG, "live stream disabled by the office (503); keep-alive disarmed")
                stopSelf()
                return activity
            }
            if (code != 200) throw IOException("stream status $code")
            var event = ""
            BufferedReader(InputStreamReader(connection.inputStream, StandardCharsets.UTF_8)).use { reader ->
                while (running) {
                    val line = reader.readLine() ?: break
                    when {
                        line.startsWith("event:") -> event = line.substring(6).trim()
                        line.startsWith("data:") -> if (event == EVENT_NOTIFICATION) {
                            activity = true
                            onNotification(line.substring(5).trim())
                        }
                        line.startsWith(":") -> Unit // heartbeat
                        line.isEmpty() -> event = ""
                    }
                }
            }
        } finally {
            if (stream === connection) stream = null
            try {
                connection.disconnect()
            } catch (_: Exception) {
            }
        }
        return activity
    }

    /**
     * Render one frame of the live stream.
     *
     * [PushRenderer] is reused rather than duplicated: a case update has to look
     * the same — channel, icon, colour, tap target — whichever road it came down,
     * and that renderer is what owns those choices. Its return value is the notice
     * it *actually posted*, and only that is acknowledged, so a tray the owner has
     * switched off never counts as delivered.
     */
    private fun onNotification(json: String) {
        if (KeepAliveState.quietWhileForeground) return
        try {
            val payload = JSONObject(json)
            val notificationId = payload.optString("id")
            if (notificationId.isEmpty()) return
            val shown = PushRenderer.show(
                this,
                mapOf(
                    "title" to payload.optString("title"),
                    "body" to payload.optString("body"),
                    "link" to payload.optString("link"),
                    "kind" to payload.optString("kind"),
                    "notificationId" to notificationId,
                    // The server's collapse tag (`dedupe_key`), so a notice that
                    // also arrives over FCM replaces this one instead of standing
                    // beside it as a second copy of the same event.
                    "tag" to payload.optString("tag", notificationId),
                ),
                soundsEnabled = PushPreferences.soundsEnabled(this),
            )
            if (shown.isNotEmpty()) ack(shown)
        } catch (_: Exception) {
            // A malformed frame must not take the connection down with it.
        }
    }

    /**
     * File the delivery report. Best-effort in the truest sense: an ack that
     * cannot be sent means the server retries a notice this phone has already
     * shown, which is a duplicate and not a loss — so nothing here may throw, and
     * nothing here waits on the caller's patience.
     */
    private fun ack(notificationId: String) {
        val body = try {
            JSONObject()
                .put("ids", JSONArray(listOf(notificationId)))
                .put("channel", "live")
                .put("deviceRef", "keepalive")
                .toString()
                .toByteArray(StandardCharsets.UTF_8)
        } catch (_: Exception) {
            return
        }
        try {
            val connection = (URL("$baseUrl/api/notifications/ack").openConnection() as HttpURLConnection).apply {
                requestMethod = "POST"
                setRequestProperty("Authorization", "Bearer $token")
                setRequestProperty("Content-Type", "application/json; charset=utf-8")
                doOutput = true
                connectTimeout = 10_000
                readTimeout = 10_000
            }
            connection.outputStream.use { it.write(body) }
            // The response is deliberately unread: a failed ack only means the
            // notice is offered again later.
            connection.responseCode
        } catch (_: Exception) {
        }
    }

    private fun dropSocket() {
        try {
            stream?.disconnect()
        } catch (_: Exception) {
        }
    }

    /**
     * Channels exist before anything is posted: on Android 8+ a notification whose
     * channel is missing is dropped, and a dropped ongoing notification takes the
     * service with it on some ROMs.
     */
    private fun ensureChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = getSystemService(NotificationManager::class.java)
        if (manager.getNotificationChannel(CHANNEL) != null) return
        // Low importance, no badge, hidden on the lock screen: this line is
        // permanent, so it must never ring, never count, and never leak that a
        // case is open to somebody reading the phone.
        val channel = NotificationChannel(
            CHANNEL,
            "اتصال زندهٔ اعلان‌ها",
            NotificationManager.IMPORTANCE_LOW,
        ).apply {
            description = "نشان می‌دهد برنامه برای رسیدنِ بی‌دریغ اعلان‌ها به سرور وصل است."
            setShowBadge(false)
            lockscreenVisibility = Notification.VISIBILITY_SECRET
        }
        manager.createNotificationChannel(channel)
    }

    /**
     * `specialUse` rather than `dataSync`: from Android 14 a data-sync service is
     * capped at a few hours a day, and for a connection whose whole job is to
     * stay open that cap would silently rebuild the polling gap this path exists
     * to remove. The manifest declares the matching type and permission.
     */
    private fun startForegroundCompat(notification: Notification) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                startForeground(
                    NOTIFICATION_ID,
                    notification,
                    android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE,
                )
            } else {
                startForeground(NOTIFICATION_ID, notification)
            }
        } catch (error: Exception) {
            // A revoked notification permission must not take down the process
            // that also holds the app's only instant channel.
            Log.w(TAG, "startForeground failed", error)
            stopSelf()
        }
    }

    /**
     * The notification that makes the connection legitimate in Android's eyes, and
     * that the customer can read as a status line. Tapping it opens the notice
     * list, so it is a door rather than decoration.
     */
    private fun ongoingNotification(): Notification {
        val intent = Intent(this, MainActivityClass.get()).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
            putExtra("pishkan.push.link", "/app/notifications")
            action = "ir.pishkan.app.KEEPALIVE"
        }
        val pending = PendingIntent.getActivity(
            this,
            KEEPALIVE_REQUEST_CODE,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or
                (if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) PendingIntent.FLAG_IMMUTABLE else 0),
        )
        return NotificationCompat.Builder(this, CHANNEL)
            .setContentTitle("اتصال زندهٔ اعلان‌ها برقرار است")
            .setContentText("اعلان‌ها بدون انتظار برای بررسی دوره‌ای می‌رسند.")
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentIntent(pending)
            .setOngoing(true)
            .setShowWhen(false)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()
    }

    companion object {
        private const val TAG = "PishkanKeepAlive"
        const val CHANNEL = "pishkan_keepalive_v1"
        private const val NOTIFICATION_ID = 19081
        private const val KEEPALIVE_REQUEST_CODE = 19082
        private const val EXTRA_BASE_URL = "pishkan.keepalive.base"
        private const val EXTRA_TOKEN = "pishkan.keepalive.token"
        private const val BACKOFF_MIN_SEC = 5
        private const val BACKOFF_MAX_SEC = 60
        private const val EVENT_NOTIFICATION = "notification"

        /**
         * Arm the connection.
         *
         * The token travels in the intent and lives in memory only. Writing it to
         * SharedPreferences — the obvious way to survive a restart — would put a
         * bearer credential in a plain XML file beside the app's other
         * preferences, while the session itself is kept in encrypted storage. The
         * service therefore starts over when the app starts, which is also the
         * only moment a fresh token is guaranteed.
         */
        fun start(context: Context, baseUrl: String, token: String) {
            val intent = Intent(context, KeepAliveService::class.java)
                .putExtra(EXTRA_BASE_URL, baseUrl)
                .putExtra(EXTRA_TOKEN, token)
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    context.startForegroundService(intent)
                } else {
                    context.startService(intent)
                }
            } catch (_: Exception) {
                // Android 12+ can refuse a background start, and some vendor ROMs
                // veto the service type outright. Both are survivable by design:
                // the WorkManager check and FCM keep working, which is what those
                // two paths are for.
            }
        }

        fun stop(context: Context) {
            try {
                context.stopService(Intent(context, KeepAliveService::class.java))
            } catch (_: Exception) {
            }
        }
    }
}

/**
 * The one value the reader thread and the UI agree on.
 *
 * A process-wide object rather than an intent extra because the flag flips on
 * every foreground/background transition, and restarting the service for that
 * would drop the socket — the exact thing the mode change exists to avoid.
 */
object KeepAliveState {
    /** True while the app's own UI is up and already announcing notices. */
    @Volatile var quietWhileForeground: Boolean = false
}
