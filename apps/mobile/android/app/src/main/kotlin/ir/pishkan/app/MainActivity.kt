package ir.pishkan.app

import android.content.Intent
import android.media.AudioAttributes
import android.media.SoundPool
import android.net.Uri
import android.os.PowerManager
import android.provider.Settings
import io.flutter.embedding.android.FlutterFragmentActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel
import ir.pishkan.app.push.FirebaseBootstrap
import ir.pishkan.app.push.MainActivityClass
import ir.pishkan.app.push.PushBridge
import ir.pishkan.app.push.PushRenderer

// FragmentActivity host so biometric prompts (local_auth) can attach.
class MainActivity : FlutterFragmentActivity() {
    private var sounds: SoundPool? = null
    private val soundIds = mutableMapOf<String, Int>()

    override fun onCreate(savedInstanceState: android.os.Bundle?) {
        super.onCreate(savedInstanceState)
        MainActivityClass.set(MainActivity::class.java)
        // Firebase from string resources, not google-services.json; a blank
        // config simply leaves push disabled and polling takes over.
        FirebaseBootstrap.ensure(this)
        PushRenderer.ensureChannels(this)
        // A notification tap that cold-started the app arrives as an Intent.
        handlePushIntent(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handlePushIntent(intent)
    }

    /**
     * Carry the deep link from a tapped notification into Dart.
     *
     * The link is stashed rather than sent straight away: on a cold start the
     * Flutter engine is not running yet, and invoking a method on a missing
     * channel throws away the very tap the customer made.
     */
    private fun handlePushIntent(intent: Intent?) {
        val link = intent?.getStringExtra("pishkan.push.link").orEmpty()
        if (link.isNotEmpty()) {
            PushBridge.deliver(link)
            // Do not let a stale link survive a configuration change.
            intent?.removeExtra("pishkan.push.link")
        }
    }

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        PushBridge.attach(flutterEngine, this)
        sounds = SoundPool.Builder().setMaxStreams(3).setAudioAttributes(
            AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ASSISTANCE_SONIFICATION)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build()
        ).build().also {
            // One stream per semantic event; the Dart side names the kind.
            soundIds["success"] = it.load(this, R.raw.action_success, 1)
            soundIds["error"] = it.load(this, R.raw.action_error, 1)
            soundIds["tap"] = it.load(this, R.raw.ui_tap, 1)
            soundIds["notice"] = it.load(this, R.raw.notice_soft, 1)
        }
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "ir.pishkan.app/sounds")
            .setMethodCallHandler { call, result ->
                if (call.method == "play") {
                    val kind = call.argument<String>("kind") ?: ""
                    // Taps stay quieter than confirmations; one stream at a time
                    // so rapid tapping cannot stack into noise.
                    val volume = if (kind == "tap") 0.28f else 0.55f
                    soundIds[kind]?.let { sounds?.play(it, volume, volume, 1, 0, 1f) }
                    result.success(null)
                } else result.notImplemented()
            }
        // Doze can hold the 15-minute background check for hours on some
        // phones, which reads to the customer as "notifications never arrive".
        // The OS exposes no way to *query* whether the app is exempt, so the
        // button opens the right system page and reports whether we are
        // already exempt.
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "ir.pishkan.app/battery")
            .setMethodCallHandler { call, result ->
                if (call.method == "requestIgnore") {
                    val power = getSystemService(POWER_SERVICE) as PowerManager
                    val exempt = power.isIgnoringBatteryOptimizations(packageName)
                    if (exempt) {
                        // Already unrestricted: there is no dialog to show, so
                        // open the list where it can be changed back.
                        startActivity(
                            Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)
                                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                        )
                    } else {
                        startActivity(
                            Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS)
                                .setData(Uri.parse("package:$packageName"))
                                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                        )
                    }
                    result.success(exempt)
                } else result.notImplemented()
            }
    }

    override fun onDestroy() {
        sounds?.release()
        sounds = null
        super.onDestroy()
    }
}
