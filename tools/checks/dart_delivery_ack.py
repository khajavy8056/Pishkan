#!/usr/bin/env python3
"""Guard the loop that turns «the phone showed it» into «the server knows».

The delivery ledger (`notification_acks` → `notifications.delivered_at`) is the
only thing that ends a retry chain and cancels the SMS escalation. Each client
closes its own half of that loop by acking whatever it displayed, and the mobile
app is the client that can *display without being opened* — the tray entry is
built by Kotlin while the app is closed, and by the WorkManager job with no UI at
all. So the app has two ack paths, and both are invisible when they break: no
error, no crash, just a notice that stays "undelivered" forever and gets pushed
again and again.

There is no Dart toolchain here, and no Android runtime, so the only way to keep
this from regressing is to assert the wiring exists in the sources it lives in —
Dart, Kotlin, and the endpoints they call. Each failure message names the user
outcome, not the missing string.

Usage:
    python3 tools/checks/dart_delivery_ack.py
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
MOBILE = ROOT / 'apps' / 'mobile'
API = ROOT / 'apps' / 'api'

NOTIFIER = MOBILE / 'lib' / 'services' / 'notifier.dart'
PUSH_DART = MOBILE / 'lib' / 'services' / 'push.dart'
PUSH_KT = MOBILE / 'android' / 'app' / 'src' / 'main' / 'kotlin' / 'ir' / 'pishkan' / 'app' / 'push' / 'PishkanPushService.kt'
RENDER_KT = MOBILE / 'android' / 'app' / 'src' / 'main' / 'kotlin' / 'ir' / 'pishkan' / 'app' / 'push' / 'PushRenderer.kt'
ROUTES = API / 'src' / 'routes' / 'notifications.ts'
DELIVERY = API / 'src' / 'modules' / 'notifications' / 'delivery.ts'
MANIFEST = MOBILE / 'android' / 'app' / 'src' / 'main' / 'AndroidManifest.xml'
SERVICE_KT = MOBILE / 'android' / 'app' / 'src' / 'main' / 'kotlin' / 'ir' / 'pishkan' / 'app' / 'push' / 'KeepAliveService.kt'
KEEPALIVE_DART = MOBILE / 'lib' / 'services' / 'keepalive.dart'
MAIN_ACTIVITY = MOBILE / 'android' / 'app' / 'src' / 'main' / 'kotlin' / 'ir' / 'pishkan' / 'app' / 'MainActivity.kt'
SHELL = MOBILE / 'lib' / 'screens' / 'home_shell.dart'
LOGOUT = MOBILE / 'lib' / 'services' / 'services.dart'
SETTINGS = MOBILE / 'lib' / 'screens' / 'profile.dart'
LIVE_EVENT = DELIVERY

# (file, required substrings, what the customer loses if any is gone)
CHAIN: list[tuple[Path, tuple[str, ...], str]] = [
    (
        NOTIFIER,
        ("'/api/notifications/ack'", "await ackShown(events.map((event) => event.id), channel: 'poll')"),
        'اعلانی که خود اپ در نوار اعلان گذاشته تأیید نمی‌شود؛ سرور آن را بی‌پاسخ می‌شمارد، '
        'دوباره تلاش می‌کند و ممکن است پیامک پشتیبان بفرستد',
    ),
    (
        PUSH_DART,
        ("case 'synchronise':", "channel: 'fcm'"),
        'اعلانِ رسیده با فایربیس در حالت بسته تأیید نمی‌شود؛ همان حلقهٔ تکرار باز می‌ماند',
    ),
    (
        PUSH_KT,
        ('val shown = PushRenderer.show(', '.invokeMethod("synchronise", shown)'),
        'کاتلین اعلان را می‌سازد ولی به دارت نمی‌گوید کدام را؛ تأیید تحویل از دست می‌رود',
    ),
    (
        RENDER_KT,
        ('): String {', 'areNotificationsEnabled()', 'return ""'),
        'نمایشِ ردشده (نوار اعلان خاموش) تحویل شمرده می‌شود و تلاش دوباره بی‌دلیل قطع می‌گردد',
    ),
    (
        ROUTES,
        ("notificationsRouter.post('/ack'", 'markDelivered(req.auth!.user.id'),
        'پایانهٔ تأیید نیست؛ هیچ کلاینتی نمی‌تواند تحویل را گزارش کند',
    ),
    (
        DELIVERY,
        ("'poll'", "'fcm'", 'UPDATE notifications SET delivered_at'),
        'کانال‌های اپ در دفتر تحویل معنا ندارند و `delivered_at` هرگز پر نمی‌شود',
    ),
]


# -------------------------------------------------------------------------- */
#  The fourth path: the app's own live connection (foreground service).
#
#  It is the only instant channel that needs neither Google nor a purchased push
#  provider, and it is made of five pieces in three languages: the manifest
#  declaration, the service, the bridge that arms it, the setting that turns it on,
#  and the sign-out that tears it down. Any one of them disappearing does not break
#  the build — it silently reduces the app to "poll every three minutes", which is
#  exactly the kind of regression nobody notices until a customer complains.  */
# --------------------------------------------------------------------------
KEEP_ALIVE: list[tuple[Path, tuple[str, ...], str]] = [
    (
        MANIFEST,
        (
            'android:name=".push.KeepAliveService"',
            'android:foregroundServiceType="specialUse"',
            'android.permission.FOREGROUND_SERVICE_SPECIAL_USE',
        ),
        'سرویس اتصال زنده در مانیفست نیست؛ اندروید آن را هرگز اجرا نمی‌کند و '
        '«اتصال زندهٔ بدون فایربیس» در تنظیمات فقط یک سوئیچ توخالی می‌ماند',
    ),
    (
        SERVICE_KT,
        (
            '/api/notifications/stream',
            '"channel", "live"',
            'PushRenderer.show(',
            'quietWhileForeground',
        ),
        'سرویس یا سوکت را باز می‌کند یا تحویل را گزارش؛ هر دو با هم لازم‌اند، '
        'وگرنه یا اعلانی نیست یا دفتری پر از «نرسیده» می‌ماند',
    ),
    (
        KEEPALIVE_DART,
        (
            "'ir.pishkan.app/keepalive'",
            "invokeMethod<void>('start'",
            "invokeMethod<void>('stop'",
            'AppPrefs.keepAliveEnabled()',
            'class KeepAliveLink {',
        ),
        'پل دارت قطع است: تنظیم روشن می‌ماند ولی هیچ‌کس سرویس را بیدار نمی‌کند',
    ),
    (
        MAIN_ACTIVITY,
        (
            '"ir.pishkan.app/keepalive"',
            'KeepAliveService.start(this, base, token)',
            'KeepAliveState.quietWhileForeground = quiet',
        ),
        'سمت اندروید پل را ثبت نمی‌کند: دارت دستور start می‌دهد و هیچ‌کس گوش نمی‌دهد، '
        'پس سوئیچ «اتصال زنده» روشن می‌ماند و بی‌عمل می‌ماند',
    ),
    (
        SHELL,
        ('unawaited(KeepAliveLink.sync())', 'KeepAliveLink.setQuiet(true)', 'KeepAliveLink.setQuiet(false)'),
        'اپ وقتی پیش‌زمینه است اعلان تکراری در نوار می‌گذارد، یا وقتی به پس‌زمینه '
        'می‌رود چیزی را بازپخش نمی‌کند — همان «اعلان دیر رسید»',
    ),
    (
        LOGOUT,
        ('await KeepAliveLink.stop();',),
        'اتصال با توکن مشتری قبلی روی گوشی اشتراکی زنده می‌ماند؛ نشتی اطلاعات، '
        'نه فقط یک اعلان اضافه',
    ),
    (
        SETTINGS,
        ('اعلان آزمایشی', "'اتصال زندهٔ بدون فایربیس'"),
        'راه چهارم هیچ جایی برای روشن/خاموش شدن ندارد؛ یعنی همان اعلان همیشگی '
        'که مشتری نمی‌خواهد، بدون رضایت او می‌آید',
    ),
    (
        LIVE_EVENT,
        ('tag: string;', 'row.dedupe_key'),
        'چارچوب زنده برچسب تاشدن را ندارد؛ پس یک پرونده هم‌زمان دو ردیف در نوار '
        'اعلان گوشی می‌سازد (یکی از فایربیس، یکی از اتصال خودمان)',
    ),
]


def _without_comments_or_strings(text: str) -> str:
    """The file with comments and string literals emptied out, line count intact.

    Enough to count braces honestly: `"}"` inside a message and a commented-out
    block both throw off a naive count, and a naive count is what let a broken
    file look balanced once already.
    """
    out: list[str] = []
    i, n = 0, len(text)
    while i < n:
        char = text[i]
        if char == '/' and i + 1 < n and text[i + 1] == '/':
            while i < n and text[i] != '\n':
                i += 1
            continue
        if char == '/' and i + 1 < n and text[i + 1] == '*':
            i += 2
            while i + 1 < n and not (text[i] == '*' and text[i + 1] == '/'):
                if text[i] == '\n':
                    out.append('\n')
                i += 1
            i += 2
            continue
        if char == '"':
            i += 1
            while i < n:
                if text[i] == '\\':
                    i += 2
                    continue
                if text[i] == '"':
                    i += 1
                    break
                if text[i] == '\n':
                    out.append('\n')
                i += 1
            continue
        out.append(char)
        i += 1
    return ''.join(out)


def main() -> int:
    failures: list[str] = []
    for path, needles, why in CHAIN + KEEP_ALIVE:
        try:
            text = path.read_text(encoding='utf-8')
        except OSError as exc:  # a moved file is also a broken chain
            failures.append(f'{path.relative_to(ROOT)}: خوانده نشد ({exc}) — {why}')
            continue
        for needle in needles:
            if needle not in text:
                failures.append(f'{path.relative_to(ROOT)}: «{needle}» یافت نشد — {why}')

    # The local test notification must NOT be acked: it has no row in
    # `notifications`, and a client reporting an id it invented is exactly the
    # noise the ownership guard exists for.
    notifier = NOTIFIER.read_text(encoding='utf-8')
    test_body = notifier.split('static Future<bool> showTestNotification()')[-1].split('static Future<void> _showSystem')[0]
    if 'ackShown' in test_body:
        failures.append(
            f'{NOTIFIER.relative_to(ROOT)}: «اعلان آزمایشی» هم تأیید تحویل می‌فرستد — '
            'این رکوردی در جدول ندارد و گزارش تحویل را پر از خطای الکی می‌کند',
        )

    # `KeepAlive` is a widget class of Flutter's own (package:flutter/widgets,
    # re-exported by material.dart). A screen importing both it and keepalive.dart
    # resolves `KeepAlive.foo` to neither, and the analyzer calls that an error — in
    # a repo where nothing but CI can see it. Comments are exempt: a sentence about
    # the old name is not a compile error, and making the prose dodge it would only
    # make the docs worse.
    for path in (KEEPALIVE_DART, SHELL, SETTINGS, LOGOUT, MAIN_ACTIVITY):
        code = '\n'.join(line.split('//')[0] for line in path.read_text(encoding='utf-8').splitlines())
        if 'KeepAlive.' in code:
            failures.append(
                f'{path.relative_to(ROOT)}: هنوز «KeepAlive.» نوشته می‌شود — نامِ خودِ فلاتر '
                '(یک ویجت در package:flutter/widgets) که با material.dart در یک فایل '
                'ambiguous_import می‌سازد و فقط در CI لو می‌رود؛ نامِ دارت «KeepAliveLink» است'
            )

    # Nothing in this environment compiles Kotlin, so the *shape* of the bridge is
    # checked rather than trusting that it parses. One `}` too early pushed the
    # keep-alive handler out of `configureFlutterEngine` and CI answered with five
    # "Expecting member declaration" errors — after a release tag had been pushed.
    depth = 0
    for line in _without_comments_or_strings(MAIN_ACTIVITY.read_text(encoding='utf-8')).splitlines():
        opened_at = depth
        depth += line.count('{') - line.count('}')
        code = line.strip()
        if code.startswith('MethodChannel(flutterEngine') and opened_at < 2:
            failures.append(
                f'{MAIN_ACTIVITY.relative_to(ROOT)}: ثبتِ MethodChannel بیرون از بدنهٔ '
                f'configureFlutterEngine افتاده (عمق {opened_at} نه ۲)؛ کاتلین این را '
                '«Expecting member declaration» می‌خواند و ساخت APK می‌شکند'
            )
        if code.startswith('override fun ') and opened_at != 1:
            failures.append(
                f'{MAIN_ACTIVITY.relative_to(ROOT)}: «{code[:40]}» در عمق {opened_at} است نه ۱ — '
                'یعنی یک آکولادِ اضافه پیش از آن، بدنهٔ کلاس را زود بسته'
            )
    if depth != 0:
        failures.append(
            f'{MAIN_ACTIVITY.relative_to(ROOT)}: عمق آکولاد در پایان فایل {depth} است نه صفر — '
            'ساختار فایل شکسته است'
        )

    if failures:
        print(f'delivery ack chain: {len(failures)} problem(s)')
        for failure in failures:
            print(f'  ✗ {failure}')
        return 1
    checked = sum(len(needles) for _, needles, _ in CHAIN + KEEP_ALIVE) + 5
    print(f'delivery ack chain: ok ({checked} invariant(s) checked)')
    return 0


if __name__ == '__main__':
    sys.exit(main())
