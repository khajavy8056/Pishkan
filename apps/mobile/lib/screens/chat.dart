import 'dart:async';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:open_filex/open_filex.dart';
import 'package:path_provider/path_provider.dart';

import '../core/api.dart';
import '../core/format.dart';
import '../core/theme.dart';
import '../models/models.dart';
import '../services/services.dart';
import '../widgets/widgets.dart';

/// Conversation list (general + per-case threads, same as the web widget).
class ChatThreadsScreen extends StatefulWidget {
  const ChatThreadsScreen({super.key});

  @override
  State<ChatThreadsScreen> createState() => _ChatThreadsScreenState();
}

class _ChatThreadsScreenState extends State<ChatThreadsScreen> with WidgetsBindingObserver {
  List<Map<String, dynamic>> _threads = const [];
  bool _loading = true;
  String? _error;
  Timer? _refreshTimer;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _load();
    // A reply that lands while the list is open should show up without a pull.
    _refreshTimer = Timer.periodic(const Duration(seconds: 20), (_) => _silentRefresh());
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _refreshTimer?.cancel();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) _silentRefresh();
  }

  Future<void> _silentRefresh() async {
    if (!mounted || _loading) return;
    try {
      final threads = await fetchChatThreads();
      if (!mounted) return;
      final before = _threads.map((thread) => '${thread['id']}:${thread['lastMessageAt']}:${thread['unread']}').join('|');
      final after = threads.map((thread) => '${thread['id']}:${thread['lastMessageAt']}:${thread['unread']}').join('|');
      if (before != after) setState(() => _threads = threads);
    } catch (_) {
      // Silent: the list keeps its last good state.
    }
  }

  Future<void> _load() async {
    try {
      final threads = await fetchChatThreads();
      if (mounted) {
        setState(() {
          _threads = threads;
          _loading = false;
          _error = null;
        });
      }
    } on ApiException catch (error) {
      if (mounted) {
        setState(() {
          _loading = false;
          _error = error.message;
        });
      }
    }
  }

  Future<void> _newGeneralThread() async {
    try {
      final id = await openThread(subject: 'گفت‌وگو با دفتر');
      if (!mounted || id.isEmpty) return;
      await Navigator.push(context, MaterialPageRoute(builder: (_) => ChatScreen(threadId: id, title: 'گفت‌وگو با دفتر')));
      _load();
    } on ApiException catch (error) {
      if (mounted) showSnack(context, error.message, error: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('گفتگوها')),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: _newGeneralThread,
        icon: const Icon(Icons.chat_rounded),
        label: const Text('گفتگوی جدید'),
      ),
      body: _loading
          ? const LoadingView()
          : _error != null
              ? ErrorView(message: _error!, onRetry: _load)
              : _threads.isEmpty
                  ? const EmptyView(icon: Icons.chat_bubble_outline_rounded, title: 'هنوز گفتگویی ندارید', hint: 'با دکمهٔ «گفتگوی جدید» می‌توانید همین حالا با دفتر صحبت کنید؛ پاسخ کارشناس همین‌جا می‌آید.')
                  : RefreshIndicator(
                      onRefresh: _load,
                      child: ListView.separated(
                        padding: const EdgeInsets.fromLTRB(16, 10, 16, 90),
                        itemCount: _threads.length,
                        separatorBuilder: (_, _) => const SizedBox(height: 10),
                        itemBuilder: (context, index) {
                          final thread = _threads[index];
                          final unread = asNum(thread['unread']).toInt();
                          return SoftCard(
                            onTap: () async {
                              await Navigator.push(context, MaterialPageRoute(builder: (_) => ChatScreen(threadId: asStr(thread['id']), title: asStr(thread['subject']).isEmpty ? 'گفتگو با دفتر' : asStr(thread['subject']))));
                              _load();
                            },
                            child: Row(children: [
                              CircleAvatar(
                                backgroundColor: PishkanColors.primary.withOpacity(0.12),
                                child: Icon(asStr(thread['requestId']).isEmpty ? Icons.support_agent_rounded : Icons.folder_rounded, color: PishkanColors.primary),
                              ),
                              const SizedBox(width: 12),
                              Expanded(
                                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                  Text(asStr(thread['subject']).isEmpty ? 'گفتگو با دفتر' : asStr(thread['subject']), style: TextStyle(fontWeight: FontWeight.w700, fontSize: 13.5), maxLines: 1, overflow: TextOverflow.ellipsis),
                                  const SizedBox(height: 3),
                                  Text(asStr(thread['lastMessage']).isEmpty ? 'بدون پیام' : asStr(thread['lastMessage']), style: TextStyle(fontSize: 11.5, color: context.inkMuted), maxLines: 1, overflow: TextOverflow.ellipsis),
                                ]),
                              ),
                              Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
                                Text(faDate(thread['lastMessageAt']), style: TextStyle(fontSize: 10.5, color: context.inkMuted)),
                                if (unread > 0) ...[
                                  const SizedBox(height: 5),
                                  Container(
                                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                                    decoration: BoxDecoration(color: PishkanColors.primary, borderRadius: BorderRadius.circular(999)),
                                    child: Text(faDigits(unread), style: const TextStyle(color: Colors.white, fontSize: 11, fontWeight: FontWeight.w800)),
                                  ),
                                ],
                              ]),
                            ]),
                          );
                        },
                      ),
                    ),
    );
  }
}

/// Opens (or creates) the conversation attached to one request, then shows it.
class ChatThreadOpener extends StatefulWidget {
  const ChatThreadOpener({super.key, required this.requestId, required this.requestTitle});

  final String requestId;
  final String requestTitle;

  @override
  State<ChatThreadOpener> createState() => _ChatThreadOpenerState();
}

class _ChatThreadOpenerState extends State<ChatThreadOpener> {
  String? _error;

  @override
  void initState() {
    super.initState();
    _open();
  }

  Future<void> _open() async {
    try {
      final id = await openThread(requestId: widget.requestId);
      if (!mounted) return;
      if (id.isEmpty) throw ApiException('ساخت گفتگو انجام نشد.');
      Navigator.pushReplacement(context, MaterialPageRoute(builder: (_) => ChatScreen(threadId: id, title: 'گفت‌وگو — ${widget.requestTitle}')));
    } on ApiException catch (error) {
      if (mounted) setState(() => _error = error.message);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('گفتگو')),
      body: _error != null
          ? ErrorView(message: _error!, onRetry: _open)
          : const LoadingView(message: 'در حال آماده‌سازی گفتگو…'),
    );
  }
}

/// One conversation: bubbles, attachment sending and viewing, auto-refresh
/// on open and a 15-second background poll while visible.
class ChatScreen extends StatefulWidget {
  const ChatScreen({super.key, required this.threadId, required this.title});

  final String threadId;
  final String title;

  @override
  State<ChatScreen> createState() => _ChatScreenState();
}

class _ChatScreenState extends State<ChatScreen> with WidgetsBindingObserver {
  final _input = TextEditingController();
  final _scroll = ScrollController();
  List<Map<String, dynamic>> _messages = const [];
  bool _loading = true;
  bool _sending = false;
  String? _error;
  Timer? _pollTimer;
  /// Last message timestamp we already hold; the sync call only asks after it.
  String _cursor = '';
  /// Other side's last read time — turns our ticks into double ticks.
  String _counterpartReadAt = '';
  bool _typing = false;
  bool _online = true;
  Timer? _typingDebounce;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _load();
    // The office raises a notification too, but a conversation that is open
    // must update itself — the customer should never have to pull to refresh.
    _pollTimer = Timer.periodic(const Duration(seconds: 4), (_) => _poll());
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    if (_typing) setTyping(widget.threadId, false).ignore();
    _typingDebounce?.cancel();
    _pollTimer?.cancel();
    _input.dispose();
    _scroll.dispose();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      _load(silent: true);
    }
  }

  /// Incremental refresh — only what arrived after our newest message.
  Future<void> _poll() async {
    if (!mounted || _sending || _loading) return;
    if (_cursor.isEmpty) {
      await _load(silent: true);
      return;
    }
    try {
      final data = await syncThread(widget.threadId, after: _cursor);
      if (!mounted) return;
      final fresh = asMapList(data['messages']);
      final readAt = asStr(data['counterpartReadAt']);
      final typing = asBool(data['typing']);
      if (fresh.isEmpty && readAt == _counterpartReadAt && typing == _typing && _online) return;
      setState(() {
        _online = true;
        _typing = typing;
        if (readAt.isNotEmpty) _counterpartReadAt = readAt;
        if (fresh.isNotEmpty) {
          final known = _messages.map((message) => asStr(message['id'])).toSet();
          final added = fresh.where((message) => !known.contains(asStr(message['id']))).toList();
          if (added.isNotEmpty) {
            _messages = [..._messages, ...added];
            _cursor = asStr(added.last['createdAt']);
          }
        }
      });
      if (fresh.isNotEmpty) _jumpToEnd();
    } catch (_) {
      // Silent: a dropped poll must not disturb a conversation in progress.
      if (mounted && _online) setState(() => _online = false);
    }
  }

  Future<void> _load({bool silent = false}) async {
    try {
      final data = await fetchThread(widget.threadId);
      if (!mounted) return;
      final messages = asMapList(data['messages']);
      setState(() {
        _messages = messages;
        _cursor = messages.isEmpty ? '' : asStr(messages.last['createdAt']);
        _loading = false;
        _error = null;
        _online = true;
      });
      if (!silent) _jumpToEnd();
    } on ApiException catch (error) {
      if (mounted && !silent) {
        setState(() {
          _loading = false;
          _error = error.message;
        });
      }
    }
  }

  /// Announce typing once per burst of keystrokes, then let it expire.
  void _onComposing(String _) {
    if (!_typing) {
      _typing = true;
      setTyping(widget.threadId, true).ignore();
    }
    _typingDebounce?.cancel();
    _typingDebounce = Timer(const Duration(seconds: 2), () {
      _typing = false;
      setTyping(widget.threadId, false).ignore();
    });
  }

  void _jumpToEnd() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_scroll.hasClients) _scroll.jumpTo(_scroll.position.maxScrollExtent);
    });
  }

  Future<void> _send() async {
    final text = _input.text.trim();
    if (text.isEmpty || _sending) return;
    // Optimistic bubble: the text appears instantly, in the bubble's final
    // shape with a clock badge, and is swapped for the server copy on success.
    final localId = 'local-${DateTime.now().microsecondsSinceEpoch}';
    setState(() {
      _sending = true;
      _input.clear();
      _messages = [
        ..._messages,
        {
          'id': localId,
          'body': text,
          'senderRole': 'customer',
          'createdAt': DateTime.now().toIso8601String(),
          'pending': true,
        },
      ];
    });
    _jumpToEnd();
    _typingDebounce?.cancel();
    _typing = false;
    setTyping(widget.threadId, false).ignore();
    try {
      await sendChatMessage(widget.threadId, body: text);
      if (!mounted) return;
      setState(() => _sending = false);
      // Pull the authoritative copy (id + server timestamp) quietly.
      await _syncAfterSend(localId);
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _sending = false;
        _messages = _messages.where((message) => asStr(message['id']) != localId).toList();
      });
      showSnack(context, error.message, error: true);
    }
  }

  /// Replace the optimistic bubble with the stored message.
  Future<void> _syncAfterSend(String localId) async {
    try {
      final data = await syncThread(widget.threadId);
      if (!mounted) return;
      final server = asMapList(data['messages']);
      setState(() {
        _messages = server;
        _cursor = server.isEmpty ? '' : asStr(server.last['createdAt']);
        _online = true;
      });
    } catch (_) {
      // The message is stored even if this read failed; the next poll fixes it.
    }
  }

  Future<void> _sendAttachment() async {
    final file = await pickDocumentFile(context, documentScanner: false);
    if (file == null) return;
    setState(() => _sending = true);
    try {
      final fileId = await uploadOne(file);
      await sendChatMessage(widget.threadId, fileId: fileId);
      await _load();
    } on ApiException catch (error) {
      if (mounted) showSnack(context, error.message, error: true);
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  Future<void> _openAttachment(Map<String, dynamic> file) async {
    final fileId = asStr(file['id']);
    final mime = asStr(file['mime']);
    if (mime.startsWith('image/')) {
      Navigator.push(context, MaterialPageRoute(builder: (_) => ImageViewerScreen(url: '/api/files/$fileId', title: asStr(file['name']))));
      return;
    }
    try {
      final dir = await getTemporaryDirectory();
      final name = asStr(file['name']).isEmpty ? 'file-$fileId' : asStr(file['name']);
      final path = '${dir.path}${Platform.pathSeparator}$name';
      await api.downloadTo('/api/files/$fileId?variant=original', path);
      await OpenFilex.open(path);
    } on ApiException catch (error) {
      if (mounted) showSnack(context, error.message, error: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
          Text(widget.title, overflow: TextOverflow.ellipsis),
          Text(
            _typing ? 'در حال نوشتن…' : (_online ? 'گفت‌وگوی زنده با دفتر' : 'تلاش برای اتصال…'),
            style: TextStyle(fontSize: 11, color: _typing ? PishkanColors.primary : context.inkMuted),
          ),
        ]),
        actions: [IconButton(onPressed: _load, icon: const Icon(Icons.refresh_rounded))],
      ),
      body: Column(children: [
        if (!_online && !_loading && _error == null) _offlineStrip(),
        Expanded(
          child: _loading
              ? const LoadingView()
              : _error != null
                  ? ErrorView(message: _error!, onRetry: _load)
                  : _messages.isEmpty
                      ? const EmptyView(icon: Icons.waving_hand_rounded, title: 'سلام! 👋', hint: 'پیامتان را بنویسید؛ کارشناس دفتر در اولین فرصت همین‌جا پاسخ می‌دهد.')
                      : ListView.builder(
                          controller: _scroll,
                          padding: const EdgeInsets.fromLTRB(14, 12, 14, 12),
                          itemCount: _messages.length + (_typing ? 1 : 0),
                          itemBuilder: (context, index) {
                            if (index >= _messages.length) return const _TypingIndicator();
                            return _bubble(_messages[index]);
                          },
                        ),
        ),
        SafeArea(
          top: false,
          child: Container(
            padding: const EdgeInsets.fromLTRB(10, 8, 10, 10),
            color: context.surface,
            child: Row(children: [
              IconButton(onPressed: _sending ? null : _sendAttachment, icon: const Icon(Icons.attach_file_rounded)),
              Expanded(
                child: TextField(
                  controller: _input,
                  minLines: 1,
                  maxLines: 4,
                  textInputAction: TextInputAction.send,
                  onChanged: _onComposing,
                  onSubmitted: (_) => _send(),
                  decoration: const InputDecoration(hintText: 'پیامتان را بنویسید…'),
                ),
              ),
              const SizedBox(width: 6),
              IconButton.filled(
                onPressed: _sending ? null : _send,
                icon: _sending ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2)) : const Icon(Icons.send_rounded),
              ),
            ]),
          ),
        ),
      ]),
    );
  }

  Widget _bubble(Map<String, dynamic> message) {
    final mine = asStr(message['senderRole']) == 'customer';
    final file = message['file'] is Map ? asMap(message['file']) : null;
    final pending = asBool(message['pending']);
    final readAt = asStr(message['readAt']);
    return Align(
      alignment: mine ? Alignment.centerRight : Alignment.centerLeft,
      child: Container(
        margin: const EdgeInsets.only(bottom: 8),
        constraints: BoxConstraints(maxWidth: MediaQuery.of(context).size.width * 0.78),
        padding: const EdgeInsets.fromLTRB(13, 10, 13, 8),
        decoration: BoxDecoration(
          gradient: mine ? PishkanColors.brandGradient : null,
          color: mine ? null : context.surface,
          borderRadius: BorderRadius.only(
            topLeft: const Radius.circular(18),
            topRight: const Radius.circular(18),
            bottomRight: Radius.circular(mine ? 6 : 18),
            bottomLeft: Radius.circular(mine ? 18 : 6),
          ),
          border: mine ? null : Border.all(color: context.hairline),
        ),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          if (!mine && asStr(message['senderName']).isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(bottom: 3),
              child: Text(asStr(message['senderName']), style: TextStyle(fontSize: 10.5, fontWeight: FontWeight.w700, color: PishkanColors.primary)),
            ),
          Text(asStr(message['body']), style: TextStyle(fontSize: 13, height: 1.8, color: mine ? Colors.white : context.ink)),
          if (file != null) ...[
            const SizedBox(height: 8),
            InkWell(
              onTap: () => _openAttachment(file),
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
                decoration: BoxDecoration(color: (mine ? Colors.white : PishkanColors.primary).withOpacity(mine ? 0.16 : 0.08), borderRadius: BorderRadius.circular(12)),
                child: Row(mainAxisSize: MainAxisSize.min, children: [
                  Icon(Icons.insert_drive_file_rounded, size: 18, color: mine ? Colors.white : PishkanColors.primary),
                  const SizedBox(width: 6),
                  Flexible(child: Text(asStr(file['name']), overflow: TextOverflow.ellipsis, style: TextStyle(fontSize: 11.5, color: mine ? Colors.white : context.ink, fontWeight: FontWeight.w600))),
                ]),
              ),
            ),
          ],
          const SizedBox(height: 4),
          Row(mainAxisSize: MainAxisSize.min, children: [
            Text(faDate(message['createdAt'], withTime: true), style: TextStyle(fontSize: 9.5, color: mine ? Colors.white70 : context.inkMuted)),
            if (mine) ...[
              const SizedBox(width: 5),
              // Clock while the message is on its way, single tick once the
              // office has it, double tick once they have opened it.
              if (pending)
                const Icon(Icons.schedule_rounded, size: 12, color: Colors.white70)
              else
                Icon(
                  readAt.isNotEmpty ? Icons.done_all_rounded : Icons.done_rounded,
                  size: 13,
                  color: readAt.isNotEmpty ? const Color(0xFFBBF7D0) : Colors.white70,
                ),
            ],
          ]),
        ]),
      ),
    );
  }

  Widget _offlineStrip() {
    return Container(
      width: double.infinity,
      color: PishkanColors.warning.withOpacity(0.14),
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 7),
      child: Row(mainAxisSize: MainAxisSize.min, children: [
        const Icon(Icons.cloud_off_rounded, size: 15, color: PishkanColors.warning),
        const SizedBox(width: 6),
        Expanded(child: Text('اتصال قطع شد؛ به‌محض برگشتن شبکه پیام‌ها خودکار می‌رسند.', style: TextStyle(fontSize: 11, color: context.ink))),
      ]),
    );
  }
}

/// Three dots that pulse while the office is typing.
class _TypingIndicator extends StatefulWidget {
  const _TypingIndicator();
  @override
  State<_TypingIndicator> createState() => _TypingIndicatorState();
}

class _TypingIndicatorState extends State<_TypingIndicator> with SingleTickerProviderStateMixin {
  late final AnimationController _controller = AnimationController(vsync: this, duration: const Duration(milliseconds: 900))..repeat();

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Align(
      alignment: Alignment.centerLeft,
      child: Container(
        margin: const EdgeInsets.only(bottom: 8),
        padding: const EdgeInsets.symmetric(horizontal: 13, vertical: 11),
        decoration: BoxDecoration(color: context.surface, borderRadius: BorderRadius.circular(16), border: Border.all(color: context.hairline)),
        child: AnimatedBuilder(
          animation: _controller,
          builder: (context, _) => Row(mainAxisSize: MainAxisSize.min, children: [
            for (var index = 0; index < 3; index += 1)
              Container(
                width: 6, height: 6,
                margin: const EdgeInsets.symmetric(horizontal: 2),
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: PishkanColors.primary.withOpacity(0.3 + 0.6 * (1 - (((_controller.value - index * 0.18).abs() * 2.4).clamp(0.0, 1.0)))),
                ),
              ),
          ]),
        ),
      ),
    );
  }
}
