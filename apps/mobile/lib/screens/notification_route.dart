import 'package:flutter/material.dart';

import 'chat.dart';
import 'documents.dart';
import 'offers.dart';
import 'payments.dart';
import 'request_detail.dart';
import 'stories_archive.dart';
import 'support.dart';
import 'wallet.dart';

/// Interpret the same server links for foreground, tray and notification list.
void openCustomerNotification(BuildContext context, String link) {
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
  } else if (link == '/app/stories') {
    destination = const StoriesArchiveScreen();
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
  }
  if (destination != null) {
    Navigator.push(context, MaterialPageRoute(builder: (_) => destination!));
  }
}
