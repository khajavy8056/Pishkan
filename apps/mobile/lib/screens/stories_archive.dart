import 'package:flutter/material.dart';

import '../core/format.dart';
import '../core/theme.dart';
import '../models/models.dart';
import '../services/services.dart';
import '../widgets/widgets.dart';
import 'story_viewer.dart';

/// «همهٔ استوری‌ها و اطلاعیه‌ها»: a tidy list of every published notice
/// group (approved design). Tapping one opens the full-screen viewer from
/// that group, exactly like the home rail.
class StoriesArchiveScreen extends StatefulWidget {
  const StoriesArchiveScreen({super.key});

  @override
  State<StoriesArchiveScreen> createState() => _StoriesArchiveScreenState();
}

class _StoriesArchiveScreenState extends State<StoriesArchiveScreen> {
  List<StoryGroup> _groups = [];
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final groups = await fetchStories();
    if (!mounted) return;
    setState(() {
      _groups = groups;
      _loading = false;
    });
  }

  String _cover(StoryGroup group) {
    for (final item in group.items) {
      if (!item.isVideo && item.effectiveMediaUrl.isNotEmpty) return item.effectiveMediaUrl;
    }
    return '';
  }

  void _open(int index) {
    Navigator.push(context, MaterialPageRoute(builder: (_) => StoryViewerScreen(groups: _groups, initialGroup: index)));
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('استوری‌ها و اطلاعیه‌ها')),
      body: _loading
          ? const LoadingView()
          : _groups.isEmpty
              ? const EmptyView(icon: Icons.auto_stories_rounded, title: 'اطلاعیه‌ای نیست', hint: 'استوری‌ها و خبرهای دفتر اینجا منتشر می‌شوند.')
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView.separated(
                    padding: const EdgeInsets.fromLTRB(16, 10, 16, 20),
                    itemCount: _groups.length,
                    separatorBuilder: (_, _) => const SizedBox(height: 10),
                    itemBuilder: (_, index) => _groupCard(index, _groups[index]),
                  ),
                ),
    );
  }

  Widget _groupCard(int index, StoryGroup group) {
    final first = group.items.isNotEmpty ? group.items.first : null;
    final cover = _cover(group);
    return SoftCard(
      onTap: () => _open(index),
      child: Row(children: [
        ClipRRect(
          borderRadius: BorderRadius.circular(16),
          child: cover.isNotEmpty
              ? SizedBox(width: 96, height: 80, child: AuthImage(url: cover))
              : Container(width: 96, height: 80, decoration: const BoxDecoration(gradient: PishkanColors.brandGradient), child: const Icon(Icons.campaign_rounded, color: Colors.white, size: 32)),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(group.title, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14, color: PishkanColors.navy)),
            if (first != null && first.title.isNotEmpty)
              Text(first.title, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 12, color: PishkanColors.mutedText)),
            if (first != null && first.caption.isNotEmpty)
              Text(first.caption, maxLines: 2, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 11.5, color: PishkanColors.mutedText, height: 1.7)),
            const SizedBox(height: 4),
            Row(children: [
              const Icon(Icons.auto_stories_rounded, size: 14, color: PishkanColors.mutedText),
              const SizedBox(width: 4),
              Text('${faDigits(group.items.length)} استوری', style: const TextStyle(fontSize: 11, color: PishkanColors.mutedText)),
              if (first != null && first.createdAt.isNotEmpty) ...[
                const SizedBox(width: 10),
                const Icon(Icons.calendar_month_outlined, size: 14, color: PishkanColors.mutedText),
                const SizedBox(width: 4),
                Text(faDateNumeric(first.createdAt), style: const TextStyle(fontSize: 11, color: PishkanColors.mutedText)),
              ],
              const Spacer(),
              const Icon(Icons.chevron_left_rounded, color: PishkanColors.primary),
            ]),
          ]),
        ),
      ]),
    );
  }
}
