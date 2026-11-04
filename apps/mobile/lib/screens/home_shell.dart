import 'package:flutter/material.dart';

import '../services/services.dart';
import 'home.dart';
import 'login.dart';
import 'profile.dart';
import 'requests.dart';
import 'services_catalog.dart';
import 'support.dart';

/// Main customer shell: five bottom tabs exactly like the mobile web —
/// dashboard, services, my requests, support, profile.
class HomeShell extends StatefulWidget {
  const HomeShell({super.key});

  @override
  State<HomeShell> createState() => _HomeShellState();
}

class _HomeShellState extends State<HomeShell> {
  int _index = 0;

  @override
  void initState() {
    super.initState();
    session.addListener(_sessionChanged);
  }

  @override
  void dispose() {
    session.removeListener(_sessionChanged);
    super.dispose();
  }

  void _sessionChanged() {
    if (!session.isSignedIn && mounted) {
      Navigator.pushAndRemoveUntil(context, MaterialPageRoute(builder: (_) => const LoginScreen()), (_) => false);
    }
  }

  void _selectTab(int index) => setState(() => _index = index);

  @override
  Widget build(BuildContext context) {
    final pages = <Widget>[
      HomeTab(onOpenTab: _selectTab),
      const ServicesCatalogTab(),
      const RequestsTab(),
      const SupportTab(),
      const ProfileTab(),
    ];
    return PopScope(
      canPop: _index == 0,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop && _index != 0) _selectTab(0);
      },
      child: Scaffold(
        body: IndexedStack(index: _index, children: pages),
        bottomNavigationBar: NavigationBar(
          selectedIndex: _index,
          onDestinationSelected: _selectTab,
          destinations: const [
            NavigationDestination(icon: Icon(Icons.home_outlined), selectedIcon: Icon(Icons.home_rounded), label: 'خانه'),
            NavigationDestination(icon: Icon(Icons.grid_view_outlined), selectedIcon: Icon(Icons.grid_view_rounded), label: 'خدمات'),
            NavigationDestination(icon: Icon(Icons.folder_open_outlined), selectedIcon: Icon(Icons.folder_rounded), label: 'درخواست‌های من'),
            NavigationDestination(icon: Icon(Icons.support_agent_outlined), selectedIcon: Icon(Icons.support_agent_rounded), label: 'پشتیبانی'),
            NavigationDestination(icon: Icon(Icons.person_outline_rounded), selectedIcon: Icon(Icons.person_rounded), label: 'پروفایل'),
          ],
        ),
      ),
    );
  }
}
