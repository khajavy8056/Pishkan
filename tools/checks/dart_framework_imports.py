#!/usr/bin/env python3
"""Framework-supplied symbols that `package:flutter/material.dart` does NOT hand you,
and the tween signatures the analyzer enforces on `TweenAnimationBuilder`.

Why this gate exists. `material.dart` → `widgets.dart` re-exports the rendering library
through a *curated* `show` list: `RenderBox`, `PaintingContext`, `Offset`, `Rect`, `ClipRRect`
arrive on their own, but `RenderProxyBox` and `PipelineOwner` do not — a file that
`extends RenderProxyBox` or takes a `PipelineOwner` parameter compiles only if it imports
`package:flutter/rendering.dart` itself. `check_dart.py` cannot see this: it verifies imports
that *were* written, not ones that were forgotten, and it only knows classes that live in
`lib/`. So `tools/check_mobile.py` stayed 17/17 green while the release tag died in
`flutter analyze` with `extends_non_class` on the superclass that had no importer, plus the
cascade of `undefined_identifier` on every member it would have supplied (the `attach`
signature against a missing superclass reads as `invalid_override` + `override_on_non_overriding_member`).

Both rules are written from a verified fact, not a guess about the SDK:

* `REQUIRES_EXPLICIT_IMPORT` rows are the symbols `android-v1.21.5` reported as
  `undefined_identifier`/`undefined_class` with only `material.dart` in scope.
  `REQUIRES_ANY_OF` accepts any library that really provides the symbol, so widening
  a file's own import choice is never punished.
* `CONCRETE_TWEENS` holds `RectTween`, whose element type is `Rect?` — `android-v1.21.4`
  failed `argument_type_not_assignable` when `TweenAnimationBuilder<Rect>` was handed a
  `RectTween`. A plain `Tween(...)` with no explicit type argument is deliberately skipped:
  the builder's parameter type flows into it, and inferring from bare literals is Dart-legal.

Usage: python3 dart_framework_imports.py <lib-dir>   (default: apps/mobile/lib)
"""
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from dart_class_imports import strip_comments  # noqa: E402

# symbol -> the import URIs that provide it (any one of them satisfies the use)
REQUIRES_EXPLICIT_IMPORT = {
    "RenderProxyBox": ["package:flutter/rendering.dart"],
    "PipelineOwner": ["package:flutter/rendering.dart"],
    "RenderObject": ["package:flutter/rendering.dart"],
    "ContainerLayer": ["package:flutter/layers.dart", "package:flutter/rendering.dart"],
    "OpacityLayer": ["package:flutter/layers.dart", "package:flutter/rendering.dart"],
    "AbstractNode": ["package:flutter/foundation.dart", "package:flutter/rendering.dart"],
}

# tween class -> the element type `TweenAnimationBuilder<T>` must be given
CONCRETE_TWEENS = {"RectTween": "Rect?", "ColorTween": "Color?"}

FILE_RE = re.compile(r"\.dart$")
IDENT_TAIL = r"(?![\w$])"


def dart_files(target: Path):
    if target.is_file():
        return [target]
    return [p for p in sorted(target.rglob("*.dart")) if FILE_RE.search(str(p))]


def import_uris(body: str):
    return re.findall(r"""^\s*import\s+['"]([^'"]+)['"]""", body, re.M)


def check(target: Path):
    problems = []
    for path in dart_files(target):
        if str(path).endswith(("g.dart", "mocks.dart")):
            continue
        source = path.read_text(encoding="utf-8")
        body = strip_comments(source)
        # Import URIs are read from the raw source: `strip_comments` blanks string
        # literals too, which is what makes it safe for identifier scanning.
        uris = import_uris(source)
        rel = path.relative_to(target)

        for sym, uris_that_provide in sorted(REQUIRES_EXPLICIT_IMPORT.items()):
            used = re.search(r"\b" + sym + IDENT_TAIL, body)
            if not used:
                continue
            if any(any(u == provide or u.startswith(provide) for u in uris) for provide in uris_that_provide):
                continue
            line = body[: used.start()].count("\n") + 1
            also = f" or {', '.join(uris_that_provide[1:])}" if len(uris_that_provide) > 1 else ""
            problems.append(
                f"{rel}:{line}: `{sym}` is not re-exported by package:flutter/material.dart — "
                f"add `import '{uris_that_provide[0]}';`{also}"
            )

        # TweenAnimationBuilder<T>(tween: SomeTween(...)) — T must be the tween's element type
        for m in re.finditer(r"TweenAnimationBuilder<\s*([^>]+?)\s*>\s*\(", body):
            declared = m.group(1).strip()
            tail = body[m.end() : m.end() + 400]
            t = re.search(r"\btween:\s*([A-Za-z_]\w*)(?:<\s*([^>]+?)\s*>)?\s*\(", tail)
            if not t:
                continue
            name, explicit = t.group(1), (t.group(2) or "").strip()
            actual = explicit
            if not actual:
                actual = CONCRETE_TWEENS.get(name, "")
            if not actual:
                continue
            if actual != declared:
                line = body[: m.start()].count("\n") + 1
                problems.append(
                    f"{rel}:{line}: TweenAnimationBuilder<{declared}> given a {name}, which is a "
                    f"Tween<{actual}> — argument_type_not_assignable. Declare the builder as "
                    f"TweenAnimationBuilder<{actual}> or cast at the use site."
                )
    return problems


def main() -> int:
    target = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("apps/mobile/lib")
    problems = check(target)
    if problems:
        for p in problems:
            print(p)
        print(f"flutter framework imports — {len(problems)} problem(s)")
        return 1
    print("flutter framework imports — ok")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
