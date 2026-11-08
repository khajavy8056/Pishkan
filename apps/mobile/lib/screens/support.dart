import 'package:flutter/material.dart';

import '../core/api.dart';
import '../core/format.dart';
import '../core/theme.dart';
import '../models/models.dart';
import '../services/services.dart';
import '../widgets/widgets.dart';
import 'chat.dart';

/// Support hub: live chat with the office + support tickets (list, detail,
/// reply, create, rate) — the very same inboxes the staff see on the web.
class SupportTab extends StatefulWidget {
  const SupportTab({super.key});

  @override
  State<SupportTab> createState() => _SupportTabState();
}

class _SupportTabState extends State<SupportTab> {
  List<Map<String, dynamic>> _tickets = const [];
  bool _loading = true;
  String? _error;

  static String statusLabel(String status) => switch (status) {
        'open' => 'باز',
        'answered' => 'پاسخ داده‌شده',
        'waiting_customer' => 'در انتظار پاسخ شما',
        'resolved' => 'حل‌شده',
        'closed' => 'بسته‌شده',
        _ => status,
      };

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final data = await api.getData('/api/support/tickets', query: {'pageSize': 50});
      final list = data is Map ? asMapList(asMap(data)['items']) : asMapList(data);
      if (mounted) {
        setState(() {
          _tickets = list;
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

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('پشتیبانی')),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () async {
          await Navigator.push(context, MaterialPageRoute(builder: (_) => const NewTicketScreen()));
          _load();
        },
        icon: Icon(Icons.add_rounded),
        label: const Text('تیکت جدید'),
      ),
      body: Column(children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 4),
          child: SoftCard(
            onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const ChatThreadsScreen())),
            child: Row(children: [
              Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(gradient: PishkanColors.brandGradient, borderRadius: BorderRadius.circular(16)),
                child: Icon(Icons.chat_rounded, color: Colors.white),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text('گفتگوی زنده با دفتر', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 14.5, color: context.ink)),
                  Text('برای سؤال‌های سریع؛ کارشناس همان‌جا پاسخ می‌دهد.', style: TextStyle(fontSize: 11.5, color: context.inkMuted)),
                ]),
              ),
              Icon(Icons.chevron_left_rounded, color: context.inkMuted),
            ]),
          ),
        ),
        const Padding(padding: EdgeInsets.fromLTRB(16, 4, 16, 0), child: SectionTitle(title: 'تیکت‌های من')),
        Expanded(
          child: _loading
              ? const LoadingView()
              : _error != null
                  ? ErrorView(message: _error!, onRetry: _load)
                  : _tickets.isEmpty
                      ? const EmptyView(icon: Icons.confirmation_num_outlined, title: 'تیکتی ثبت نکرده‌اید', hint: 'برای موضوع‌های رسمی‌تر (رسیدگی مستند و قابل پیگیری) تیکت بزنید.')
                      : RefreshIndicator(
                          onRefresh: _load,
                          child: ListView.separated(
                            padding: const EdgeInsets.fromLTRB(16, 4, 16, 90),
                            itemCount: _tickets.length,
                            separatorBuilder: (_, _) => const SizedBox(height: 10),
                            itemBuilder: (context, index) {
                              final ticket = _tickets[index];
                              final unread = asNum(ticket['unreadForCustomer']).toInt();
                              return SoftCard(
                                onTap: () async {
                                  await Navigator.push(context, MaterialPageRoute(builder: (_) => TicketDetailScreen(ticketId: asStr(ticket['id']))));
                                  _load();
                                },
                                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                  Row(children: [
                                    Expanded(child: Text(asStr(ticket['subject']), style: TextStyle(fontWeight: FontWeight.w800, fontSize: 13.5), maxLines: 1, overflow: TextOverflow.ellipsis)),
                                    StatusChip(label: statusLabel(asStr(ticket['status'])), status: asStr(ticket['status']) == 'waiting_customer' ? 'waiting_customer' : asStr(ticket['status'])),
                                  ]),
                                  const SizedBox(height: 5),
                                  Text(
                                    asStr(ticket['lastMessage']).isEmpty ? asStr(ticket['departmentLabel']) : asStr(ticket['lastMessage']),
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                    style: TextStyle(fontSize: 11.5, color: context.inkMuted),
                                  ),
                                  const SizedBox(height: 6),
                                  Row(children: [
                                    Text('شماره ${faDigits(asStr(ticket['number']))} · ${faDate(ticket['lastMessageAt'])}', style: TextStyle(fontSize: 10.5, color: context.inkMuted)),
                                    const Spacer(),
                                    if (unread > 0)
                                      Container(
                                        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                                        decoration: BoxDecoration(color: PishkanColors.danger, borderRadius: BorderRadius.circular(999)),
                                        child: Text('${faDigits(unread)} پاسخ تازه', style: const TextStyle(color: Colors.white, fontSize: 10.5, fontWeight: FontWeight.w800)),
                                      ),
                                  ]),
                                ]),
                              );
                            },
                          ),
                        ),
        ),
      ]),
    );
  }
}

class TicketDetailScreen extends StatefulWidget {
  const TicketDetailScreen({super.key, required this.ticketId});

  final String ticketId;

  @override
  State<TicketDetailScreen> createState() => _TicketDetailScreenState();
}

class _TicketDetailScreenState extends State<TicketDetailScreen> {
  final _reply = TextEditingController();
  Map<String, dynamic>? _ticket;
  bool _busy = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _reply.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final ticket = await fetchTicket(widget.ticketId);
      if (mounted) setState(() => _ticket = ticket);
    } on ApiException catch (error) {
      if (mounted) setState(() => _error = error.message);
    }
  }

  Future<void> _send() async {
    final text = _reply.text.trim();
    if (text.length < 2) return;
    setState(() => _busy = true);
    try {
      await api.postData('/api/support/tickets/${widget.ticketId}/reply', body: {'body': text});
      _reply.clear();
      await _load();
    } on ApiException catch (error) {
      if (mounted) showSnack(context, error.message, error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _rate(int rating) async {
    try {
      await api.postData('/api/support/tickets/${widget.ticketId}/rate', body: {'rating': rating});
      showSnack(context, 'ممنون از بازخوردتان 🌟');
      await _load();
    } on ApiException catch (error) {
      if (mounted) showSnack(context, error.message, error: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    final ticket = _ticket;
    final messages = ticket == null ? const <Map<String, dynamic>>[] : asMapList(ticket['messages']);
    final closed = ticket != null && ['closed', 'resolved'].contains(asStr(ticket['status']));
    return Scaffold(
      appBar: AppBar(title: Text(ticket == null ? 'تیکت' : 'تیکت ${faDigits(asStr(ticket['number']))}', overflow: TextOverflow.ellipsis)),
      body: ticket == null
          ? (_error != null ? ErrorView(message: _error!, onRetry: _load) : const LoadingView())
          : Column(children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
                child: SoftCard(
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text(asStr(ticket['subject']), style: TextStyle(fontWeight: FontWeight.w800, fontSize: 14.5, color: context.ink)),
                    const SizedBox(height: 6),
                    Wrap(spacing: 8, runSpacing: 6, children: [
                      StatusChip(label: _SupportTabState.statusLabel(asStr(ticket['status'])), status: asStr(ticket['status'])),
                      StatusChip(label: asStr(ticket['departmentLabel']).isEmpty ? asStr(ticket['department']) : asStr(ticket['departmentLabel']), status: 'open'),
                      if (asNum(ticket['rating']) > 0) StatusChip(label: 'امتیاز شما: ${faDigits(asNum(ticket['rating']).toInt())} از ۵', status: 'paid'),
                    ]),
                    if (closed && asNum(ticket['rating']) == 0) ...[
                      const SizedBox(height: 10),
                      const Text('از پاسخ‌گویی پشتیبانی چقدر راضی بودید؟', style: TextStyle(fontSize: 12)),
                      Row(children: [
                        for (var i = 1; i <= 5; i++)
                          IconButton(onPressed: () => _rate(i), icon: Icon(i <= 3 ? Icons.star_border_rounded : Icons.star_rounded, color: PishkanColors.warning)),
                      ]),
                    ],
                  ]),
                ),
              ),
              Expanded(
                child: ListView.builder(
                  padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
                  itemCount: messages.length,
                  itemBuilder: (context, index) {
                    final message = messages[index];
                    final mine = asStr(message['senderRole']) == 'customer' || asBool(message['mine']);
                    return Align(
                      alignment: mine ? Alignment.centerRight : Alignment.centerLeft,
                      child: Container(
                        margin: const EdgeInsets.only(bottom: 8),
                        constraints: BoxConstraints(maxWidth: MediaQuery.of(context).size.width * 0.82),
                        padding: const EdgeInsets.fromLTRB(13, 10, 13, 8),
                        decoration: BoxDecoration(
                          gradient: mine ? PishkanColors.brandGradient : null,
                          color: mine ? null : Colors.white,
                          borderRadius: BorderRadius.circular(18),
                          border: mine ? null : Border.all(color: context.hairline),
                        ),
                        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                          if (!mine && asStr(message['senderName']).isNotEmpty)
                            Padding(padding: const EdgeInsets.only(bottom: 3), child: Text(asStr(message['senderName']), style: TextStyle(fontSize: 10.5, fontWeight: FontWeight.w700, color: PishkanColors.primary))),
                          Text(asStr(message['body']), style: TextStyle(fontSize: 13, height: 1.8, color: mine ? Colors.white : const Color(0xFF1E293B))),
                          const SizedBox(height: 4),
                          Text(faDate(message['createdAt'], withTime: true), style: TextStyle(fontSize: 9.5, color: mine ? Colors.white70 : context.inkMuted)),
                        ]),
                      ),
                    );
                  },
                ),
              ),
              if (!closed)
                SafeArea(
                  top: false,
                  child: Container(
                    padding: const EdgeInsets.fromLTRB(10, 8, 10, 10),
                    color: context.surface,
                    child: Row(children: [
                      Expanded(child: TextField(controller: _reply, minLines: 1, maxLines: 4, decoration: const InputDecoration(hintText: 'پاسخ شما…'))),
                      const SizedBox(width: 6),
                      IconButton.filled(onPressed: _busy ? null : _send, icon: const Icon(Icons.send_rounded)),
                    ]),
                  ),
                ),
            ]),
    );
  }
}

class NewTicketScreen extends StatefulWidget {
  const NewTicketScreen({super.key});

  @override
  State<NewTicketScreen> createState() => _NewTicketScreenState();
}

class _NewTicketScreenState extends State<NewTicketScreen> {
  final _subject = TextEditingController();
  final _body = TextEditingController();
  List<Map<String, dynamic>> _departments = const [];
  String _department = '';
  String _priority = 'normal';
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _loadMeta();
  }

  @override
  void dispose() {
    _subject.dispose();
    _body.dispose();
    super.dispose();
  }

  Future<void> _loadMeta() async {
    try {
      final meta = asMap(await api.getData('/api/support/meta'));
      final departments = asMapList(meta['departments']);
      if (mounted) {
        setState(() {
          _departments = departments;
          if (departments.isNotEmpty) _department = asStr(departments.first['value']);
        });
      }
    } catch (_) {
      // Defaults below still let the customer reach the server validation.
      if (mounted) {
        setState(() {
          _departments = const [
            {'value': 'general', 'label': 'پشتیبانی عمومی'},
          ];
          _department = 'general';
        });
      }
    }
  }

  Future<void> _submit() async {
    if (_subject.text.trim().length < 3 || _body.text.trim().length < 5) {
      showSnack(context, 'عنوان (حداقل ۳ حرف) و توضیح کامل لازم است.', error: true);
      return;
    }
    setState(() => _busy = true);
    try {
      await api.postData('/api/support/tickets', body: {
        'department': _department.isEmpty ? 'general' : _department,
        'subject': _subject.text.trim(),
        'body': _body.text.trim(),
        'priority': _priority,
      });
      if (mounted) {
        showSnack(context, 'تیکت شما ثبت شد؛ پاسخ را همین‌جا می‌بینید.');
        Navigator.pop(context);
      }
    } on ApiException catch (error) {
      if (mounted) showSnack(context, error.message, error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('تیکت جدید')),
      body: ListView(padding: const EdgeInsets.fromLTRB(16, 10, 16, 24), children: [
        SoftCard(
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            if (_departments.isNotEmpty) ...[
              DropdownButtonFormField<String>(
                value: _department.isEmpty ? null : _department,
                decoration: const InputDecoration(labelText: 'بخش مربوطه'),
                items: _departments.map((d) => DropdownMenuItem(value: asStr(d['value']), child: Text(asStr(d['label'])))).toList(),
                onChanged: (v) => setState(() => _department = v ?? ''),
              ),
              const SizedBox(height: 12),
            ],
            TextField(controller: _subject, decoration: const InputDecoration(labelText: 'عنوان درخواست')),
            const SizedBox(height: 12),
            TextField(controller: _body, maxLines: 5, decoration: const InputDecoration(labelText: 'توضیحات کامل')),
            const SizedBox(height: 12),
            const Text('اولویت', style: TextStyle(fontWeight: FontWeight.w700, fontSize: 13)),
            const SizedBox(height: 8),
            Wrap(spacing: 8, children: [
              for (final (value, label) in [('low', 'کم'), ('normal', 'معمولی'), ('high', 'زیاد'), ('urgent', 'فوری')])
                ChoiceChip(label: Text(label), selected: _priority == value, onSelected: (_) => setState(() => _priority = value)),
            ]),
            const SizedBox(height: 18),
            PlushButton(label: 'ثبت تیکت', icon: Icons.send_rounded, loading: _busy, onPressed: _submit),
          ]),
        ),
      ]),
    );
  }
}
