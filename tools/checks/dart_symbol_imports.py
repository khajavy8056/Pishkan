#!/usr/bin/env python3
"""Catch symbols used without their import.

`dart_imports.py` checks that every identifier resolves to *something*
imported. It cannot see the opposite mistake: a file that calls a symbol it
never imported, because the symbol exists elsewhere in the project. That is
exactly how a whole page shipped referencing `context.sizes`,
`BrandBackdrop` and `PressableScale` with none of the three imported -- the
file simply would not compile, and the failure only surfaced on CI, where
the log was not retrievable.

This checks a fixed table of project symbols that must be backed by a
specific import. It is deliberately narrow: a full resolver would re-implement
the Dart analyzer, and the point is to catch the handful of helpers this app
introduces often enough to forget.

Usage:
    python3 tools/checks/dart_symbol_imports.py $(find apps/mobile/lib -name '*.dart')
"""

import re
import sys

# symbol -> module that defines it
SYMBOLS = {
    'context.sizes': 'core/sizes.dart',
    'Sizes.of': 'core/sizes.dart',
    'BrandBackdrop': 'widgets/screen_header.dart',
    'ScreenHeading': 'widgets/screen_header.dart',
    'FloatingIconButton': 'widgets/screen_header.dart',
    'StaggeredReveal': 'core/motion.dart',
    'PressableScale': 'core/motion.dart',
    'RevealOnMount': 'core/motion.dart',
    'SoftSwitcher': 'core/motion.dart',
    'fadeThroughRoute': 'core/motion.dart',
    'ShimmerBox': 'core/motion.dart',
    'AvatarPickerScreen': 'screens/avatar_picker.dart',
    'ServiceSearchScreen': 'screens/services_catalog.dart',
    'ServicesCatalogTab': 'screens/services_catalog.dart',
    'ServiceDetailScreen': 'screens/service_detail.dart',
    'RequestDetailScreen': 'screens/request_detail.dart',
    'BannerRoute': 'widgets/banner_route.dart',
    'AppBanner': 'models/models.dart',
    'EditProfileScreen': 'screens/profile.dart',
    'NotificationsScreen': 'screens/notifications.dart',
    'AssistantScreen': 'screens/assistant.dart',
    'faMobileSpaced': 'core/format.dart',
    'fetchMe': 'services/services.dart',
}


def check(paths):
    problems = []
    for path in paths:
        src = open(path, encoding='utf-8').read()
        body = re.sub(r'^import .*$', '', src, flags=re.M)
        for symbol, module in SYMBOLS.items():
            if symbol not in body:
                continue
            base = module.rsplit('/', 1)[-1]
            if path.endswith(base):
                continue                      # the defining file itself
            if re.search(r"^import '[^']*" + re.escape(base) + r"'", src, re.M):
                continue
            problems.append(f'{path}: uses `{symbol}` but does not import {module}')
    return problems


def main(argv):
    if not argv:
        print('usage: dart_symbol_imports.py <file.dart> [...]')
        return 2
    problems = check(argv)
    if problems:
        for p in problems:
            print('  ' + p)
        print(f'--- {len(problems)} missing import(s)')
        return 1
    print('--- 0 missing imports')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
