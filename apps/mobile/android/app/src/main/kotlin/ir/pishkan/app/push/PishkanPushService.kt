package ir.pishkan.app.push

import android.content.Context
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

/**
 * Receives FCM messages.
 *
 * ## Why data-only
 *
 * The server sends `data` and no `notification` block. Android renders a
 * `notification` block itself while the app is closed, which is convenient but
 * leaves the app no say in the icon, channel, colour, progress bar or tap
 * target — and on several vendor ROMs the system-rendered variant is what users
 * report as "a plain white square". With a data message this service builds the
 * notification in [PushRenderer], which is the same visual result the in-app
 * banner uses.
 *
 * ## Why it runs even when the app was never opened
 *
 * A data-only message is delivered to this service even in the background,
 * because FCM starts the process itself. That is the entire point of this
 * feature: it does not depend on WorkManager's 15-minute floor, on Doze, or on
 * the vendor's battery manager allowing the app to wake up.
 *
 * ## What still needs the app
 *
 * Nothing. Registration happens on sign-in and on `onNewToken` below; if the
 * token arrives while the app is closed, a headless engine posts it.
 */
class PishkanPushService : FirebaseMessagingService() {

    override fun onMessageReceived(message: RemoteMessage) {
        val data = message.data ?: return
        // Some senders (and every test message from the Firebase console) put
        // the text in `notification` instead. Support both rather than dropping
        // a message the operator thought they sent.
        val merged = buildMap {
            putAll(data)
            message.notification?.title?.let { if (!containsKey("title")) put("title", it) }
            message.notification?.body?.let { if (!containsKey("body")) put("body", it) }
        }
        val icon = PushRenderer.fetchLargeIcon(merged["image"])
        PushRenderer.show(this, merged, soundsEnabled = PushPreferences.soundsEnabled(this), largeIcon = icon)
        // Keep the in-app feed's local cache in step with what the tray just
        // showed, so opening the app does not re-announce the same event.
        HeadlessPush.ensureRunning(this)
        PushBridge.currentEngine()?.let { engine ->
            try {
                io.flutter.plugin.common.MethodChannel(engine.dartExecutor.binaryMessenger, "ir.pishkan.app/push")
                    .invokeMethod("synchronise", null)
            } catch (_: Exception) {
                // Best effort: the app reconciles the feed when it opens.
            }
        }
    }

    /**
     * A new registration token means the old one is dead. The app must send
     * this to the server, or the customer silently stops receiving pushes after
     * a reinstall or an app-data clear — which is the most common "notifications
     * worked and then stopped" report.
     */
    override fun onCreate() {
        // Firebase must be initialised *before* super.onCreate(): the base
        // FirebaseMessagingService constructor/`onCreate` resolves
        // FirebaseApp.getInstance(), and with this project not applying the
        // google-services Gradle plugin there is no FirebaseInitProvider to
        // have done it already. Getting this order wrong throws on a background
        // thread the first time a message arrives for a closed app — which is
        // exactly the case this feature exists for.
        //
        // PishkanApplication normally does this already at process start; the
        // call is idempotent and stays here so the service is not silently
        // broken if the manifest placeholder ever regresses.
        FirebaseBootstrap.ensure(this)
        super.onCreate()
        PushRenderer.ensureChannels(this)
    }

    override fun onNewToken(token: String) {
        FirebaseBootstrap.ensure(this)
        PushPreferences.storeToken(this, token)
        HeadlessPush.ensureRunning(this)
        PushBridge.currentEngine()?.let { engine ->
            try {
                io.flutter.plugin.common.MethodChannel(engine.dartExecutor.binaryMessenger, "ir.pishkan.app/push")
                    .invokeMethod("registerToken", token)
            } catch (_: Exception) {
                // Stored in preferences; uploaded at next app start.
            }
        }
    }
}

/**
 * The few preferences the receiver needs while Dart is not running.
 *
 * Flutter's `shared_preferences` writes to this same file with a `flutter.`
 * prefix, so the tray notification honours the in-app mute switch without a
 * round trip through Dart.
 */
object PushPreferences {
    private const val FILE = "FlutterSharedPreferences"
    private const val SOUNDS = "flutter.pishkan.pref.sounds"
    private const val TOKEN = "flutter.pishkan.push.token"

    fun soundsEnabled(context: Context): Boolean {
        val prefs = context.getSharedPreferences(FILE, Context.MODE_PRIVATE)
        return prefs.getBoolean(SOUNDS, true)
    }

    fun storeToken(context: Context, token: String) {
        context.getSharedPreferences(FILE, Context.MODE_PRIVATE).edit()
            .putString(TOKEN, token).apply()
    }
}
