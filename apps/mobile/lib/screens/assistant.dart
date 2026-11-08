import 'dart:async';

import 'package:flutter/material.dart';

import '../core/api.dart';
import '../core/format.dart';
import '../core/home_navigation.dart';
import '../core/theme.dart';
import '../models/models.dart';
import '../services/services.dart';
import '../widgets/avatar.dart';
import '../widgets/widgets.dart';
import 'chat.dart';
import 'notification_route.dart';
import 'notifications.dart';
import 'service_detail.dart';

/// The office's assistant, on the same backend as the website (`/api/assistant/*`).
///
/// Grounding rules that matter here:
///   * it answers from the catalogue and from the customer's *own* cases —
///     the server scopes the query, so a tracking code alone never opens
///     somebody else's file;
///   * when it does not know, it says so and offers a human (the «گفت‌وگو با
///     دفتر» button opens the same chat the website uses);
///   * service cards in a reply open the real service page, so "find a service"
///     ends in a request, not in a dead end.
class AssistantScreen extends StatefulWidget {
  const AssistantScreen({super.key});

  @override
  State<AssistantScreen> createState() => _AssistantScreenState();
}

class _AssistantMessage {
  _AssistantMessage({
    required this.role,
    required this.text,
    this.suggestions = const [],
    this.questions = const [],
    this.handoff = false,
    this.failed = false,
    this.action,
  });
  final String role; // 'user' | 'assistant'
  final String text;
  final List<Map<String, dynamic>> suggestions;
  final List<String> questions;
  final bool handoff;
  final bool failed;
  /// A real in-app destination the server suggested (e.g. the wallet).
  final Map<String, dynamic>? action;
}

class _AssistantScreenState extends State<AssistantScreen> {
  final _input = TextEditingController();
  final _scroll = ScrollController();
  final List<_AssistantMessage> _messages = [];
  Map<String, dynamic> _info = const {};
  bool _sending = false;
  bool _loadingInfo = true;

  @override
  void initState() {
    super.initState();
    _loadInfo();
  }

  @override
  void dispose() {
    _input.dispose();
    _scroll.dispose();
    super.dispose();
  }

  Future<void> _loadInfo() async {
    try {
      final info = await fetchAssistantInfo();
      if (mounted) {
        setState(() {
          _info = info;
          _loadingInfo = false;
          final welcome = asStr(info['welcome']);
          if (welcome.isNotEmpty) _messages.add(_AssistantMessage(role: 'assistant', text: welcome));
        });
      }
    } catch (_) {
      if (mounted) setState(() => _loadingInfo = false);
    }
  }

  Future<void> _send([String? preset]) async {
    final text = (preset ?? _input.text).trim();
    if (text.isEmpty || _sending) return;
    setState(() {
      _messages.add(_AssistantMessage(role: 'user', text: text));
      _sending = true;
      _input.clear();
    });
    _scrollToEnd();
    try {
      final history = _messages
          .where((message) => !message.failed)
          .toList()
          .reversed
          .take(8)
          .toList()
          .reversed
          .map((message) => {'role': message.role, 'content': message.text})
          .toList();
      final reply = await askAssistant(text, history: history);
      if (!mounted) return;
      setState(() {
        _messages.add(_AssistantMessage(
          role: 'assistant',
          text: asStr(reply['reply']),
          suggestions: asMapList(reply['suggestions']),
          questions: asTextList(reply['followUpQuestions']),
          handoff: asBool(reply['handoffSuggested']),
          action: reply['action'] is Map ? asMap(reply['action']) : null,
        ));
        _sending = false;
      });
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _messages.add(_AssistantMessage(role: 'assistant', text: error.message, failed: true));
        _sending = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _messages.add(_AssistantMessage(role: 'assistant', text: 'ارتباط با دستیار برقرار نشد. اتصال شبکه را بررسی کنید.', failed: true));
        _sending = false;
      });
    }
    _scrollToEnd();
  }

  void _scrollToEnd() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!_scroll.hasClients) return;
      _scroll.animateTo(_scroll.position.maxScrollExtent, duration: const Duration(milliseconds: 220), curve: Curves.easeOut);
    });
  }

  @override
  Widget build(BuildContext context) {
    final enabled = _info['enabled'] == null || asBool(_info['enabled']);
    return Scaffold(
      appBar: AppBar(
        title: Text(asStr(_info['name']).isEmpty ? 'دستیار هوشمند' : asStr(_info['name'])),
        actions: [
          IconButton(
            tooltip: 'گفت‌وگو با کارشناس',
            icon: const Icon(Icons.support_agent_rounded),
            onPressed: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const ChatThreadsScreen())),
          ),
        ],
      ),
      body: _loadingInfo
          ? const LoadingView()
          : !enabled
              ? EmptyView(
                  icon: Icons.smart_toy_outlined,
                  title: 'دستیار در دسترس نیست',
                  hint: 'در حال حاضر دستیار هوشمند غیرفعال است. می‌توانید از جست‌وجوی خدمات یا گفت‌وگو با کارشناس استفاده کنید.',
                  action: PlushButton(label: 'گفت‌وگو با دفتر', icon: Icons.chat_rounded, onPressed: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const ChatThreadsScreen()))),
                )
              : Column(children: [
                  Expanded(
                    child: ListView.builder(
                      controller: _scroll,
                      padding: const EdgeInsets.fromLTRB(14, 12, 14, 8),
                      itemCount: _messages.length + (_sending ? 1 : 0),
                      itemBuilder: (context, index) {
                        if (index >= _messages.length) return const _TypingBubble();
                        return _Bubble(
                          message: _messages[index],
                          onSuggestionTap: _openService,
                          onQuestionTap: (question) => _send(question),
                          onActionTap: _openRoute,
                        );
                      },
                    ),
                  ),
                  if (_messages.isNotEmpty && _messages.last.handoff)
                    Padding(
                      padding: const EdgeInsets.fromLTRB(14, 0, 14, 6),
                      child: OutlinedButton.icon(
                        onPressed: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const ChatThreadsScreen())),
                        icon: const Icon(Icons.chat_rounded, size: 18),
                        label: const Text('ادامهٔ گفت‌وگو با کارشناس دفتر'),
                      ),
                    ),
                  _composer(),
                ]),
    );
  }

  /// Follow an assistant shortcut to a real screen.
  void _openRoute(Map<String, dynamic> action) {
    final route = asStr(action['route']);
    if (route.isEmpty) return;
    // The assistant screen is a pushed page, so a destination that lives on
    // the shell should pop back to it rather than stacking another copy.
    final tab = switch (route) {
      '/app/services' => 1,
      '/app/requests' => 2,
      '/app/profile' => 3,
      _ => null,
    };
    if (tab != null) {
      Navigator.of(context).popUntil((page) => page.isFirst);
      requestHomeTabIndex(tab);
      return;
    }
    if (route == '/app/notifications') {
      Navigator.push(context, MaterialPageRoute(builder: (_) => const NotificationsScreen()));
      return;
    }
    if (route == '/app/messages') {
      Navigator.push(context, MaterialPageRoute(builder: (_) => const ChatThreadsScreen()));
      return;
    }
    openCustomerNotification(context, route);
  }

  void _openService(Map<String, dynamic> suggestion) {
    final slug = asStr(suggestion['slug']);
    if (slug.isEmpty) return;
    Navigator.push(context, MaterialPageRoute(builder: (_) => ServiceDetailScreen(service: CatalogService.fromSuggestion(suggestion))));
  }

  Widget _composer() {
    return SafeArea(
      top: false,
      child: Container(
        padding: const EdgeInsets.fromLTRB(12, 8, 12, 10),
        decoration: BoxDecoration(
          color: context.surface,
          border: Border(top: BorderSide(color: context.hairline)),
        ),
        child: Row(children: [
          Expanded(
            child: TextField(
              controller: _input,
              textInputAction: TextInputAction.send,
              minLines: 1,
              maxLines: 4,
              onSubmitted: (_) => _send(),
              decoration: const InputDecoration(hintText: 'سؤال خود را بنویسید…', contentPadding: EdgeInsets.symmetric(horizontal: 14, vertical: 10)),
            ),
          ),
          const SizedBox(width: 8),
          SizedBox(
            width: 48,
            height: 48,
            child: FilledButton(
              onPressed: _sending ? null : () => _send(),
              style: FilledButton.styleFrom(padding: EdgeInsets.zero, shape: const CircleBorder()),
              child: _sending
                  ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2.2, color: Colors.white))
                  : const Icon(Icons.send_rounded, size: 20),
            ),
          ),
        ]),
      ),
    );
  }
}

class _Bubble extends StatelessWidget {
  const _Bubble({required this.message, required this.onSuggestionTap, required this.onQuestionTap, required this.onActionTap});
  final _AssistantMessage message;
  final void Function(Map<String, dynamic>) onSuggestionTap;
  final void Function(String) onQuestionTap;
  final void Function(Map<String, dynamic>) onActionTap;

  @override
  Widget build(BuildContext context) {
    final mine = message.role == 'user';
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Row(
        mainAxisAlignment: mine ? MainAxisAlignment.start : MainAxisAlignment.end,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (!mine) ...[
            Container(
              width: 30, height: 30,
              decoration: BoxDecoration(shape: BoxShape.circle, color: context.brand.withOpacity(0.14)),
              child: Icon(Icons.auto_awesome_rounded, size: 17, color: context.brand),
            ),
            const SizedBox(width: 8),
          ],
          Flexible(
            child: Container(
              padding: const EdgeInsets.fromLTRB(14, 11, 14, 11),
              decoration: BoxDecoration(
                color: mine ? context.brand : (message.failed ? context.negative.withOpacity(0.12) : context.surfaceHigh),
                borderRadius: BorderRadius.only(
                  topLeft: const Radius.circular(18), topRight: const Radius.circular(18),
                  bottomLeft: Radius.circular(mine ? 18 : 6), bottomRight: Radius.circular(mine ? 6 : 18),
                ),
                border: Border.all(color: context.hairline),
              ),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(message.text,
                    style: TextStyle(fontSize: 13, height: 1.85, color: mine ? Colors.white : context.ink)),
                if (message.suggestions.isNotEmpty) ...[
                  const SizedBox(height: 8),
                  for (final suggestion in message.suggestions.take(4))
                    Padding(
                      padding: const EdgeInsets.only(top: 6),
                      child: InkWell(
                        onTap: () => onSuggestionTap(suggestion),
                        borderRadius: BorderRadius.circular(12),
                        child: Container(
                          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 9),
                          decoration: BoxDecoration(
                            color: context.surface,
                            borderRadius: BorderRadius.circular(12),
                            border: Border.all(color: context.hairline),
                          ),
                          child: Row(children: [
                            Icon(Icons.arrow_forward_rounded, size: 15, color: context.brand),
                            const SizedBox(width: 6),
                            Expanded(
                              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                Text(asStr(suggestion['title']), style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700, color: context.ink)),
                                if (asStr(suggestion['summary']).isNotEmpty)
                                  Text(asStr(suggestion['summary']), maxLines: 2, overflow: TextOverflow.ellipsis, style: TextStyle(fontSize: 11, color: context.inkMuted, height: 1.6)),
                              ]),
                            ),
                          ]),
                        ),
                      ),
                    ),
                ],
                if (message.action != null) ...[
                  const SizedBox(height: 10),
                  SizedBox(
                    width: double.infinity,
                    child: FilledButton.icon(
                      onPressed: () => onActionTap(message.action!),
                      icon: const Icon(Icons.arrow_outward_rounded, size: 16),
                      label: Text(asStr(message.action!['label']), style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700)),
                      style: FilledButton.styleFrom(padding: const EdgeInsets.symmetric(vertical: 11)),
                    ),
                  ),
                ],
                if (message.questions.isNotEmpty) ...[
                  const SizedBox(height: 8),
                  Wrap(spacing: 6, runSpacing: 6, children: [
                    for (final question in message.questions.take(3))
                      ActionChip(label: Text(question, style: const TextStyle(fontSize: 11.5)), onPressed: () => onQuestionTap(question)),
                  ]),
                ],
              ]),
            ),
          ),
          if (mine) ...[
            const SizedBox(width: 8),
            const UserAvatar(size: 30),
          ],
        ],
      ),
    );
  }
}

class _TypingBubble extends StatefulWidget {
  const _TypingBubble();
  @override
  State<_TypingBubble> createState() => _TypingBubbleState();
}

class _TypingBubbleState extends State<_TypingBubble> with SingleTickerProviderStateMixin {
  late final AnimationController _controller = AnimationController(vsync: this, duration: const Duration(milliseconds: 900))..repeat();

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Align(
      alignment: Alignment.centerRight,
      child: Container(
        margin: const EdgeInsets.only(bottom: 10),
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
        decoration: BoxDecoration(color: context.surfaceHigh, borderRadius: BorderRadius.circular(16), border: Border.all(color: context.hairline)),
        child: AnimatedBuilder(
          animation: _controller,
          builder: (context, _) => Row(mainAxisSize: MainAxisSize.min, children: [
            for (var index = 0; index < 3; index += 1)
              Container(
                width: 6, height: 6,
                margin: const EdgeInsets.symmetric(horizontal: 2),
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: context.inkMuted.withOpacity(0.35 + 0.5 * ((1 - ((_controller.value - index * 0.2).abs() * 2.2)).clamp(0.0, 1.0))),
                ),
              ),
          ]),
        ),
      ),
    );
  }
}
