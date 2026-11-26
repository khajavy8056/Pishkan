#!/usr/bin/env python3
"""Guard the web/Android parity of the assistant contract.

The assistant is the only feature whose contract is rendered by two clients
written in different languages. A rename on the server (a draft endpoint, a
card type, the `awaiting_confirmation` stage) is caught by the API tests for
the *server*, but nothing else fails when the Flutter side keeps calling the
old name — the app simply shows a draft that never leaves «collecting».

This check asserts that the Dart client still speaks the same draft lifecycle
and card vocabulary as the API. It is deliberately a list of exact strings:
they are the parts of the contract that must match, and a new one is easy to
add next to the rest.

Usage:
    python3 tools/checks/dart_assistant_contract.py
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
LIB = ROOT / 'apps' / 'mobile' / 'lib'

SERVICES = LIB / 'services' / 'services.dart'
SCREEN = LIB / 'screens' / 'assistant.dart'
MODELS = LIB / 'models' / 'models.dart'

# (file, required substring, why it matters)
REQUIREMENTS: list[tuple[Path, str, str]] = [
    (SERVICES, "'/api/assistant/draft'", 'بدون این مسیر، اپ نمی‌تواند پیش‌نویس بسازد یا بخواند'),
    (SERVICES, "'/api/assistant/draft/preview'", 'پیش‌نمایش سمت سرور از اپ صدا زده نمی‌شود'),
    (SERVICES, "'/api/assistant/draft/confirm'", 'تنها مسیر ثبت واقعی از اپ حذف شده است'),
    (SERVICES, "'/api/assistant/draft/cancel'", 'لغو پیش‌نویس از اپ ممکن نیست'),
    (SERVICES, "'/api/assistant/draft/documents'", 'پیوست مدرک به پیش‌نویس از اپ ممکن نیست'),
    (SERVICES, "'confirm': true", 'پرچم تأیید صریح ارسال نمی‌شود'),
    (MODELS, "'awaiting_confirmation'", 'اپ مرحلهٔ آمادهٔ تأیید را تشخیص نمی‌دهد'),
    (MODELS, "'collecting'", 'اپ مرحلهٔ تکمیل اطلاعات را تشخیص نمی‌دهد'),
    (SCREEN, 'awaitingConfirmation', 'مرحلهٔ آمادهٔ تأیید در رابط استفاده نمی‌شود'),
    (SCREEN, "'تأیید و ثبت نهایی'", 'دکمهٔ تأیید صریح در رابط نیست'),
    (SCREEN, "pickDocumentFile", 'بارگذاری مدرک در پیش‌نویس از اپ حذف شده است'),
    (MODELS, 'class AssistantDraft', 'مدل پیش‌نویس از اپ حذف شده است'),
    (MODELS, 'class AssistantAction', 'مدل اقدام سرور از اپ حذف شده است'),
    (MODELS, 'class AssistantCard', 'مدل کارت‌های ساختاریافته از اپ حذف شده است'),
]

# Every card type the server can send; the Dart screen must know each one, or
# that answer renders as an empty bubble on Android while the web shows it.
CARD_TYPES = ['service', 'case', 'invoice', 'wallet', 'profile', 'ticket', 'catalog']


def main() -> int:
    failures: list[str] = []
    for path, needle, why in REQUIREMENTS:
        text = path.read_text(encoding='utf-8')
        if needle not in text:
            failures.append(f'{path.relative_to(ROOT)}: «{needle}» یافت نشد — {why}')

    screen = SCREEN.read_text(encoding='utf-8')
    models = MODELS.read_text(encoding='utf-8')
    for card in CARD_TYPES:
        # The model recognises the wire value; the screen renders the getter.
        getter = 'is' + card.capitalize()
        if f"type == '{card}'" not in models:
            failures.append(
                f'{MODELS.relative_to(ROOT)}: نوع کارت «{card}» در مدل شناخته نمی‌شود — '
                'این پاسخ در اندروید خالی می‌ماند در حالی که وب آن را نشان می‌دهد',
            )
        if getter not in screen:
            failures.append(
                f'{SCREEN.relative_to(ROOT)}: کارت «{card}» در رابط رندر نمی‌شود ({getter} استفاده نشده)',
            )

    if failures:
        print(f'dart assistant contract: {len(failures)} problem(s)')
        for failure in failures:
            print(f'  ✗ {failure}')
        return 1
    print(f'dart assistant contract: ok ({len(REQUIREMENTS) + len(CARD_TYPES)} invariant(s) checked)')
    return 0


if __name__ == '__main__':
    sys.exit(main())
