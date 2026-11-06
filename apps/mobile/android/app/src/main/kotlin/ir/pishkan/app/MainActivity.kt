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
        sounds = SoundPool.Builder().setMaxStreams(2).setAudioAttributes(
            AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ASSISTANCE_SONIFICATION)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build()
        ).build().also {
            soundIds["success"] = it.load(this, R.raw.message_soft, 1)
            soundIds["error"] = it.load(this, R.raw.action_error, 1)
        }
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "ir.pishkan.app/sounds")
            .setMethodCallHandler { call, result ->
                if (call.method == "play") {
                    soundIds[call.argument<String>("kind")]?.let { sounds?.play(it, 0.5f, 0.5f, 1, 0, 1f) }
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
