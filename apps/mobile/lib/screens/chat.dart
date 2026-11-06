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

class _ChatThreadsScreenState extends State<ChatThreadsScreen> {
  List<Map<String, dynamic>> _threads = const [];
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
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
                                  Text(asStr(thread['subject']).isEmpty ? 'گفتگو با دفتر' : asStr(thread['subject']), style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13.5), maxLines: 1, overflow: TextOverflow.ellipsis),
                                  const SizedBox(height: 3),
                                  Text(asStr(thread['lastMessage']).isEmpty ? 'بدون پیام' : asStr(thread['lastMessage']), style: const TextStyle(fontSize: 11.5, color: PishkanColors.mutedText), maxLines: 1, overflow: TextOverflow.ellipsis),
                                ]),
                              ),
                              Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
                                Text(faDate(thread['lastMessageAt']), style: const TextStyle(fontSize: 10.5, color: PishkanColors.mutedText)),
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

class _ChatScreenState extends State<ChatScreen> {
  final _input = TextEditingController();
  final _scroll = ScrollController();
  List<Map<String, dynamic>> _messages = const [];
  bool _loading = true;
  bool _sending = false;
  String? _error;
  Timer? _pollTimer;

  @override
  void initState() {
    super.initState();
    _load();
    // Replies land here while the conversation is open (the office also
    // raises a notification, but the visible chat should update itself).
    _pollTimer = Timer.periodic(const Duration(seconds: 15), (_) => _poll());
  }

  @override
  void dispose() {
    _pollTimer?.cancel();
    _input.dispose();
    _scroll.dispose();
    super.dispose();
  }

  Future<void> _poll() async {
    if (!mounted || _sending) return;
    try {
      final data = await fetchThread(widget.threadId);
      if (!mounted) return;
      final fresh = asMapList(data['messages']);
      if (fresh.length != _messages.length) {
        setState(() => _messages = fresh);
        _jumpToEnd();
      }
    } catch (_) {
      // Polling is silent; the visible list stays as-is on network hiccups.
    }
  }

  Future<void> _load() async {
    try {
      final data = await fetchThread(widget.threadId);
      if (!mounted) return;
      setState(() {
        _messages = asMapList(data['messages']);
        _loading = false;
        _error = null;
      });
      _jumpToEnd();
    } on ApiException catch (error) {
      if (mounted) {
        setState(() {
          _loading = false;
          _error = error.message;
        });
      }
    }
  }

  void _jumpToEnd() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_scroll.hasClients) _scroll.jumpTo(_scroll.position.maxScrollExtent);
    });
  }

  Future<void> _send() async {
    final text = _input.text.trim();
    if (text.isEmpty) return;
    setState(() => _sending = true);
    try {
      await sendChatMessage(widget.threadId, body: text);
      _input.clear();
      await _load();
    } on ApiException catch (error) {
      if (mounted) showSnack(context, error.message, error: true);
    } finally {
      if (mounted) setState(() => _sending = false);
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
        title: Text(widget.title, overflow: TextOverflow.ellipsis),
        actions: [IconButton(onPressed: _load, icon: const Icon(Icons.refresh_rounded))],
      ),
      body: Column(children: [
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
                          itemCount: _messages.length,
                          itemBuilder: (context, index) => _bubble(_messages[index]),
                        ),
        ),
        SafeArea(
          top: false,
          child: Container(
            padding: const EdgeInsets.fromLTRB(10, 8, 10, 10),
            color: Colors.white,
            child: Row(children: [
              IconButton(onPressed: _sending ? null : _sendAttachment, icon: const Icon(Icons.attach_file_rounded)),
              Expanded(
                child: TextField(
                  controller: _input,
                  minLines: 1,
                  maxLines: 4,
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
    return Align(
      alignment: mine ? Alignment.centerRight : Alignment.centerLeft,
      child: Container(
        margin: const EdgeInsets.only(bottom: 8),
        constraints: BoxConstraints(maxWidth: MediaQuery.of(context).size.width * 0.78),
        padding: const EdgeInsets.fromLTRB(13, 10, 13, 8),
        decoration: BoxDecoration(
          gradient: mine ? PishkanColors.brandGradient : null,
          color: mine ? null : Colors.white,
          borderRadius: BorderRadius.only(
            topLeft: const Radius.circular(18),
            topRight: const Radius.circular(18),
            bottomRight: Radius.circular(mine ? 6 : 18),
            bottomLeft: Radius.circular(mine ? 18 : 6),
          ),
          border: mine ? null : Border.all(color: const Color(0xFFE2E8F0)),
        ),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          if (!mine && asStr(message['senderName']).isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(bottom: 3),
              child: Text(asStr(message['senderName']), style: const TextStyle(fontSize: 10.5, fontWeight: FontWeight.w700, color: PishkanColors.primary)),
            ),
          Text(asStr(message['body']), style: TextStyle(fontSize: 13, height: 1.8, color: mine ? Colors.white : const Color(0xFF1E293B))),
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
                  Flexible(child: Text(asStr(file['name']), overflow: TextOverflow.ellipsis, style: TextStyle(fontSize: 11.5, color: mine ? Colors.white : PishkanColors.navy, fontWeight: FontWeight.w600))),
                ]),
              ),
            ),
          ],
          const SizedBox(height: 4),
          Text(faDate(message['createdAt'], withTime: true), style: TextStyle(fontSize: 9.5, color: mine ? Colors.white70 : PishkanColors.mutedText)),
        ]),
      ),
    );
  }
}
