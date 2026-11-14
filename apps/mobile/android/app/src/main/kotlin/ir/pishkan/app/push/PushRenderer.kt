package ir.pishkan.app.push

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.media.AudioAttributes
import android.net.Uri
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import io.flutter.FlutterInjector
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.embedding.engine.dart.DartExecutor
import io.flutter.plugin.common.MethodChannel
import java.net.HttpURLConnection
import java.net.URL
import kotlin.math.roundToInt

/**
 * Builds and posts the tray notification for one push message.
 *
 * ## Why the rendering lives in Kotlin
 *
 * The message arrives as a *data-only* FCM message, so Flutter is not
 * guaranteed to be running: when the app is closed, Android starts a background
 * isolate for the receiver and stops it again a few seconds later. Doing the
 * tray work natively means the notification appears immediately and correctly
 * even if the Dart isolate never reaches a `runApp()`.
 *
 * ## What makes it look like a real app's notification
 *
 * - a colour accent, so the icon does not render as a grey blob on Android 6+;
 * - `setProgress` for case stages, which draws the same determinate bar a
 *   delivery app uses;
 * - the same tag for the same case, so stage 4 *replaces* stage 3 instead of
 *   stacking a column of stale rows;
 * - an inbox-style expanded view for longer bodies;
 * - a deep link carried in the payload, so a tap lands on the case, not on the
 *   home screen.
 */
object PushRenderer {
    const val CHANNEL_STAGE = "pishkan_requests_v2"
    const val CHANNEL_MESSAGE = "pishkan_messages_v2"
    const val CHANNEL_INVOICE = "pishkan_invoices_v2"
    const val CHANNEL_ANNOUNCE = "pishkan_stories_v2"
    const val CHANNEL_GENERAL = "pishkan_general_v2"

    private const val ACCENT = 0xFF1D4ED8.toInt()

    /** Latin digits → Persian digits, mirroring `faDigits` in Dart. */
    internal fun faDigits(value: Int): String {
        val text = value.toString()
        val out = StringBuilder(text.length)
        for (ch in text) out.append(if (ch in '0'..'9') '۰' + (ch - '0') else ch)
        return out.toString()
    }

    /** Which channel a message belongs on; mirrors NotifierService in Dart. */
    fun channelFor(data: Map<String, String>): String {
        val link = data["link"] ?: ""
        val kind = data["kind"] ?: ""
        // Order matters: a message link also contains `requests/`, so messages
        // must be matched before stages or every chat reply would ring on the
        // case channel.
        return when {
            link.contains("/app/banners") -> CHANNEL_ANNOUNCE
            link.contains("messages") || link.contains("support") || link.startsWith("chat:") -> CHANNEL_MESSAGE
            link.contains("invoice") -> CHANNEL_INVOICE
            link.contains("requests/") || kind == "stage" -> CHANNEL_STAGE
            else -> CHANNEL_GENERAL
        }
    }

    /**
     * Channels are created before the first post, and once created their
     * importance cannot be raised by the app. Getting them right at install
     * time is the difference between "buzzed once and then silent" and working
     * notifications.
     */
    fun ensureChannels(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        val definitions = listOf(
            Triple(CHANNEL_STAGE, "تغییرات پرونده‌ها", "notice_soft"),
            Triple(CHANNEL_MESSAGE, "پیام‌ها", "message_soft"),
            Triple(CHANNEL_INVOICE, "فاکتورها", "invoice_soft"),
            Triple(CHANNEL_ANNOUNCE, "اطلاعیه‌ها و بنرها", "notice_soft"),
            Triple(CHANNEL_GENERAL, "اطلاع‌رسانی سامانه", "notice_soft"),
        )
        for ((id, name, sound) in definitions) {
            val attrs = AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_NOTIFICATION)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build()
            val soundUri = Uri.parse("android.resource://${context.packageName}/raw/$sound")
            val channel = NotificationChannel(id, name, NotificationManager.IMPORTANCE_HIGH).apply {
                description = name
                enableVibration(true)
                enableLights(true)
                lightColor = ACCENT
                setSound(soundUri, attrs)
            }
            manager.createNotificationChannel(channel)

            // The silent twin, so turning sounds off in the app does not need
            // a channel round trip (Android cannot change a live channel).
            val silent = NotificationChannel("${id}_silent", "$name (بی‌صدا)", NotificationManager.IMPORTANCE_HIGH).apply {
                description = name
                setSound(null, null)
                enableVibration(true)
            }
            manager.createNotificationChannel(silent)
        }
    }

    /**
     * Post one message.
     *
     * @param soundsEnabled comes from the app's own preference, passed in by
     *        the receiver (which reads it from the shared preferences file
     *        Flutter writes) so the mute switch keeps working when Dart is not
     *        running.
     */
    fun show(
        context: Context,
        data: Map<String, String>,
        soundsEnabled: Boolean,
        largeIcon: Bitmap? = null,
    ) {
        ensureChannels(context)
        val title = data["title"].orEmpty().ifBlank { "تک پیشخوان" }
        val body = data["body"].orEmpty()
        val link = data["link"].orEmpty()
        val notificationId = data["notificationId"].orEmpty()
        // The server sends `progress` already scaled to 0..100, because
        // NotificationCompat.setProgress(max, value) takes an integer
        // percentage. Reading it back as a 0..1 fraction here would show "٪۶۰"
        // as "٪0.6" and draw an empty bar. Clamped because a malformed value
        // from a proxy must not throw inside the notification path.
        val progress = data["progress"]?.toDoubleOrNull()?.let { value ->
            if (value.isNaN()) null else value.roundToInt().coerceIn(0, 100)
        }
        val stageLabel = data["stageLabel"].orEmpty()
        val baseChannel = channelFor(data)
        val channelId = if (soundsEnabled) baseChannel else "${baseChannel}_silent"

        val intent = Intent(context, MainActivityClass.get()).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
            putExtra("pishkan.push.link", link)
            putExtra("pishkan.push.notificationId", notificationId)
            // A cold start must not reuse the previous intent's extras.
            action = "ir.pishkan.app.PUSH_${System.currentTimeMillis()}"
        }
        val flags = PendingIntent.FLAG_UPDATE_CURRENT or
            (if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) PendingIntent.FLAG_IMMUTABLE else 0)
        // One request code per tag: two notifications must open two different
        // cases, and PendingIntent identity is what decides that.
        // Derived from the tag, NOT from notificationId: `notify(tag, id)` uses
        // the id as the second half of the notification's identity, so a value
        // that is 0 (absent) or that changes per message would either replace
        // unrelated notifications or turn "one row per case" into a row per
        // message. The tag already encodes the case, so it is the right key for
        // both.
        val requestCode = (data["tag"] ?: notificationId.ifBlank { title }).hashCode()
        val pending = PendingIntent.getActivity(context, requestCode, intent, flags)

        // Persian numerals, like every number in the app: a notification that
        // reads "٪60" next to "مرحلهٔ ۳ از ۵" looks like a different app wrote it.
        val percent = progress?.let { "${faDigits(it)}٪" }.orEmpty()
        val bigText = if (progress != null && stageLabel.isNotBlank()) {
            buildString {
                if (body.isNotBlank()) append(body).append('\n')
                append("مرحلهٔ فعلی: ").append(stageLabel)
                if (percent.isNotEmpty()) append(" (").append(percent).append(')')
            }
        } else body

        // A small icon that resolves to 0 makes NotificationManager silently
        // drop the whole notification — no exception, no log the user sees, and
        // the customer simply never gets told. Falling back to a platform icon
        // is ugly but visible, which is far better than a notification that
        // vanishes because a drawable was renamed.
        val smallIcon = context.resources
            .getIdentifier("ic_stat_pishkan", "drawable", context.packageName)
            .takeIf { it != 0 }
            ?: android.R.drawable.ic_dialog_info

        val builder = NotificationCompat.Builder(context, channelId)
            .setSmallIcon(smallIcon)
            .setContentTitle(title)
            .setContentText(body.ifBlank { stageLabel })
            .setStyle(NotificationCompat.BigTextStyle().bigText(bigText))
            .setAutoCancel(true)
            .setContentIntent(pending)
            .setColor(ACCENT)
            .setColorized(false)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_STATUS)
            .setWhen(System.currentTimeMillis())
            .setShowWhen(true)

        // A determinate bar on a case update is the detail that makes it read
        // as "my case is 60% done" at a glance instead of another text row.
        if (progress != null) {
            builder.setProgress(100, progress, false)
            builder.setSubText("مرحله: $stageLabel")
        }
        largeIcon?.let { builder.setLargeIcon(it) }

        val tag = data["tag"]
        try {
            NotificationManagerCompat.from(context).notify(tag, requestCode, builder.build())
        } catch (_: SecurityException) {
            // POST_NOTIFICATIONS revoked between checks: nothing to do, and
            // crashing the receiver would lose the message entirely.
        }
    }

    /**
     * Fetch a picture for the notification's large icon.
     *
     * Slower than using a bundled asset, so it is only attempted for messages
     * that carry an image URL, and only with a short timeout: a notification
     * that arrives three seconds late is worse than one without a picture.
     */
    fun fetchLargeIcon(url: String?): Bitmap? {
        if (url.isNullOrBlank() || !url.startsWith("http")) return null
        return try {
            val connection = (URL(url).openConnection() as HttpURLConnection).apply {
                connectTimeout = 2500
                readTimeout = 2500
                instanceFollowRedirects = true
            }
            connection.inputStream.use { BitmapFactory.decodeStream(it) }
        } catch (_: Exception) {
            null
        }
    }
}

/**
 * Indirection so PushRenderer does not need a compile-time reference to the
 * activity, which keeps it usable from a unit test and from the receiver.
 */
object MainActivityClass {
    private var holder: Class<*>? = null
    fun set(clazz: Class<*>) { holder = clazz }
    fun get(): Class<*> = holder ?: Class.forName("ir.pishkan.app.MainActivity")
}

/**
 * Delivers the tap into Dart once the engine is up.
 *
 * A cold start has no Flutter engine yet, so the link is stashed in a static and
 * drained by the plugin when Dart registers its handler; a warm start gets it
 * immediately.
 */
object PushBridge {
    @Volatile private var pendingLink: String? = null
    @Volatile private var channel: MethodChannel? = null
    @Volatile private var engine: FlutterEngine? = null
    /**
     * The engine that has a UI attached, as opposed to the headless one the
     * service starts to upload a token.
     *
     * Without this distinction a tap could be delivered to a headless isolate:
     * the process is alive (so the tap does not cold-start anything), the link
     * is invoked on the channel, and no Dart code is listening for navigation —
     * the tap is swallowed and the customer sees the app not reacting. A
     * pending link is therefore only drained by the UI engine.
     */
    @Volatile private var uiEngine: FlutterEngine? = null

    fun attach(engine: FlutterEngine, context: Context? = null) {
        this.engine = engine
        channel = MethodChannel(engine.dartExecutor.binaryMessenger, "ir.pishkan.app/push").apply {
            setMethodCallHandler { call, result ->
                when (call.method) {
                    // Sent only by the UI isolate, once its method handler is
                    // installed. That is the exact moment this engine can act on
                    // a tap; the headless entrypoint never sends it, so a link
                    // is never handed to an isolate that cannot navigate.
                    "ready" -> {
                        uiEngine = engine
                        result.success(null)
                    }
                    "takeInitialLink" -> result.success(takeInitialLink())
                    // Fetched on sign-in so the first registration does not have
                    // to wait for the next token rotation.
                    "getToken" -> {
                        if (context == null) {
                            result.success(null)
                        } else if (!FirebaseBootstrap.isConfigured(context)) {
                            // No Firebase project on this build: answer null
                            // rather than throwing, so the app falls back to
                            // polling without an error dialog.
                            result.success(null)
                        } else {
                            com.google.firebase.messaging.FirebaseMessaging.getInstance().token
                                .addOnCompleteListener { task ->
                                    result.success(if (task.isSuccessful) task.result else null)
                                }
                        }
                    }
                    else -> result.notImplemented()
                }
            }
        }
    }

    fun deliver(link: String) {
        val target = channel
        // No engine at all, or only a headless one: keep the link for the UI
        // engine that the tap is about to start.
        if (target == null || uiEngine == null) {
            pendingLink = link
            return
        }
        try {
            target.invokeMethod("onPushLink", link)
        } catch (_: Exception) {
            pendingLink = link
        }
    }

    fun takeInitialLink(): String? {
        val link = pendingLink
        pendingLink = null
        return link
    }

    /**
     * Called once from [ir.pishkan.app.PishkanApplication] so that a tap which
     * cold-started the app is never handed to an engine that will not survive.
     *
     * Nothing to do beyond clearing the stale engine references: the previous
     * process may have left a channel pointing at a dead isolate, and a link
     * delivered there would be swallowed. Application.onCreate runs before any
     * Activity or Service, so this is the earliest point that can tell them
     * apart. It is intentionally cheap and allocation-free.
     */
    @Synchronized
    fun markProcessStarted() {
        channel = null
        engine = null
        uiEngine = null
    }

    /** Register the FCM token with the server using Dart's own HTTP stack. */
    fun currentEngine(): FlutterEngine? = engine
}

/**
 * A tiny headless engine for the case where a data message wakes the app while
 * it is closed and no engine exists.
 *
 * Flutter's `FlutterEngine` can run a Dart entrypoint without an Activity. The
 * entrypoint only registers the token and exits, so this costs a fraction of a
 * second and never shows UI.
 */
object HeadlessPush {
    @Volatile private var started = false

    @Synchronized
    fun ensureRunning(context: Context) {
        if (started || PushBridge.currentEngine() != null) return
        started = true
        try {
            val loader = FlutterInjector.instance().flutterLoader()
            loader.startInitialization(context)
            loader.ensureInitializationComplete(context, null)
            val engine = FlutterEngine(context)
            val entry = DartExecutor.DartEntrypoint(
                loader.findAppBundlePath(),
                "pushBackgroundMain",
            )
            engine.dartExecutor.executeDartEntrypoint(entry)
            PushBridge.attach(engine)
        } catch (_: Exception) {
            started = false
        }
    }
}
