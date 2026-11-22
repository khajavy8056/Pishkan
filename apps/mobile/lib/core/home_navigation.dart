import 'package:flutter/foundation.dart';

/// A story can be opened above the shell (including from notification history).
/// Notify the mounted shell so completing it selects the home tab as well as
/// closing the routes above it.
final ValueNotifier<int> homeNavigationRequests = ValueNotifier<int>(0);

void requestHomeTab() => homeNavigationRequests.value++;

/// Ask the shell to switch to a specific bottom tab (0 home, 1 services,
/// 2 requests, 3 profile). Used by the assistant's shortcuts, which answer
/// "where do I do this?" and then genuinely take the customer there.
final ValueNotifier<int?> homeTabRequests = ValueNotifier<int?>(null);

void requestHomeTabIndex(int index) => homeTabRequests.value = index;
