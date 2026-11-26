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


def main() -> int:
    failures: list[str] = []
    for path, needles, why in CHAIN:
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

    if failures:
        print(f'delivery ack chain: {len(failures)} problem(s)')
        for failure in failures:
            print(f'  ✗ {failure}')
        return 1
    checked = sum(len(needles) for _, needles, _ in CHAIN) + 1
    print(f'delivery ack chain: ok ({checked} invariant(s) checked)')
    return 0


if __name__ == '__main__':
    sys.exit(main())
