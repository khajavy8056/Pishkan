import 'package:flutter/material.dart';

import '../core/home_navigation.dart';
import 'chat.dart';
import 'documents.dart';
import 'my_discounts.dart';
import 'notifications.dart';
import 'offers.dart';
import 'payments.dart';
import 'referrals.dart';
import 'request_detail.dart';
import 'support.dart';
import 'wallet.dart';

/// Interpret the same server links for foreground, tray and notification list.
///
/// Returns true when the link produced a destination. A notice whose link names
/// a screen the app can open must open exactly that screen: "tap it and you
/// land on the home page" is the complaint this file exists to make impossible,
/// so every pattern the API is known to emit is listed here and the fall-through
/// is explicit rather than silent.
bool openCustomerNotification(BuildContext context, String link) {
  final ticket = RegExp(r'^chat:([A-Za-z0-9_-]+)$').firstMatch(link);
  final request = RegExp(r'(?:^|/)requests/([A-Za-z0-9_-]+)').firstMatch(link);
  final thread = RegExp(r'(?:^|/)messages/([A-Za-z0-9_-]+)').firstMatch(link);
  Widget? destination;
  if (ticket != null) {
    destination = TicketDetailScreen(ticketId: ticket.group(1)!);
  } else if (request != null) {
    destination = RequestDetailScreen(requestId: request.group(1)!);
  } else if (thread != null) {
    destination = ChatScreen(threadId: thread.group(1)!, title: 'گفت‌وگو با دفتر');
  } else if (link == '/app/banners') {
    // A banner announcement lands on the home screen with the rail at the
    // top: the customer came to look at it, so the destination is the strip
    // of banners itself, not an archive of past ones.
    requestHomeTab();
  } else if (link.contains('custom-offers') || link == '/app/offers') {
    destination = const OffersScreen();
  } else if (link.contains('wallet')) {
    destination = const WalletScreen();
  } else if (link.contains('invoices') || link.contains('payments')) {
    destination = const PaymentsScreen();
  } else if (link.contains('support')) {
    destination = const SupportTab();
  } else if (link.contains('messages')) {
    destination = const ChatThreadsScreen();
  } else if (link.contains('documents')) {
    destination = const DocumentsScreen();
  } else if (link.contains('discounts')) {
    destination = const MyDiscountsScreen();
  } else if (link.contains('referrals')) {
    destination = const ReferralsScreen();
  } else if (link.contains('notifications')) {
    destination = const NotificationsScreen();
  } else if (link.contains('profile')) {
    // The profile notice is about the customer's own details, which is the
    // screen they were sent from — not the edit sheet, which would open a form
    // they never asked for.
    requestHomeTabIndex(3);
  } else if (link.endsWith('/app/requests')) {
    // A list-level notice (a case moved, one needs an action) belongs on the
    // requests tab of the live shell, not on a second copy of the list pushed
    // above it.
    requestHomeTabIndex(2);
  } else if (link.endsWith('/app/services')) {
    requestHomeTabIndex(1);
  } else if (link.endsWith('/app') || link == '/' || link.isEmpty) {
    // Nothing specific to open: go home, which is what a generic announcement
    // means. Anything else must not quietly fall through to this.
    requestHomeTab();
  }
  if (destination != null) {
    Navigator.push(context, MaterialPageRoute(builder: (_) => destination!));
    return true;
  }
  return false;
}
