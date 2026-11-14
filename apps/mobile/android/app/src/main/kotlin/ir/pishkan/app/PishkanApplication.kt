package ir.pishkan.app

import android.app.Application
import ir.pishkan.app.push.FirebaseBootstrap
import ir.pishkan.app.push.PushBridge
import ir.pishkan.app.push.PushRenderer

/**
 * Initialises Firebase before anything else in the process runs.
 *
 * ## Why this class has to exist
 *
 * Push is supposed to work when the app is closed, and that is precisely the
 * case this class guards. When FCM has a message for a stopped app it starts
 * the process itself and instantiates [ir.pishkan.app.push.PishkanPushService].
 * Android constructs an *Application* first, always — and
 * `FirebaseMessagingService.onCreate()` calls `super.onCreate()`, which touches
 * `FirebaseApp.getInstance()`.
 *
 * This project deliberately does not apply the `com.google.gms.google-services`
 * Gradle plugin (see `FirebaseBootstrap` for the reasoning: it hard-fails the
 * build when `google-services.json` is absent, which would break CI). That
 * plugin is what normally generates the `FirebaseInitProvider` metadata and the
 * `google_app_id` resources, so **without it, nothing initialises Firebase** at
 * process start. The old code initialised it from `MainActivity.onCreate()` and
 * from `PishkanPushService.onCreate()` — both too late:
 *
 *  - `MainActivity` does not run at all when the app is closed, so a message
 *    arriving in that state found an uninitialised Firebase;
 *  - in the service, `super.onCreate()` runs before our own body, so the
 *    service threw before it ever reached `FirebaseBootstrap.ensure()`.
 *
 * The practical symptom was the worst kind: notifications looked implemented
 * and tests passed, but a customer whose app was swiped away silently received
 * nothing, and the throw happened on a background thread where nobody sees it.
 *
 * ## Why doing it here is safe
 *
 * `Application.onCreate()` runs on every process start — UI, background service,
 * or a headless Flutter engine — and runs before any Activity, Service or
 * ContentProvider of ours. Initialising once here covers all three, and
 * [FirebaseBootstrap] is idempotent, so the later calls in `MainActivity` and
 * the service stay as harmless belt-and-braces.
 *
 * The notification channels are created here too. They must exist before the
 * first post, and a channel cannot be created from a dead process; creating them
 * at process start is the earliest point that is still cheap.
 */
class PishkanApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        // Order matters: Firebase first (the messaging service needs it),
        // channels second (the renderer needs them), and nothing else — no
        // Flutter engine, no I/O on the main thread.
        FirebaseBootstrap.ensure(this)
        PushRenderer.ensureChannels(this)
        // A cold start from a notification tap may deliver the Intent before
        // the Flutter engine attaches its channel; PushBridge holds the link
        // until the UI isolate says it is ready.
        PushBridge.markProcessStarted()
    }
}
