package ir.pishkan.app

import android.media.AudioAttributes
import android.media.SoundPool
import io.flutter.embedding.android.FlutterFragmentActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

// FragmentActivity host so biometric prompts (local_auth) can attach.
class MainActivity : FlutterFragmentActivity() {
    private var sounds: SoundPool? = null
    private val soundIds = mutableMapOf<String, Int>()

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
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
    }

    override fun onDestroy() {
        sounds?.release()
        sounds = null
        super.onDestroy()
    }
}
