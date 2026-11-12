package ir.pishkan.app.push

import android.content.Context
import com.google.firebase.FirebaseApp
import com.google.firebase.FirebaseOptions

/**
 * Initialises Firebase from string resources instead of `google-services.json`.
 *
 * ## Why not the Google Services Gradle plugin
 *
 * That plugin is the normal path, and it has two problems here:
 *
 *  1. It fails the build when the JSON is missing, which would break CI and
 *     every developer who does not have the office's Firebase project. This
 *     repo builds an APK on every push; a binary blob that must be committed to
 *     a repository is also the wrong place for a project id that differs per
 *     deployment.
 *  2. The values belong to *the customer's* Firebase project, and the office may
 *     swap projects (or start without one) without a code change.
 *
 * So the three non-secret values (`project_id`, `application_id`,
 * `api_key`, sender id) live in `res/values/firebase.xml`, overridable at build
 * time with `-PfirebaseAppId=…` etc. A service-account private key is NOT here:
 * sending is server-side only, so the app never holds a credential that could
 * be used to push to every device.
 *
 * ## What happens when the values are blank
 *
 * `FirebaseApp` is not initialised. `FirebaseMessaging.getInstance()` would
 * then throw, so callers check [isConfigured] first. The app keeps working with
 * its polling notifications; the admin panel shows push as "not configured"
 * instead of the customer silently getting nothing.
 */
object FirebaseBootstrap {
    @Volatile private var initialised = false
    @Volatile private var configured = false

    fun isConfigured(context: Context): Boolean {
        ensure(context)
        return configured
    }

    @Synchronized
    fun ensure(context: Context) {
        if (initialised) return
        initialised = true
        if (FirebaseApp.getApps(context).isNotEmpty()) {
            configured = true
            return
        }
        val res = context.resources
        val pkg = context.packageName
        fun text(name: String): String {
            val id = res.getIdentifier(name, "string", pkg)
            return if (id == 0) "" else res.getString(id).trim()
        }
        val projectId = text("firebase_project_id")
        val appId = text("firebase_application_id")
        val apiKey = text("firebase_api_key")
        val senderId = text("firebase_sender_id")
        // All four are required by FirebaseApp; a partial set is worse than none
        // because the failure surfaces later as an opaque "API key not valid".
        if (projectId.isBlank() || appId.isBlank() || apiKey.isBlank() || senderId.isBlank()) {
            configured = false
            return
        }
        try {
            val options = FirebaseOptions.Builder()
                .setProjectId(projectId)
                .setApplicationId(appId)
                .setApiKey(apiKey)
                .setGcmSenderId(senderId)
                .build()
            FirebaseApp.initializeApp(context, options)
            configured = true
        } catch (_: Exception) {
            configured = false
        }
    }
}
