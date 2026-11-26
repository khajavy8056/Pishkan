import 'package:flutter/material.dart';

import '../core/api.dart';
import '../core/home_navigation.dart';
import '../core/theme.dart';
import '../models/models.dart';
import '../services/services.dart';
import '../widgets/avatar.dart';
import '../widgets/widgets.dart';
import 'chat.dart';
import 'login.dart';
import 'notification_route.dart';
import 'notifications.dart';
import 'service_detail.dart';

/// Set when a guest asks to start a request. Consumed after sign-in so the
/// assistant resumes the same service instead of dropping the path — the
/// Android equivalent of the `?service=` query the website keeps in the URL.
String? _pendingAssistantServiceSlug;

/// The office's assistant, on the same backend and the same structured
/// contract as the website (`/api/assistant/*`).
///
/// What this screen guarantees, and why it is written this way:
///   * it answers from the live catalogue and from the customer's *own* cases —
///     the server scopes every account query, so a tracking code alone never
///     opens somebody else's file;
///   * every structured card the server sends (service, case, invoice, wallet,
///     profile, ticket, catalogue) is rendered with its own action buttons, so
///     an answer ends in the real screen, not in a dead end;
///   * a request is created only after the customer sees a complete preview and
///     taps «تأیید و ثبت نهایی». Until then the draft lives in
///     `assistant_drafts` and no request row exists;
///   * when it does not know, it says so and offers a human (the
///     «گفت‌وگو با دفتر» button opens the same chat the website uses).
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
    this.actions = const [],
    this.cards = const [],
    this.handoff = false,
    this.failed = false,
    this.draft,
  });

  final String role; // 'user' | 'assistant'
  final String text;
  final List<Map<String, dynamic>> suggestions;
  final List<String> questions;
  final List<AssistantAction> actions;
  final List<AssistantCard> cards;
  final bool handoff;
  final bool failed;
  final AssistantDraft? draft;
}

class _AssistantScreenState extends State<AssistantScreen> {
  final _input = TextEditingController();
  final _scroll = ScrollController();
  final List<_AssistantMessage> _messages = [];
  Map<String, dynamic> _info = const {};
  AssistantDraft? _draft;
  bool _restoredDraft = false;
  bool _sending = false;
  bool _busy = false;
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

  bool get _isGuest => session.user == null;

  bool get _canSubmit => _info['capabilities'] is Map
      ? asBool(asMap(_info['capabilities'])['requestSubmission'])
      : !_isGuest;

  Future<void> _loadInfo() async {
    try {
      final info = await fetchAssistantInfo();
      if (!mounted) return;
      setState(() {
        _info = info;
        _loadingInfo = false;
        final draftJson = info['draft'];
        if (draftJson is Map) {
          final draft = AssistantDraft.fromJson(asMap(draftJson));
          if (draft.active) {
            _draft = draft;
            _restoredDraft = true;
          }
        }
        final welcome = asStr(info['welcome']);
        if (welcome.isNotEmpty) _messages.add(_AssistantMessage(role: 'assistant', text: welcome));
      });
      final pending = _pendingAssistantServiceSlug;
      if (pending != null && session.user != null) {
        _pendingAssistantServiceSlug = null;
        // Wait for the frame so the composer and the draft panel mount first.
        WidgetsBinding.instance.addPostFrameCallback((_) {
          if (mounted) _startService({'slug': pending});
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
    await _consume(() => askAssistant(text, history: _history()));
  }

  List<Map<String, dynamic>> _history() => _messages
      .where((message) => !message.failed)
      .toList()
      .reversed
      .take(8)
      .toList()
      .reversed
      .map((message) => {'role': message.role, 'content': message.text})
      .toList();

  /// Shared tail for every assistant call: append the structured reply, adopt
  /// its draft, and keep the scroll pinned to the newest message.
  Future<void> _consume(Future<Map<String, dynamic>> Function() call) async {
    try {
      final reply = await call();
      if (!mounted) return;
      final draftJson = reply['draft'];
      final draft = draftJson is Map ? AssistantDraft.fromJson(asMap(draftJson)) : null;
      setState(() {
        _messages.add(_AssistantMessage(
          role: 'assistant',
          text: asStr(reply['reply']),
          suggestions: asMapList(reply['suggestions']),
          questions: asTextList(reply['followUpQuestions']),
          actions: asMapList(reply['actions']).map(AssistantAction.fromJson).toList(),
          cards: asMapList(reply['cards']).map(AssistantCard.fromJson).toList(),
          handoff: asBool(reply['handoffSuggested']),
          draft: draft,
        ));
        if (draft != null) {
          _draft = draft;
          _restoredDraft = false;
        }
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

  /* ------------------------------- actions -------------------------------- */

  Future<void> _runAction(AssistantAction action) async {
    switch (action.kind) {
      case 'send':
        return _send(action.message.isNotEmpty ? action.message : action.label);
      case 'login':
      case 'register':
        _openLogin();
        return;
      case 'link':
      case 'upload':
        _openRoute(action.target);
        return;
      case 'confirm':
        return _previewDraft();
      case 'cancel':
        return _cancelDraft();
      default:
        return;
    }
  }

  void _openLogin() {
    Navigator.push(context, MaterialPageRoute(builder: (_) => const LoginScreen()));
  }

  /// Follow an assistant shortcut to a real screen.
  void _openRoute(String route) {
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
    openCustomerNotification(context, route);
  }

  void _openServicesTab() {
    Navigator.of(context).popUntil((page) => page.isFirst);
    requestHomeTabIndex(1);
  }

  void _openService(Map<String, dynamic> suggestion) {
    final slug = asStr(suggestion['slug']);
    if (slug.isEmpty) return;
    Navigator.push(context, MaterialPageRoute(builder: (_) => ServiceDetailScreen(service: CatalogService.fromSuggestion(suggestion))));
  }

  /// «شروع درخواست» on a service card: guests go to login first, customers get
  /// a draft (never a request) they can fill in with the assistant.
  Future<void> _startService(Map<String, dynamic> service) async {
    if (_isGuest) {
      // Remember the service so sign-in leads straight back to this draft.
      _pendingAssistantServiceSlug = asStr(service['slug']);
      _openLogin();
      return;
    }
    final slug = asStr(service['slug']);
    if (slug.isEmpty || _busy) return;
    setState(() => _busy = true);
    try {
      final draftJson = await startAssistantDraft(slug, useProfile: _profileAutofill);
      final draft = AssistantDraft.fromJson(asMap(draftJson['draft']));
      if (!mounted) return;
      setState(() {
        _draft = draft;
        _restoredDraft = false;
        _messages.add(_AssistantMessage(
          role: 'assistant',
          text: 'بیایید درخواست «${draft.serviceTitle}» را با هم کامل کنیم. فیلدها را پر کنید، مدارک را بارگذاری کنید و سپس پیش‌نمایش را ببینید.',
          draft: draft,
        ));
        _busy = false;
      });
      _scrollToEnd();
    } catch (error) {
      if (!mounted) return;
      setState(() => _busy = false);
      _toast(error is ApiException ? error.message : 'شروع درخواست انجام نشد.');
    }
  }

  bool get _profileAutofill => _info['capabilities'] is Map
      ? asBool(asMap(_info['capabilities'])['profileAutofill'])
      : false;

  /// Refresh the preview. The server only promotes the draft to
  /// `awaiting_confirmation` when everything required is present.
  Future<void> _previewDraft() async {
    if (_draft == null || _busy) return;
    setState(() => _busy = true);
    try {
      final data = await previewAssistantDraft();
      if (!mounted) return;
      final draftJson = data['draft'];
      if (draftJson is! Map) {
        setState(() => _busy = false);
        return;
      }
      final draft = AssistantDraft.fromJson(asMap(draftJson));
      setState(() {
        _draft = draft;
        _busy = false;
        _messages.add(_AssistantMessage(
          role: 'assistant',
          text: draft.awaitingConfirmation
              ? 'پیش‌نمایش کامل شد. اگر همهٔ اطلاعات درست است، دکمهٔ «تأیید و ثبت نهایی» را بزنید.'
              : 'چند مورد هنوز ناقص است. آن‌ها را کامل کنید و دوباره پیش‌نمایش بگیرید.',
          draft: draft,
        ));
      });
      _scrollToEnd();
    } catch (error) {
      if (!mounted) return;
      setState(() => _busy = false);
      _toast(error is ApiException ? error.message : 'پیش‌نمایش انجام نشد.');
    }
  }

  /// The only path that creates a request. The server requires both the stored
  /// `awaiting_confirmation` stage and this explicit `confirm: true` flag.
  Future<void> _confirmDraft() async {
    if (_draft == null || _busy) return;
    setState(() => _busy = true);
    try {
      final reply = await confirmAssistantDraft();
      if (!mounted) return;
      final draftJson = reply['draft'];
      final draft = draftJson is Map ? AssistantDraft.fromJson(asMap(draftJson)) : null;
      setState(() {
        _draft = draft;
        _restoredDraft = false;
        _messages.add(_AssistantMessage(
          role: 'assistant',
          text: asStr(reply['reply']).isEmpty ? 'درخواست شما ثبت شد.' : asStr(reply['reply']),
          actions: asMapList(reply['actions']).map(AssistantAction.fromJson).toList(),
          cards: asMapList(reply['cards']).map(AssistantCard.fromJson).toList(),
          draft: draft,
        ));
        _busy = false;
      });
      _scrollToEnd();
      _toast('درخواست شما ثبت شد');
    } catch (error) {
      if (!mounted) return;
      setState(() => _busy = false);
      _toast(error is ApiException ? error.message : 'ثبت درخواست انجام نشد.');
    }
  }

  Future<void> _cancelDraft() async {
    if (_draft == null || _busy) return;
    setState(() => _busy = true);
    try {
      final reply = await cancelAssistantDraft();
      if (!mounted) return;
      setState(() {
        _draft = null;
        _restoredDraft = false;
        _messages.add(_AssistantMessage(
          role: 'assistant',
          text: asStr(reply['reply']).isEmpty ? 'پیش‌نویس لغو شد.' : asStr(reply['reply']),
          cards: asMapList(reply['cards']).map(AssistantCard.fromJson).toList(),
        ));
        _busy = false;
      });
      _scrollToEnd();
    } catch (error) {
      if (!mounted) return;
      setState(() => _busy = false);
      _toast(error is ApiException ? error.message : 'لغو پیش‌نویس انجام نشد.');
    }
  }

  void _toast(String message) {
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message)));
  }

  /* -------------------------------- build ---------------------------------- */

  @override
  Widget build(BuildContext context) {
    final enabled = _info['enabled'] == null || asBool(_info['enabled']);
    final draft = _draft;
    final activeDraft = draft != null && draft.active ? draft : null;
    return Scaffold(
      appBar: AppBar(
        title: Text(asStr(_info['name']).isEmpty ? 'دستیار هوشمند' : asStr(_info['name'])),
        actions: [
          Padding(
            padding: const EdgeInsetsDirectional.only(end: 6),
            child: Center(
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                decoration: BoxDecoration(
                  color: _isGuest ? context.surfaceHigh : context.brand.withOpacity(0.12),
                  borderRadius: BorderRadius.circular(999),
                  border: Border.all(color: context.hairline),
                ),
                child: Text(
                  _isGuest ? 'حالت مهمان' : 'حساب خودم',
                  style: TextStyle(fontSize: 10.5, fontWeight: FontWeight.w700, color: _isGuest ? context.inkMuted : context.brand),
                ),
              ),
            ),
          ),
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
                  if (_restoredDraft && activeDraft != null)
                    Container(
                      width: double.infinity,
                      margin: const EdgeInsets.fromLTRB(14, 10, 14, 0),
                      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                      decoration: BoxDecoration(
                        color: context.surfaceHigh,
                        borderRadius: BorderRadius.circular(12),
                        border: Border.all(color: context.hairline),
                      ),
                      child: Text('یک پیش‌نویس نیمه‌کاره پیدا شد. می‌توانید همان را ادامه دهید یا لغو کنید.',
                          style: TextStyle(fontSize: 11.5, height: 1.7, color: context.inkMuted)),
                    ),
                  Expanded(
                    child: ListView.builder(
                      controller: _scroll,
                      padding: const EdgeInsets.fromLTRB(14, 12, 14, 8),
                      itemCount: _messages.length + (_sending ? 1 : 0),
                      itemBuilder: (context, index) {
                        if (index >= _messages.length) return const _TypingBubble();
                        return _Bubble(
                          message: _messages[index],
                          onServiceTap: _openService,
                          onStartRequest: _canSubmit ? _startService : null,
                          onQuestionTap: (question) => _send(question),
                          onActionTap: _runAction,
                          onOpenCatalog: _openServicesTab,
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
                  if (activeDraft != null)
                    Container(
                      constraints: const BoxConstraints(maxHeight: 340),
                      margin: const EdgeInsets.fromLTRB(10, 4, 10, 4),
                      child: _DraftPanel(
                        draft: activeDraft,
                        busy: _busy,
                        onPreview: _previewDraft,
                        onConfirm: _confirmDraft,
                        onCancel: _cancelDraft,
                        onOpenRequest: (requestId) => _openRoute('/app/requests/$requestId'),
                      ),
                    ),
                  _composer(),
                ]),
    );
  }

  Widget _composer() {
    final quick = _isGuest
        ? const [
            _QuickAction('چه خدماتی دارید؟', 'چه خدماتی دارید؟'),
            _QuickAction('مدارک لازم', 'برای ثبت درخواست چه مدارکی لازم است؟'),
            _QuickAction('ورود به حساب', ''),
          ]
        : const [
            _QuickAction('ثبت درخواست', 'می‌خواهم یک درخواست ثبت کنم'),
            _QuickAction('وضعیت پرونده', 'وضعیت پرونده‌های من چیست؟'),
            _QuickAction('مبلغ قابل پرداخت', 'چقدر باید پرداخت کنم؟'),
            _QuickAction('کیف پول', 'موجودی کیف پول من چقدر است؟'),
          ];
    return SafeArea(
      top: false,
      child: Container(
        padding: const EdgeInsets.fromLTRB(12, 8, 12, 10),
        decoration: BoxDecoration(
          color: context.surface,
          border: Border(top: BorderSide(color: context.hairline)),
        ),
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          Row(children: [
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
          const SizedBox(height: 8),
          SizedBox(
            height: 32,
            child: ListView.separated(
              scrollDirection: Axis.horizontal,
              itemCount: quick.length,
              separatorBuilder: (_, _) => const SizedBox(width: 6),
              itemBuilder: (context, index) {
                final item = quick[index];
                return ActionChip(
                  label: Text(item.label, style: TextStyle(fontSize: 11)),
                  onPressed: () => item.message.isEmpty ? _openLogin() : _send(item.message),
                );
              },
            ),
          ),
          if (_isGuest)
            Padding(
              padding: const EdgeInsets.only(top: 6),
              child: Text(
                'برای پاسخ شخصی (پرونده‌ها، فاکتورها، کیف پول) وارد شوید. دستیار هرگز اطلاعات مشتری دیگری را نمی‌بیند.',
                style: TextStyle(fontSize: 10, height: 1.6, color: context.inkMuted),
              ),
            ),
        ]),
      ),
    );
  }
}

class _QuickAction {
  const _QuickAction(this.label, this.message);
  final String label;
  final String message;
}

/* --------------------------------- bubble --------------------------------- */

class _Bubble extends StatelessWidget {
  const _Bubble({
    required this.message,
    required this.onServiceTap,
    required this.onStartRequest,
    required this.onQuestionTap,
    required this.onActionTap,
    required this.onOpenCatalog,
  });

  final _AssistantMessage message;
  final void Function(Map<String, dynamic>) onServiceTap;
  final void Function(Map<String, dynamic>)? onStartRequest;
  final void Function(String) onQuestionTap;
  final void Function(AssistantAction) onActionTap;
  final VoidCallback onOpenCatalog;

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
              width: 30,
              height: 30,
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
                  topLeft: const Radius.circular(18),
                  topRight: const Radius.circular(18),
                  bottomLeft: Radius.circular(mine ? 18 : 6),
                  bottomRight: Radius.circular(mine ? 6 : 18),
                ),
                border: Border.all(color: context.hairline),
              ),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                if (message.text.isNotEmpty)
                  Text(message.text, style: TextStyle(fontSize: 13, height: 1.85, color: mine ? Colors.white : context.ink)),
                for (final card in message.cards)
                  Padding(
                    padding: const EdgeInsets.only(top: 8),
                    child: _CardView(card: card, onActionTap: onActionTap, onStartRequest: onStartRequest, onServiceTap: onServiceTap, onOpenCatalog: onOpenCatalog),
                  ),
                if (message.suggestions.isNotEmpty)
                  for (final suggestion in message.suggestions.take(4))
                    Padding(
                      padding: const EdgeInsets.only(top: 6),
                      child: _ServiceTile(service: suggestion, onTap: () => onServiceTap(suggestion), onStartRequest: onStartRequest),
                    ),
                if (message.actions.isNotEmpty)
                  Padding(
                    padding: const EdgeInsets.only(top: 8),
                    child: Wrap(spacing: 6, runSpacing: 6, children: [
                      for (final action in message.actions.take(4)) _ActionButton(action: action, onTap: () => onActionTap(action)),
                    ]),
                  ),
                if (message.questions.isNotEmpty)
                  Padding(
                    padding: const EdgeInsets.only(top: 8),
                    child: Wrap(spacing: 6, runSpacing: 6, children: [
                      for (final question in message.questions.take(3)) ActionChip(label: Text(question, style: const TextStyle(fontSize: 11.5)), onPressed: () => onQuestionTap(question)),
                    ]),
                  ),
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

/* --------------------------------- cards ---------------------------------- */

class _ActionButton extends StatelessWidget {
  const _ActionButton({required this.action, required this.onTap});
  final AssistantAction action;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final primary = action.kind == 'confirm';
    final label = action.label.isEmpty ? 'ادامه' : action.label;
    if (primary) {
      return FilledButton.icon(
        onPressed: onTap,
        icon: const Icon(Icons.verified_user_rounded, size: 15),
        label: Text(label, style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700)),
        style: FilledButton.styleFrom(padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 9)),
      );
    }
    return OutlinedButton.icon(
      onPressed: onTap,
      icon: Icon(_iconFor(action.kind), size: 15),
      label: Text(label, style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: context.ink)),
      style: OutlinedButton.styleFrom(padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 9), side: BorderSide(color: context.hairline)),
    );
  }

  IconData _iconFor(String kind) => switch (kind) {
        'login' => Icons.login_rounded,
        'register' => Icons.person_add_alt_rounded,
        'upload' => Icons.upload_file_rounded,
        'cancel' => Icons.close_rounded,
        'edit' => Icons.edit_rounded,
        _ => Icons.arrow_outward_rounded,
      };
}

class _ServiceTile extends StatelessWidget {
  const _ServiceTile({required this.service, required this.onTap, required this.onStartRequest});
  final Map<String, dynamic> service;
  final VoidCallback onTap;
  final void Function(Map<String, dynamic>)? onStartRequest;

  @override
  Widget build(BuildContext context) {
    final accepting = service['acceptingRequests'] != false;
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(12),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 9),
        decoration: BoxDecoration(
          color: context.surface,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: context.hairline),
        ),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            Icon(Icons.arrow_forward_rounded, size: 15, color: context.brand),
            const SizedBox(width: 6),
            Expanded(
              child: Text(asStr(service['title']), style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700, color: context.ink)),
            ),
          ]),
          if (asStr(service['summary']).isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(top: 2),
              child: Text(asStr(service['summary']), maxLines: 2, overflow: TextOverflow.ellipsis, style: TextStyle(fontSize: 11, color: context.inkMuted, height: 1.6)),
            ),
          Padding(
            padding: const EdgeInsets.only(top: 4),
            child: Row(children: [
              Text(_money(asNum(service['finalFee']).toDouble()), style: TextStyle(fontSize: 10.5, fontWeight: FontWeight.w700, color: context.inkMuted)),
              const SizedBox(width: 8),
              Text(asStr(service['categoryTitle']), style: TextStyle(fontSize: 10.5, color: context.inkMuted)),
              const Spacer(),
              Text(accepting ? 'در حال پذیرش' : 'موقتاً بسته', style: TextStyle(fontSize: 10, color: accepting ? Colors.green.shade700 : context.inkMuted)),
            ]),
          ),
          if (onStartRequest != null && accepting)
            Align(
              alignment: AlignmentDirectional.centerEnd,
              child: TextButton.icon(
                onPressed: () => onStartRequest!(service),
                icon: const Icon(Icons.add_task_rounded, size: 14),
                label: const Text('شروع درخواست', style: TextStyle(fontSize: 11)),
              ),
            ),
        ]),
      ),
    );
  }
}

String _money(double rial) {
  final value = rial.round();
  final digits = value.toString();
  final buffer = StringBuffer();
  for (var index = 0; index < digits.length; index += 1) {
    final remaining = digits.length - index;
    buffer.write(digits[index]);
    if (remaining > 1 && remaining % 3 == 1) buffer.write('٬');
  }
  return '${buffer.toString()} ریال';
}

String _duration(double minutes, double days) {
  final total = minutes > 0 ? minutes : days * 1440;
  if (total <= 0) return '—';
  if (total % 1440 == 0) return '${(total / 1440).round()} روز';
  if (total % 60 == 0) return '${(total / 60).round()} ساعت';
  return '${total.round()} دقیقه';
}

class _CardView extends StatelessWidget {
  const _CardView({
    required this.card,
    required this.onActionTap,
    required this.onStartRequest,
    required this.onServiceTap,
    required this.onOpenCatalog,
  });
  final AssistantCard card;
  final void Function(AssistantAction) onActionTap;
  final void Function(Map<String, dynamic>)? onStartRequest;
  final void Function(Map<String, dynamic>) onServiceTap;
  final VoidCallback onOpenCatalog;

  @override
  Widget build(BuildContext context) {
    if (card.isService) return _ServiceTile(service: card.service, onTap: () => onServiceTap(card.service), onStartRequest: onStartRequest);
    if (card.isCase) return _CaseCard(data: card.caseData, onActionTap: onActionTap);
    if (card.isInvoice) return _InvoiceCard(data: card.invoice, onActionTap: onActionTap);
    if (card.isWallet) return _WalletCard(data: card.wallet, onActionTap: onActionTap);
    if (card.isProfile) return _ProfileCard(data: card.profile, onActionTap: onActionTap);
    if (card.isTicket) return _TicketCard(data: card.ticket, onActionTap: onActionTap);
    if (card.isCatalog) return _CatalogCard(data: card.catalog, onOpenCatalog: onOpenCatalog);
    return const SizedBox.shrink();
  }
}

Widget _cardShell(BuildContext context, {required List<Widget> children, Color? accent}) {
  return Container(
    padding: const EdgeInsets.all(10),
    decoration: BoxDecoration(
      color: context.surface,
      borderRadius: BorderRadius.circular(12),
      border: Border.all(color: accent ?? context.hairline),
    ),
    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: children),
  );
}

Widget _cardRow(BuildContext context, String label, String value, {Color? valueColor}) {
  return Padding(
    padding: const EdgeInsets.symmetric(vertical: 1.5),
    child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
      SizedBox(width: 92, child: Text(label, style: TextStyle(fontSize: 10.5, color: context.inkMuted))),
      Expanded(child: Text(value, textAlign: TextAlign.start, style: TextStyle(fontSize: 10.5, fontWeight: FontWeight.w600, color: valueColor ?? context.ink))),
    ]),
  );
}

Widget _cardActions(List<AssistantAction> actions, void Function(AssistantAction) onActionTap) {
  if (actions.isEmpty) return const SizedBox.shrink();
  return Padding(
    padding: const EdgeInsets.only(top: 6),
    child: Wrap(spacing: 6, runSpacing: 6, children: [
      for (final action in actions.take(3)) _ActionButton(action: action, onTap: () => onActionTap(action)),
    ]),
  );
}

class _CaseCard extends StatelessWidget {
  const _CaseCard({required this.data, required this.onActionTap});
  final Map<String, dynamic> data;
  final void Function(AssistantAction) onActionTap;

  @override
  Widget build(BuildContext context) {
    final rejected = asMapList(data['rejectedDocuments']);
    final notes = asMapList(data['notes']);
    final actions = <AssistantAction>[
      if (data['nextAction'] is Map) AssistantAction.fromJson(asMap(data['nextAction'])),
    ];
    return _cardShell(context, accent: rejected.isEmpty ? null : Colors.orange.shade300, children: [
      Row(children: [
        Expanded(child: Text(asStr(data['serviceTitle']), style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700, color: context.ink))),
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
          decoration: BoxDecoration(color: context.surfaceHigh, borderRadius: BorderRadius.circular(999)),
          child: Text(asStr(data['statusLabel']), style: TextStyle(fontSize: 10, color: context.inkMuted)),
        ),
      ]),
      Padding(
        padding: const EdgeInsets.only(top: 2),
        child: Text('کد پیگیری ${asStr(data['trackingCode'])}', style: TextStyle(fontSize: 10.5, color: context.inkMuted)),
      ),
      if (asStr(data['currentStepTitle']).isNotEmpty)
        _cardRow(context, 'مرحله فعلی', '${asStr(data['currentStep'])} از ${asStr(data['stepCount'])} — ${asStr(data['currentStepTitle'])}'),
      if (asStr(data['nextStepTitle']).isNotEmpty)
        _cardRow(context, 'قدم بعدی', asStr(data['nextStepTitle']), valueColor: Colors.green.shade700),
      if (asStr(data['workBucketLabel']).isNotEmpty) _cardRow(context, 'وضعیت کار', asStr(data['workBucketLabel'])),
      if (asStr(data['assigneeName']).isNotEmpty) _cardRow(context, 'کارشناس', asStr(data['assigneeName'])),
      _cardRow(context, 'هزینه', '${_money(asNum(data['total']).toDouble())} (${asStr(data['paymentStatusLabel'])})'),
      for (final invoice in asMapList(data['invoices']))
        if (asNum(invoice['remaining']).toDouble() > 0)
          _cardRow(context, 'مانده فاکتور', _money(asNum(invoice['remaining']).toDouble()), valueColor: Colors.red.shade700),
      for (final document in rejected)
        Padding(
          padding: const EdgeInsets.only(top: 4),
          child: Text('✕ ${asStr(document['title'])}${asStr(document['note']).isEmpty ? '' : ' — ${asStr(document['note'])}'}',
              style: TextStyle(fontSize: 10.5, height: 1.6, color: Colors.red.shade700)),
        ),
      for (final note in notes.take(2))
        Padding(
          padding: const EdgeInsets.only(top: 2),
          child: Text('📝 ${asStr(note['message'])}', style: TextStyle(fontSize: 10.5, height: 1.6, color: context.inkMuted)),
        ),
      _cardActions(actions, onActionTap),
    ]);
  }
}

class _InvoiceCard extends StatelessWidget {
  const _InvoiceCard({required this.data, required this.onActionTap});
  final Map<String, dynamic> data;
  final void Function(AssistantAction) onActionTap;

  @override
  Widget build(BuildContext context) {
    final remaining = asNum(data['remaining']).toDouble();
    final actions = <AssistantAction>[if (data['action'] is Map) AssistantAction.fromJson(asMap(data['action']))];
    return _cardShell(context, accent: remaining > 0 ? Colors.orange.shade300 : Colors.green.shade300, children: [
      Row(children: [
        Expanded(child: Text(asStr(data['title']).isEmpty ? 'فاکتور ${asStr(data['number'])}' : asStr(data['title']), style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700, color: context.ink))),
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
          decoration: BoxDecoration(color: context.surfaceHigh, borderRadius: BorderRadius.circular(999)),
          child: Text(asStr(data['statusLabel']), style: TextStyle(fontSize: 10, color: context.inkMuted)),
        ),
      ]),
      if (asStr(data['serviceTitle']).isNotEmpty)
        Padding(padding: const EdgeInsets.only(top: 2), child: Text(asStr(data['serviceTitle']), style: TextStyle(fontSize: 10.5, color: context.inkMuted))),
      _cardRow(context, 'مبلغ کل', _money(asNum(data['total']).toDouble())),
      _cardRow(context, 'پرداخت‌شده', _money(asNum(data['paidAmount']).toDouble()), valueColor: Colors.green.shade700),
      _cardRow(context, 'مانده', _money(remaining), valueColor: remaining > 0 ? Colors.red.shade700 : Colors.green.shade700),
      if (asBool(data['external'])) _cardRow(context, 'نوع هزینه', 'هزینهٔ سازمان'),
      _cardActions(actions, onActionTap),
    ]);
  }
}

class _WalletCard extends StatelessWidget {
  const _WalletCard({required this.data, required this.onActionTap});
  final Map<String, dynamic> data;
  final void Function(AssistantAction) onActionTap;

  @override
  Widget build(BuildContext context) {
    final actions = <AssistantAction>[if (data['action'] is Map) AssistantAction.fromJson(asMap(data['action']))];
    return _cardShell(context, children: [
      Row(children: [
        Expanded(child: Text('کیف پول', style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700, color: context.ink))),
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
          decoration: BoxDecoration(color: context.surfaceHigh, borderRadius: BorderRadius.circular(999)),
          child: Text(asStr(data['statusLabel']), style: TextStyle(fontSize: 10, color: context.inkMuted)),
        ),
      ]),
      _cardRow(context, 'موجودی', _money(asNum(data['balance']).toDouble()), valueColor: Colors.green.shade700),
      if (asNum(data['pendingTopups']).toDouble() > 0)
        _cardRow(context, 'شارژ در انتظار', _money(asNum(data['pendingTopups']).toDouble()), valueColor: Colors.orange.shade700),
      _cardActions(actions, onActionTap),
    ]);
  }
}

class _ProfileCard extends StatelessWidget {
  const _ProfileCard({required this.data, required this.onActionTap});
  final Map<String, dynamic> data;
  final void Function(AssistantAction) onActionTap;

  @override
  Widget build(BuildContext context) {
    final complete = asBool(data['complete']);
    final missing = asTextList(data['missing']);
    final actions = <AssistantAction>[if (data['action'] is Map) AssistantAction.fromJson(asMap(data['action']))];
    return _cardShell(context, accent: complete ? Colors.green.shade300 : Colors.orange.shade300, children: [
      Row(children: [
        Expanded(child: Text('پروفایل ${asStr(data['fullName'])}', style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700, color: context.ink))),
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
          decoration: BoxDecoration(color: context.surfaceHigh, borderRadius: BorderRadius.circular(999)),
          child: Text(complete ? 'کامل' : 'ناقص', style: TextStyle(fontSize: 10, color: context.inkMuted)),
        ),
      ]),
      _cardRow(context, 'موبایل', asStr(data['mobile'])),
      if (asStr(data['city']).isNotEmpty) _cardRow(context, 'شهر', asStr(data['city'])),
      _cardRow(context, 'مدارک پروفایل', '${asNum(data['documentCount'])} مدرک (${asNum(data['rejectedDocumentCount'])} ردشده)'),
      if (!complete) _cardRow(context, 'موارد ناقص', missing.join('، '), valueColor: Colors.orange.shade700),
      _cardActions(actions, onActionTap),
    ]);
  }
}

class _TicketCard extends StatelessWidget {
  const _TicketCard({required this.data, required this.onActionTap});
  final Map<String, dynamic> data;
  final void Function(AssistantAction) onActionTap;

  @override
  Widget build(BuildContext context) {
    final unread = asNum(data['unreadForCustomer']).toDouble();
    final actions = <AssistantAction>[if (data['action'] is Map) AssistantAction.fromJson(asMap(data['action']))];
    return _cardShell(context, children: [
      Text(asStr(data['subject']), style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700, color: context.ink)),
      Padding(
        padding: const EdgeInsets.only(top: 2),
        child: Text('تیکت ${asStr(data['number'])} · ${asStr(data['departmentLabel'])}', style: TextStyle(fontSize: 10.5, color: context.inkMuted)),
      ),
      _cardRow(context, 'وضعیت', unread > 0 ? '${asStr(data['statusLabel'])} · ${unread.round()} پیام جدید' : asStr(data['statusLabel'])),
      _cardActions(actions, onActionTap),
    ]);
  }
}

class _CatalogCard extends StatelessWidget {
  const _CatalogCard({required this.data, required this.onOpenCatalog});
  final Map<String, dynamic> data;
  final VoidCallback onOpenCatalog;

  @override
  Widget build(BuildContext context) {
    final categories = asMapList(data['categories']);
    final services = asMapList(data['services']);
    return _cardShell(context, children: [
      Row(children: [
        Expanded(child: Text(asStr(data['title']).isEmpty ? 'کاتالوگ خدمات' : asStr(data['title']), style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700, color: context.ink))),
        Text('${asNum(data['total'])} خدمت', style: TextStyle(fontSize: 10.5, color: context.inkMuted)),
      ]),
      if (categories.isNotEmpty)
        Padding(
          padding: const EdgeInsets.only(top: 6),
          child: Wrap(spacing: 6, runSpacing: 6, children: [
            for (final category in categories.take(8))
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                decoration: BoxDecoration(color: context.surfaceHigh, borderRadius: BorderRadius.circular(999)),
                child: Text('${asStr(category['title'])} (${asNum(category['serviceCount'])})', style: TextStyle(fontSize: 10, color: context.inkMuted)),
              ),
          ]),
        ),
      for (final service in services.take(5))
        Padding(
          padding: const EdgeInsets.only(top: 3),
          child: Row(children: [
            Expanded(child: Text(asStr(service['title']), maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(fontSize: 11, color: context.ink))),
            Text(_money(asNum(service['finalFee']).toDouble()), style: TextStyle(fontSize: 10, color: context.inkMuted)),
          ]),
        ),
      Padding(
        padding: const EdgeInsets.only(top: 6),
        child: OutlinedButton.icon(
          onPressed: onOpenCatalog,
          icon: const Icon(Icons.inventory_2_rounded, size: 15),
          label: const Text('مشاهدهٔ همهٔ خدمات', style: TextStyle(fontSize: 11)),
        ),
      ),
    ]);
  }
}

/* ------------------------------ draft panel ------------------------------- */

class _DraftPanel extends StatefulWidget {
  const _DraftPanel({
    required this.draft,
    required this.busy,
    required this.onPreview,
    required this.onConfirm,
    required this.onCancel,
    required this.onOpenRequest,
  });

  final AssistantDraft draft;
  final bool busy;
  final Future<void> Function() onPreview;
  final Future<void> Function() onConfirm;
  final Future<void> Function() onCancel;
  final void Function(String requestId) onOpenRequest;

  @override
  State<_DraftPanel> createState() => _DraftPanelState();
}

class _DraftPanelState extends State<_DraftPanel> {
  final Map<String, TextEditingController> _controllers = {};
  String _savingKey = '';
  String _uploadingKey = '';

  @override
  void initState() {
    super.initState();
    _syncControllers();
  }

  @override
  void didUpdateWidget(covariant _DraftPanel oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.draft.id != widget.draft.id) _syncControllers();
  }

  @override
  void dispose() {
    for (final controller in _controllers.values) {
      controller.dispose();
    }
    super.dispose();
  }

  void _syncControllers() {
    for (final field in widget.draft.fields) {
      final controller = _controllers[field.key];
      if (controller == null) {
        _controllers[field.key] = TextEditingController(text: field.value);
      } else if (controller.text != field.value && _savingKey != field.key) {
        controller.text = field.value;
      }
    }
  }

  Future<void> _saveField(AssistantDraftField field) async {
    final controller = _controllers[field.key];
    if (controller == null) return;
    final value = controller.text.trim();
    if (value == field.value) return;
    setState(() => _savingKey = field.key);
    try {
      await updateAssistantDraftField(field.key, value);
      if (!mounted) return;
      setState(() {
        _savingKey = '';
        controller.text = value;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() => _savingKey = '');
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(error is ApiException ? error.message : 'ذخیرهٔ فیلد انجام نشد.')));
    }
  }

  Future<void> _uploadDocument(AssistantDraftDocument document) async {
    final file = await pickDocumentFile(context);
    if (file == null || !mounted) return;
    setState(() => _uploadingKey = document.key);
    try {
      final uploaded = await api.uploadFile(file, purpose: 'document', documentQuality: true);
      await attachAssistantDraftFile(document.key, asStr(uploaded['id']));
      if (!mounted) return;
      setState(() => _uploadingKey = '');
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('مدرک به پیش‌نویس اضافه شد.')));
    } catch (error) {
      if (!mounted) return;
      setState(() => _uploadingKey = '');
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(error is ApiException ? error.message : 'بارگذاری مدرک انجام نشد.')));
    }
  }

  Future<void> _useProfileDocument(AssistantDraftDocument document) async {
    if (document.suggestedProfileDocumentId.isEmpty) return;
    setState(() => _uploadingKey = document.key);
    try {
      await attachAssistantDraftProfileDocument(document.key, document.suggestedProfileDocumentId);
      if (!mounted) return;
      setState(() => _uploadingKey = '');
    } catch (error) {
      if (!mounted) return;
      setState(() => _uploadingKey = '');
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(error is ApiException ? error.message : 'افزودن مدرک پروفایل انجام نشد.')));
    }
  }

  @override
  Widget build(BuildContext context) {
    final draft = widget.draft;
    return Container(
      decoration: BoxDecoration(
        color: context.surface,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: draft.awaitingConfirmation ? Colors.orange.shade300 : context.hairline),
      ),
      clipBehavior: Clip.antiAlias,
      child: SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(12, 10, 12, 10),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text('پیش‌نویس درخواست', style: TextStyle(fontSize: 10.5, color: context.inkMuted)),
                Text(draft.serviceTitle, style: TextStyle(fontSize: 13.5, fontWeight: FontWeight.w800, color: context.ink)),
              ]),
            ),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 4),
              decoration: BoxDecoration(
                color: draft.awaitingConfirmation ? Colors.orange.withOpacity(0.14) : context.surfaceHigh,
                borderRadius: BorderRadius.circular(999),
              ),
              child: Text(draft.stageLabel, style: TextStyle(fontSize: 10, fontWeight: FontWeight.w700, color: draft.awaitingConfirmation ? Colors.orange.shade800 : context.inkMuted)),
            ),
          ]),
          const SizedBox(height: 6),
          Row(children: [
            Expanded(child: _cardRow(context, 'زمان تخمینی', _duration(draft.estimatedMinutes, draft.estimatedDays))),
            Expanded(child: _cardRow(context, 'هزینه', draft.pricingTotal > 0 ? _money(draft.pricingTotal) : '—')),
          ]),
          Row(children: [
            Expanded(child: _cardRow(context, 'روش پرداخت', _paymentMethodLabel(draft.paymentMethod))),
            Expanded(child: _cardRow(context, 'اولویت', draft.priority == 'high' ? 'فوری' : 'عادی')),
          ]),
          const SizedBox(height: 6),
          for (final field in draft.fields) _buildField(field),
          if (draft.documents.isNotEmpty) ...[
            const SizedBox(height: 6),
            Text('مدارک موردنیاز', style: TextStyle(fontSize: 11.5, fontWeight: FontWeight.w700, color: context.ink)),
            for (final document in draft.documents) _buildDocument(document),
          ],
          if (draft.missingFields.isNotEmpty || draft.missingDocuments.isNotEmpty)
            Container(
              width: double.infinity,
              margin: const EdgeInsets.only(top: 6),
              padding: const EdgeInsets.all(8),
              decoration: BoxDecoration(color: Colors.orange.withOpacity(0.1), borderRadius: BorderRadius.circular(10)),
              child: Text(
                [
                  if (draft.missingFields.isNotEmpty) 'فیلدهای ناقص: ${draft.missingFields.join('، ')}',
                  if (draft.missingDocuments.isNotEmpty) 'مدارک ناقص: ${draft.missingDocuments.join('، ')}',
                ].join('\n'),
                style: TextStyle(fontSize: 10.5, height: 1.7, color: Colors.orange.shade900),
              ),
            ),
          if (draft.submissionError.isNotEmpty)
            Container(
              width: double.infinity,
              margin: const EdgeInsets.only(top: 6),
              padding: const EdgeInsets.all(8),
              decoration: BoxDecoration(color: Colors.red.withOpacity(0.08), borderRadius: BorderRadius.circular(10)),
              child: Text(draft.submissionError, style: TextStyle(fontSize: 10.5, height: 1.7, color: Colors.red.shade800)),
            ),
          const SizedBox(height: 8),
          Row(children: [
            Expanded(
              child: FilledButton.icon(
                onPressed: widget.busy ? null : () => widget.onPreview(),
                icon: const Icon(Icons.visibility_rounded, size: 16),
                label: const Text('پیش‌نمایش', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700)),
              ),
            ),
            const SizedBox(width: 6),
            if (draft.awaitingConfirmation)
              Expanded(
                child: FilledButton.icon(
                  onPressed: widget.busy ? null : () => widget.onConfirm(),
                  icon: const Icon(Icons.verified_rounded, size: 16),
                  label: const Text('تأیید و ثبت نهایی', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700)),
                ),
              )
            else
              OutlinedButton(
                onPressed: widget.busy ? null : () => widget.onCancel(),
                child: const Text('انصراف', style: TextStyle(fontSize: 12)),
              ),
          ]),
          const SizedBox(height: 6),
          Text(
            'تا تأیید صریح شما هیچ درخواستی ثبت نمی‌شود. پس از تأیید، درخواست از مسیر اصلی سامانه و با همان اعتبارسنجی ایجاد می‌شود.',
            style: TextStyle(fontSize: 9.5, height: 1.6, color: context.inkMuted),
          ),
        ]),
      ),
    );
  }

  Widget _buildField(AssistantDraftField field) {
    final controller = _controllers[field.key];
    final saving = _savingKey == field.key;
    return Padding(
      padding: const EdgeInsets.only(top: 4),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          Text(field.label, style: TextStyle(fontSize: 10.5, color: context.inkMuted)),
          if (field.required) Text(' *', style: TextStyle(fontSize: 10.5, color: Colors.red.shade700)),
          if (field.fromProfile) Padding(padding: const EdgeInsetsDirectional.only(start: 4), child: Text('(از پروفایل)', style: TextStyle(fontSize: 9, color: context.brand))),
          if (saving) Padding(padding: const EdgeInsetsDirectional.only(start: 4), child: Text('در حال ذخیره…', style: TextStyle(fontSize: 9, color: context.inkMuted))),
        ]),
        Row(children: [
          Expanded(
            child: TextField(
              controller: controller,
              enabled: !widget.busy,
              onSubmitted: (_) => _saveField(field),
              decoration: InputDecoration(
                isDense: true,
                contentPadding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
                hintText: field.placeholder.isEmpty ? '—' : field.placeholder,
                errorText: field.error.isEmpty ? null : field.error,
                border: const OutlineInputBorder(),
              ),
              style: TextStyle(fontSize: 12, color: context.ink),
            ),
          ),
          IconButton(
            tooltip: 'ذخیره',
            onPressed: saving ? null : () => _saveField(field),
            icon: saving
                ? const SizedBox(width: 14, height: 14, child: CircularProgressIndicator(strokeWidth: 2))
                : const Icon(Icons.check_rounded, size: 18),
          ),
        ]),
      ]),
    );
  }

  Widget _buildDocument(AssistantDraftDocument document) {
    final uploading = _uploadingKey == document.key;
    return Container(
      width: double.infinity,
      margin: const EdgeInsets.only(top: 5),
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 7),
      decoration: BoxDecoration(
        color: context.surfaceHigh,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: document.error.isEmpty ? context.hairline : Colors.red.shade300),
      ),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          Expanded(
            child: Text('${document.title}${document.required ? ' *' : ''}', style: TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: context.ink)),
          ),
          if (document.attached)
            Text('✓ ${document.attachmentName}', style: TextStyle(fontSize: 10, color: Colors.green.shade700)),
        ]),
        if (!document.attached)
          Row(children: [
            if (document.suggestedProfileDocumentId.isNotEmpty)
              TextButton.icon(
                onPressed: uploading ? null : () => _useProfileDocument(document),
                icon: const Icon(Icons.folder_shared_rounded, size: 14),
                label: Text('استفاده از «${document.suggestedProfileDocumentName}»', style: const TextStyle(fontSize: 10)),
              ),
            const Spacer(),
            TextButton.icon(
              onPressed: uploading ? null : () => _uploadDocument(document),
              icon: uploading
                  ? const SizedBox(width: 12, height: 12, child: CircularProgressIndicator(strokeWidth: 2))
                  : const Icon(Icons.upload_file_rounded, size: 15),
              label: const Text('بارگذاری', style: TextStyle(fontSize: 10)),
            ),
          ]),
        if (document.error.isNotEmpty)
          Text(document.error, style: TextStyle(fontSize: 9.5, color: Colors.red.shade700)),
      ]),
    );
  }
}

String _paymentMethodLabel(String method) => switch (method) {
      'online' => 'پرداخت آنلاین',
      'wallet' => 'کیف پول',
      'cash' => 'حضوری',
      'bank_transfer' => 'انتقال بانکی',
      'later' => 'پرداخت در دفتر',
      _ => method.isEmpty ? '—' : method,
    };

/* -------------------------------- typing ---------------------------------- */

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
                width: 6,
                height: 6,
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
