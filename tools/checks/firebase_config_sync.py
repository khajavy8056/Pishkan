#!/usr/bin/env python3
"""`google-services.json` and `res/values/firebase.xml` must say the same thing.

Why this gate exists
--------------------
This app does not apply `com.google.gms.google-services`: that plugin fails the
build when the JSON is missing, and the repo has to keep building an APK on CI
and on every developer machine. So the four Firebase identifiers live in
`res/values/firebase.xml` and `FirebaseBootstrap.kt` initialises Firebase from
them (see the comments in both files).

That is a working arrangement right up until someone regenerates
`google-services.json` in the Firebase console — new app, migrated project, a
key rotated — and updates only one of the two places. The symptom is the worst
possible one for this feature: the app builds, installs, signs in, and simply
never receives anything while it is closed, because the token it obtains belongs
to a project the server's service account cannot push to. `google-services.json`
is therefore committed (the canonical location, so the plugin can be turned on
later without hunting for the file), and this check is what keeps the two in step.

Rules
-----
* If `apps/mobile/android/app/google-services.json` exists it must parse, and
  exactly one client entry must match `ir.pishkan.app`.
* `firebase_project_id` = `project_info.project_id`
* `firebase_sender_id` = `project_info.project_number`
* `firebase_application_id` = that client's `client_info.mobilesdk_app_id`
* `firebase_api_key` = that client's first `api_key[].current_key`
* The service-account *private key* must NOT be anywhere in the repo: the file a
  Firebase project hands out for *sending* is a server credential and belongs in
  the admin panel (`push.fcm_service_account`), so its distinctive fields are
  searched for and rejected.

Usage: python3 firebase_config_sync.py [repo-root]
"""
import json
import re
import sys
from pathlib import Path

PACKAGE = "ir.pishkan.app"
ROOT_DEFAULT = Path(__file__).resolve().parents[2]

# Fields that only exist in a *service account* JSON, never in google-services.json.
SECRET_FIELDS = ("private_key", "client_x509_cert_path", "auth_uri")
XML_ENTRY = re.compile(r'<string name="(?P<name>firebase_[a-z_]+)"[^>]*>(?P<value>[^<]*)</string>')


def xml_values(xml_path: Path) -> dict[str, str]:
    if not xml_path.exists():
        return {}
    return {m.group("name"): m.group("value").strip() for m in XML_ENTRY.finditer(xml_path.read_text(encoding="utf-8"))}


def json_values(json_path: Path) -> tuple[dict[str, str], list[str]]:
    problems: list[str] = []
    try:
        data = json.loads(json_path.read_text(encoding="utf-8"))
    except Exception as error:  # noqa: BLE001 - a corrupt file is a finding, not a crash
        return {}, [f"google-services.json does not parse: {error}"]
    info = data.get("project_info") or {}
    clients = [c for c in (data.get("client") or []) if (c.get("client_info") or {}).get("android_client_info", {}).get("package_name") == PACKAGE]
    if not clients:
        return {}, [f"google-services.json has no android client for {PACKAGE} (packages found: "
                    + ", ".join(str((c.get('client_info') or {}).get('android_client_info', {}).get('package_name')) for c in data.get('client') or []) + ")"]
    if len(clients) > 1:
        problems.append("google-services.json has more than one client for " + PACKAGE + " — the build would not know which app id to use")
    client = clients[0]
    keys = [str(k.get("current_key") or "") for k in client.get("api_key") or []]
    return ({
        "firebase_project_id": str(info.get("project_id") or ""),
        "firebase_sender_id": str(info.get("project_number") or ""),
        "firebase_application_id": str((client.get("client_info") or {}).get("mobilesdk_app_id") or ""),
        "firebase_api_key": keys[0] if keys else "",
    }, problems)


def scan_for_service_account(root: Path) -> list[str]:
    """Reject a *sending* credential checked into the repo."""
    hits: list[str] = []
    skip = {".git", "node_modules", "build", ".dart_tool", ".gradle", "dist", ".next"}
    for path in root.rglob("*.json"):
        if any(part in skip for part in path.parts):
            continue
        if path.name == "package-lock.json":
            continue
        try:
            text = path.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        if all(f'"{field}"' in text for field in SECRET_FIELDS[:2]):
            hits.append(f"{path.relative_to(root)} looks like a Firebase *service account* key — that is a sending credential; put it in the admin panel (push.fcm_service_account), not the repository")
    return hits


def check(root: Path) -> list[str]:
    app_dir = root / "apps" / "mobile" / "android" / "app"
    xml = xml_values(app_dir / "src" / "main" / "res" / "values" / "firebase.xml")
    json_path = app_dir / "google-services.json"
    problems: list[str] = []

    if not xml:
        problems.append("apps/mobile/android/app/src/main/res/values/firebase.xml is missing or has no firebase_* strings")
    if not json_path.exists():
        problems.append("apps/mobile/android/app/google-services.json is missing (the file Firebase hands out; see docs/PUSH-NOTIFICATIONS-FA.md)")

    if xml and json_path.exists():
        expected, extra = json_values(json_path)
        problems += extra
        for name, want in expected.items():
            got = xml.get(name, "")
            if not want:
                problems.append(f"google-services.json has an empty {name}")
            elif got != want:
                problems.append(f"firebase.xml {name} = {got!r} but google-services.json says {want!r}")
        for name in expected:
            if not xml.get(name):
                problems.append(f"firebase.xml is missing a value for {name} — FirebaseApp is not initialised and push while the app is closed silently does nothing")

    problems += scan_for_service_account(root)
    return problems


def main() -> int:
    root = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT_DEFAULT
    problems = check(root)
    if problems:
        for problem in problems:
            print(problem)
        print(f"firebase config sync — {len(problems)} problem(s)")
        return 1
    print("firebase config sync — ok (google-services.json and firebase.xml agree)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
