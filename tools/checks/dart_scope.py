#!/usr/bin/env python3
"""Heuristic Dart scope check.

No Dart SDK is reachable in this sandbox, so this stands in for the analyzer on
the one class of error that actually breaks the build: an identifier that is
*not* declared anywhere in scope. We cannot type-check, but we can catch

    color: context.isDark      // inside a method with no `context` parameter
    _foo.bar                   // `_foo` only exists in another class
    unknownHelper(x)           // a function nobody defined

by collecting, per file, the set of names each class and method is allowed to
see, and then flagging identifiers used inside a method body that are neither
local, nor a parameter, nor a field of the enclosing class, nor a top-level
name, nor a known Flutter/Dart API.

Usage: python3 tools/checks/dart_scope.py apps/mobile/lib [--all]
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

# ---------------------------------------------------------------- API surface
# Not exhaustive: this is the set of names that appear in this app. Anything a
# template action legitimately sees from the Flutter SDK can be added here.
DART_CORE = {
    'String', 'int', 'double', 'num', 'bool', 'List', 'Map', 'Set', 'Future',
    'Stream', 'Object', 'dynamic', 'void', 'Null', 'Type', 'Function',
    'Duration', 'DateTime', 'RegExp', 'Uri', 'Exception', 'Error', 'Iterable',
    'Iterator', 'Comparable', 'Comparable', 'Never', 'Record', 'Symbol',
    'StringBuffer', 'BigInt', 'Stopwatch', 'Timer', 'Zone', 'StackTrace',
    'identical', 'print', 'throw', 'return', 'await', 'async', 'yield', 'sync',
    'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'default', 'break',
    'continue', 'try', 'catch', 'finally', 'new', 'const', 'final', 'var',
    'late', 'static', 'abstract', 'class', 'enum', 'mixin', 'extension',
    'typedef', 'import', 'export', 'library', 'part', 'with', 'implements',
    'extends', 'required', 'covariant', 'factory', 'operator', 'get', 'set',
    'this', 'super', 'null', 'true', 'false', 'is', 'as', 'in', 'assert',
    'rethrow', 'deferred', 'show', 'hide', 'on', 'sealed', 'base', 'interface',
    'when', 'external', 'augment', 'await', 'else', 'do', 'case',
}

FLUTTER_API = {
    'Widget', 'BuildContext', 'State', 'StatelessWidget', 'StatefulWidget',
    'Key', 'ValueKey', 'GlobalKey', 'UniqueKey', 'PageStorageKey',
    'Color', 'Colors', 'MaterialColor', 'MaterialAccentColor', 'Paint',
    'Offset', 'Size', 'Rect', 'RRect', 'Radius', 'BorderRadius',
    'BorderRadiusGeometry', 'BorderRadiusDirectional', 'EdgeInsets',
    'EdgeInsetsGeometry', 'EdgeInsetsDirectional', 'Alignment',
    'AlignmentGeometry', 'AlignmentDirectional', 'TextStyle', 'TextAlign',
    'TextDirection', 'TextOverflow', 'FontWeight', 'FontStyle', 'TextBaseline',
    'TextHeightBehavior', 'BoxConstraints', 'BoxDecoration', 'BoxShape',
    'Decoration', 'DecorationImage', 'Border', 'BorderSide', 'BorderStyle',
    'BoxShadow', 'Shadow', 'Gradient', 'LinearGradient', 'RadialGradient',
    'SweepGradient', 'Curves', 'Matrix4', 'Vector3', 'Transform',
    'MainAxisAlignment', 'MainAxisSize', 'CrossAxisAlignment',
    'WrapAlignment', 'WrapCrossAlignment', 'Axis', 'AxisAlignment',
    'StackFit', 'Clip', 'HitTestBehavior', 'BoxFit', 'ImageRepeat',
    'FilterQuality', 'BlendMode', 'PaintingStyle', 'StrokeCap', 'StrokeJoin',
    'TextInputType', 'TextInputAction', 'TextCapitalization', 'InputDecoration',
    'SnackBar', 'SnackBarBehavior', 'SnackBarAction', 'ScaffoldMessenger',
    'ScaffoldMessengerState', 'Scaffold', 'AppBar', 'MaterialApp', 'Theme',
    'ThemeData', 'ThemeMode', 'MaterialPageRoute', 'PageRoute',
    'RouteSettings', 'Navigator', 'NavigatorState', 'Route',
    'Container', 'Padding', 'Center', 'Align', 'Column', 'Row', 'Expanded',
    'Flexible', 'Spacer', 'SizedBox', 'Stack', 'Positioned',
    'PositionedDirectional', 'IndexedStack', 'ListView', 'ListView.builder',
    'GridView', 'Wrap', 'Text', 'RichText', 'TextSpan', 'TextEditingController',
    'Icon', 'Icons', 'Image', 'ImageProvider', 'DecorationImage',
    'CircleAvatar', 'Divider', 'VerticalDivider', 'Badge', 'Tooltip',
    'InkWell', 'InkResponse', 'GestureDetector', 'Dismissible',
    'TextButton', 'ElevatedButton', 'OutlinedButton', 'IconButton',
    'FilledButton', 'FloatingActionButton', 'MaterialButton', 'CloseButton',
    'TextFormField', 'TextField', 'Form', 'FormState',
    'InputDecorationTheme', 'Checkbox', 'Switch', 'SwitchListTile',
    'CheckboxListTile', 'Radio', 'RadioListTile', 'Slider', 'DropdownButton',
    'DropdownButtonFormField', 'DropdownMenuItem', 'Chip', 'ChoiceChip',
    'ActionChip', 'FilterChip', 'InputChip', 'PopupMenuButton', 'PopupMenuItem',
    'CircularProgressIndicator', 'LinearProgressIndicator', 'RefreshIndicator',
    'ScrollController', 'ScrollPosition', 'ScrollPhysics',
    'NeverScrollableScrollPhysics', 'AlwaysScrollableScrollPhysics',
    'BouncingScrollPhysics', 'ClampingScrollPhysics', 'ScrollView',
    'SingleChildScrollView', 'CustomScrollView', 'SliverList',
    'SliverChildListDelegate', 'SliverToBoxAdapter', 'SliverPadding',
    'SliverAppBar', 'FlexibleSpaceBar', 'TabController', 'TabBar', 'TabBarView',
    'PageController', 'PageView', 'AnimatedContainer', 'AnimatedOpacity',
    'AnimatedSwitcher', 'AnimatedCrossFade', 'AnimatedPositioned',
    'AnimatedBuilder', 'AnimatedDefaultTextStyle', 'Animation',
    'AnimationController', 'Tween', 'TweenAnimationBuilder', 'Curve',
    'TickerProvider', 'SingleTickerProviderStateMixin',
    'TickerProviderStateMixin', 'WidgetsBinding', 'WidgetsBindingObserver',
    'AppLifecycleState', 'FocusNode', 'FocusScope', 'MediaQuery',
    'MediaQueryData', 'SafeArea', 'Material', 'Ink', 'Card', 'ListTile',
    'Drawer', 'BottomSheet', 'showModalBottomSheet', 'showDialog', 'AlertDialog',
    'SimpleDialog', 'Dialog', 'Semantics', 'ExcludeSemantics',
    'MergeSemantics', 'ClipRRect', 'ClipOval', 'ClipPath', 'ClipRect',
    'DecoratedBox', 'CustomPaint', 'CustomPainter', 'CustomClipper',
    'LayoutBuilder', 'Builder', 'StreamBuilder', 'FutureBuilder',
    'ValueListenableBuilder', 'ListenableBuilder', 'StatefulBuilder',
    'InheritedWidget', 'ChangeNotifier', 'ValueNotifier', 'ValueListenable',
    'Listenable', 'Localizations', 'LocalizationsDelegate', 'Locale',
    'RotatedBox', 'Transform.rotate', 'BackdropFilter', 'ImageFilter',
    'Opacity', 'IgnorePointer', 'AbsorbPointer', 'FractionallySizedBox',
    'ConstrainedBox', 'UnconstrainedBox', 'LimitedBox', 'OverflowBox',
    'AspectRatio', 'FittedBox', 'Placeholder', 'Visibility', 'Offstage',
    'TickerMode', 'RepaintBoundary', 'PopScope', 'WillPopScope', 'Notification',
    'ScrollNotification', 'ScrollMetricsNotification', 'ScrollMetrics',
    'Tab', 'TabPageSelector', 'Stepper', 'StepperType', 'ReorderableListView',
    'SelectableText', 'Autocomplete', 'RawAutocomplete', 'MenuAnchor',
    'MenuItemButton', 'SubmenuButton', 'ToggleButtons', 'SegmentedButton',
    'ButtonSegment', 'ButtonStyle', 'MaterialStateProperty',
    'WidgetStateProperty', 'WidgetStatePropertyAll', 'MaterialStatePropertyAll',
    'WidgetState', 'MaterialState', 'OutlinedButton.styleFrom',
    'SystemUiOverlayStyle', 'SystemChrome', 'DeviceOrientation',
    'HapticFeedback', 'MethodChannel', 'MethodCall', 'PlatformException',
    'MissingPluginException', 'BinaryMessenger', 'ServicesBinding',
    'Clipboard', 'ClipboardData', 'rootBundle', 'AssetBundle',
    'DefaultAssetBundle', 'FlutterError', 'ErrorWidget', 'ErrorWidgetBuilder',
    'ImageErrorWidgetBuilder', 'NonNullableByDefault', 'StackTrace',
    'NetworkImage', 'FileImage', 'AssetImage', 'MemoryImage',
    'ColorFilter', 'ColorFiltered', 'Locale',
}

PACKAGE_API = {
    # dio
    'Dio', 'BaseOptions', 'Options', 'RequestOptions', 'Response', 'DioException',
    'DioError', 'CancelToken', 'Headers', 'FormData', 'MultipartFile',
    # shared_preferences
    'SharedPreferences', 'SharedPreferencesAsync',
    # secure storage
    'FlutterSecureStorage', 'AndroidOptions', 'IOSOptions',
    # local notifications
    'FlutterLocalNotificationsPlugin', 'AndroidInitializationSettings',
    'InitializationSettings', 'NotificationDetails',
    'AndroidNotificationDetails', 'DarwinNotificationDetails',
    'BigTextStyleInformation', 'InboxStyleInformation',
    'RawResourceAndroidNotificationSound',
    'UriAndroidNotificationSound', 'DrawableResourceAndroidBitmap',
    'AndroidFlutterLocalNotificationsPlugin', 'AndroidNotificationChannel',
    'Importantnance', 'Importance', 'Priority', 'NotificationAppLaunchDetails',
    'NotificationResponse', 'ActiveNotification', 'LinuxInitializationSettings',
    # workmanager
    'Workmanager', 'Constraints', 'NetworkType',
    'ExistingPeriodicWorkPolicy', 'ExistingWorkPolicy', 'BackoffPolicy',
    'Worker', 'WorkerParameters', 'WorkmanagerCallback',
    # cached images
    'CachedNetworkImage', 'CachedNetworkImageProvider',
    'CachedNetworkImageProgress',
    # image picker / cropper / files
    'ImagePicker', 'ImageSource', 'XFile', 'ImageCropper', 'CropStyle',
    'CroppedFile', 'AndroidUiSettings', 'IOUiSettings', 'IOSUiSettings',
    'FilePicker', 'FilePickerResult', 'PlatformFile', 'FileType',
    'OpenFilex', 'OpenResult',
    # permissions / device
    'PackageInfo', 'DeviceInfoPlugin', 'AndroidDeviceInfo', 'IosDeviceInfo',
    'InternetAddressType', 'Connectivity', 'ConnectivityResult',
    'MobileScanner', 'MobileScannerController', 'Barcode', 'CameraController',
    'CameraPreview', 'CameraDescription', 'ResolutionPreset',
    'availableCameras', 'VideoPlayerController', 'VideoPlayer', 'VideoPlayerValue',
    # auth
    'LocalAuthentication', 'AuthenticationOptions', 'BiometricType',
    # webview / links
    'UrlLauncher', 'launchUrl', 'LaunchMode', 'WebViewController', 'WebViewWidget',
    'InAppWebViewController', 'InAppWebView', 'InAppWebViewSettings',
    'Share', 'SharePlus', 'ShareParams', 'uuid', 'Uuid', 'flutterLocalNotificationsPlugin',
    'GetIt', 'Provider', 'Consumer',
}

KNOWN = DART_CORE | FLUTTER_API | PACKAGE_API

DECL_RE = re.compile(
    r'^(?:(?:abstract|sealed|base|final|interface)\s+)?(?:class|mixin|enum|extension)\s+(\w+)',
    re.M,
)
TOP_FUNC_RE = re.compile(
    r'^(?!(?:class|mixin|enum|extension|typedef|import|export|library|part|//|/\*|\s))\s*'
    r'(?:@\w+(?:\([^)]*\))?\s*)*'
    r'(?:Future<[^>]*>|Stream<[^>]*>|void|bool|int|double|num|String|Widget|'
    r'Map<[^>]*>|List<[^>]*>|Set<[^>]*>|dynamic|Object\??|[A-Z]\w+\??)\s+'
    r'(\w+)\s*\(',
    re.M,
)
TOP_VAR_RE = re.compile(r'^(?:const|final|var)\s+[\w<>?,\s]+\s+(\w+)\s*=', re.M)
FIELD_RE = re.compile(r'^\s*(?:final|const|late|static|var)\s+[\w<>?,\s\[\]]+\s+(\w+)\s*[;=]', re.M)
PARAM_RE = re.compile(r'(?:this\.)?(\w+)\s*(?:=\s*[^,)\]]+)?(?=[,)])')
LOCAL_RE = re.compile(r'\b(?:final|const|var|late)\s+[\w<>?,\s\[\]]*?\b(\w+)\s*=')
FOR_RE = re.compile(r'\bfor\s*\(\s*(?:final|var|const)\s+[\w<>?,\s\[\]]*?\b(\w+)\s+in\b')

IDENT_RE = re.compile(r'(?<![\w.$])(_?[a-zA-Z]\w*)\b(?!\s*:)')

SKIP_LINE_PREFIXES = ('//', '*', '/*', 'import ', 'export ', 'part ', 'library ')


def strip_comments_and_strings(src: str) -> str:
    """Blank out comments and string bodies so identifiers inside them vanish."""
    out = []
    i, n = 0, len(src)
    while i < n:
        c = src[i]
        if c == '/' and i + 1 < n and src[i + 1] == '/':
            while i < n and src[i] != '\n':
                i += 1
        elif c == '/' and i + 1 < n and src[i + 1] == '*':
            depth = 1
            i += 2
            while i < n and depth:
                if src[i] == '/' and i + 1 < n and src[i + 1] == '*':
                    depth += 1
                    i += 2
                elif src[i] == '*' and i + 1 < n and src[i + 1] == '/':
                    depth -= 1
                    i += 2
                else:
                    i += 1
        elif c in ('"', "'"):
            triple = src[i:i + 3] in ('"""', "'''")
            quote = src[i:i + 3] if triple else c
            i += len(quote)
            while i < n:
                if src[i] == '\\':
                    i += 2
                    continue
                if src[i:i + len(quote)] == quote:
                    i += len(quote)
                    break
                i += 1
            out.append('""')
        else:
            out.append(c)
            i += 1
    return ''.join(out)


def scopes(src: str):
    """Yield (class_name, body_start, body_end) for each top-level class."""
    for match in re.finditer(r'^(?:(?:abstract|sealed|base|final)\s+)?class\s+(\w+)([^{]*)\{', src, re.M):
        start = match.end() - 1
        depth = 0
        index = start
        while index < len(src):
            if src[index] == '{':
                depth += 1
            elif src[index] == '}':
                depth -= 1
                if depth == 0:
                    break
            index += 1
        yield match.group(1), match.group(2), start, index


def check_file(path: Path, report) -> int:
    raw = path.read_text(encoding='utf-8')
    src = strip_comments_and_strings(raw)
    top_names = set(DECL_RE.findall(src)) | set(TOP_FUNC_RE.findall(src)) | set(TOP_VAR_RE.findall(src))
    # imports make foreign names legal; we cannot resolve them, so treat any
    # Capitalised name as declared by a package.
    problems = 0
    for cls, _header, start, end in scopes(src):
        body = src[start:end]
        fields = set(FIELD_RE.findall(body))
        # methods: name -> (params, body)
        for m in re.finditer(r'\b([\w<>?,\s\[\]]+?)\s+(_?\w+)\s*\(([^)]*)\)\s*(?:async\*?|sync\*?)?\s*\{', body):
            params = set(PARAM_RE.findall(m.group(3)))
            mstart = m.end() - 1
            depth, i = 0, mstart
            while i < len(body):
                if body[i] == '{':
                    depth += 1
                elif body[i] == '}':
                    depth -= 1
                    if depth == 0:
                        break
                i += 1
            mbody = body[mstart:i]
            local = params | set(LOCAL_RE.findall(mbody)) | set(FOR_RE.findall(mbody))
            local |= {'context'} if 'context' not in params and False else set()
            allowed = local | fields | top_names | KNOWN | {cls}
            for ident in set(IDENT_RE.findall(mbody)):
                if ident in allowed or ident.isdigit():
                    continue
                if ident in ('true', 'false', 'null', 'async', 'await', 'return', 'new', 'const', 'final', 'var', 'late', 'static', 'if', 'else', 'for', 'while', 'switch', 'case', 'break', 'continue', 'try', 'catch', 'finally', 'throw', 'this', 'super', 'is', 'as', 'in', 'get', 'set', 'required', 'override', 'factory', 'operator', 'typedef', 'enum', 'class', 'mixin', 'with', 'extends', 'implements', 'on', 'show', 'hide', 'import', 'export', 'library', 'part', 'deferred', 'assert', 'rethrow', 'yield', 'sync', 'when', 'sealed', 'base', 'interface', 'external', 'augment', 'do', 'default', 'void', 'dynamic', 'extends'):
                    continue
                if ident[0].isupper():
                    continue  # package/Flutter class: cannot resolve without deps
                report.append((str(path), cls, m.group(2), ident))
                problems += 1
    return problems


def main(argv):
    root = Path(argv[1] if len(argv) > 1 else 'apps/mobile/lib')
    files = sorted(root.rglob('*.dart'))
    report = []
    for path in files:
        check_file(path, report)
    for path, cls, method, ident in report:
        print(f'{path}: {cls}.{method}: undeclared `{ident}`')
    print(f'--- {len(files)} files, {len(report)} suspect identifiers')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
