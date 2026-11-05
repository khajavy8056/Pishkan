import 'package:flutter/foundation.dart';

/// A story can be opened above the shell (including from notification history).
/// Notify the mounted shell so completing it selects the home tab as well as
/// closing the routes above it.
final ValueNotifier<int> homeNavigationRequests = ValueNotifier<int>(0);

void requestHomeTab() => homeNavigationRequests.value++;
