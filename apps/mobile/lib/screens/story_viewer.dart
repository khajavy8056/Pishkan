import 'dart:async';

import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:video_player/video_player.dart';

import '../core/home_navigation.dart';
import '../models/models.dart';
import '../services/services.dart';
import '../widgets/widgets.dart';

/// Full-screen story player for the office announcements published from the
/// web admin («تنظیمات اپ اندروید»). Tap edges to move, auto-advance on
/// timer/video end, optional action link per story.
class StoryViewerScreen extends StatefulWidget {
  const StoryViewerScreen({super.key, required this.groups, this.initialGroup = 0});

  final List<StoryGroup> groups;
  final int initialGroup;

  @override
  State<StoryViewerScreen> createState() => _StoryViewerScreenState();
}

class _StoryViewerScreenState extends State<StoryViewerScreen> {
  late List<StoryGroup> _groups;
  late int _groupIndex;
  int _itemIndex = 0;
  bool _closing = false;
  int _playGeneration = 0;
  Timer? _timer;
  double _progress = 0;
  VideoPlayerController? _video;
  bool _videoReady = false;

  StoryGroup get _group => _groups[_groupIndex];
  StoryItem get _item => _group.items[_itemIndex];

  @override
  void initState() {
    super.initState();
    _groups = widget.groups.where((group) => group.items.isNotEmpty).toList();
    final requested = widget.groups.isEmpty ? null : widget.groups[widget.initialGroup.clamp(0, widget.groups.length - 1).toInt()];
    final requestedIndex = requested == null ? -1 : _groups.indexOf(requested);
    _groupIndex = requestedIndex < 0 ? 0 : requestedIndex;
    if (_groups.isEmpty) {
      WidgetsBinding.instance.addPostFrameCallback((_) { if (mounted) Navigator.maybePop(context); });
    } else {
      _playCurrent();
    }
  }

  @override
  void dispose() {
    _closing = true;
    _playGeneration++;
    _timer?.cancel();
    _video?.removeListener(_onVideoTick);
    _video?.dispose();
    super.dispose();
  }

  Future<void> _playCurrent() async {
    final generation = ++_playGeneration;
    _timer?.cancel();
    final previous = _video;
    _video = null;
    previous?.removeListener(_onVideoTick);
    await previous?.dispose();
    if (!mounted || _closing || generation != _playGeneration) return;
    _videoReady = false;
    _progress = 0;
    setState(() {});

    final item = _item;
    if (item.isVideo) {
      final controller = VideoPlayerController.networkUrl(
        Uri.parse(api.absolute(item.effectiveMediaUrl)),
        httpHeaders: api.authHeaders(item.effectiveMediaUrl),
      );
      _video = controller;
      try {
        await controller.initialize();
        if (!mounted || _closing || generation != _playGeneration || _video != controller) return;
        setState(() => _videoReady = true);
        controller.addListener(_onVideoTick);
        await controller.play();
      } catch (_) {
        if (mounted && !_closing && generation == _playGeneration && _video == controller) {
          _startTimer(item.durationSeconds);
        }
      }
    } else {
      _startTimer(item.durationSeconds);
    }
  }

  void _onVideoTick() {
    final controller = _video;
    if (controller == null || !controller.value.isInitialized) return;
    final duration = controller.value.duration.inMilliseconds;
    if (duration > 0) {
      final next = controller.value.position.inMilliseconds / duration;
      if (mounted) setState(() => _progress = next.clamp(0, 1));
      if (next >= 1) _next();
    }
  }

  void _startTimer(int seconds) {
    final totalMs = (seconds < 1 ? 5 : seconds) * 1000;
    var elapsed = 0;
    _timer = Timer.periodic(const Duration(milliseconds: 50), (timer) {
      elapsed += 50;
      if (!mounted) {
        timer.cancel();
        return;
      }
      setState(() => _progress = (elapsed / totalMs).clamp(0, 1));
      if (elapsed >= totalMs) _next();
    });
  }

  void _next() {
    if (_closing || _groups.isEmpty) return;
    _timer?.cancel();
    _video?.removeListener(_onVideoTick);
    if (_itemIndex < _group.items.length - 1) {
      _itemIndex++;
    } else if (_groupIndex < _groups.length - 1) {
      _groupIndex++;
      _itemIndex = 0;
    } else {
      _closing = true;
      _playGeneration++;
      requestHomeTab();
      Navigator.popUntil(context, (route) => route.isFirst);
      return;
    }
    _playCurrent();
  }

  void _previous() {
    if (_closing || _groups.isEmpty) return;
    _timer?.cancel();
    _video?.removeListener(_onVideoTick);
    if (_itemIndex > 0) {
      _itemIndex--;
    } else if (_groupIndex > 0) {
      _groupIndex--;
      _itemIndex = _group.items.length - 1;
    }
    _playCurrent();
  }

  void _close() {
    if (_closing) return;
    _closing = true;
    _playGeneration++;
    _timer?.cancel();
    _video?.removeListener(_onVideoTick);
    Navigator.maybePop(context);
  }

  Future<void> _openLink(String link) async {
    final uri = Uri.tryParse(api.absolute(link));
    if (uri == null) return;
    await launchUrl(uri, mode: LaunchMode.externalApplication);
  }

  @override
  Widget build(BuildContext context) {
    if (_groups.isEmpty) {
      return const Scaffold(backgroundColor: Colors.black, body: Center(child: Text('استوری‌ای برای نمایش نیست.', style: TextStyle(color: Colors.white))));
    }
    final item = _item;
    return Scaffold(
      backgroundColor: Colors.black,
      body: SafeArea(
        child: Stack(children: [
          Positioned.fill(
            child: item.isVideo
                ? (_videoReady && _video != null
                    ? Center(child: AspectRatio(aspectRatio: _video!.value.aspectRatio, child: VideoPlayer(_video!)))
                    : const Center(child: CircularProgressIndicator(color: Colors.white)))
                : AuthImage(url: item.effectiveMediaUrl, fit: BoxFit.contain),
          ),
          // Tap zones: in RTL, tapping the start side goes back.
          Row(children: [
            Expanded(child: GestureDetector(onTap: _next, behavior: HitTestBehavior.translucent, child: const SizedBox.expand())),
            Expanded(child: GestureDetector(onTap: _previous, behavior: HitTestBehavior.translucent, child: const SizedBox.expand())),
          ]),
          Positioned(
            top: 8,
            left: 12,
            right: 12,
            child: Column(children: [
              Row(children: [
                for (var i = 0; i < _group.items.length; i++) ...[
                  Expanded(
                    child: ClipRRect(
                      borderRadius: BorderRadius.circular(4),
                      child: LinearProgressIndicator(
                        value: i < _itemIndex ? 1 : i == _itemIndex ? _progress : 0,
                        minHeight: 3.5,
                        backgroundColor: Colors.white30,
                        valueColor: const AlwaysStoppedAnimation(Colors.white),
                      ),
                    ),
                  ),
                  if (i < _group.items.length - 1) const SizedBox(width: 5),
                ],
              ]),
              const SizedBox(height: 10),
              Row(children: [
                const CircleAvatar(backgroundColor: Colors.white24, child: Icon(Icons.campaign_rounded, color: Colors.white, size: 19)),
                const SizedBox(width: 9),
                Expanded(
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text(
                      item.title.isEmpty ? _group.title : item.title,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w700, fontSize: 13.5),
                    ),
                    Text(
                      '${_group.title} • استوری ${_itemIndex + 1} از ${_group.items.length}',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(color: Colors.white70, fontSize: 10.5),
                    ),
                  ]),
                ),
                IconButton(onPressed: _close, icon: const Icon(Icons.close_rounded, color: Colors.white)),
              ]),
            ]),
          ),
          Positioned(
            bottom: 22,
            left: 20,
            right: 20,
            child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              if (item.caption.isNotEmpty) ...[
                Container(
                  padding: const EdgeInsets.all(13),
                  decoration: BoxDecoration(color: Colors.black.withOpacity(0.45), borderRadius: BorderRadius.circular(16)),
                  child: Text(item.caption, style: const TextStyle(color: Colors.white, fontSize: 13, height: 1.9)),
                ),
                const SizedBox(height: 12),
              ],
              if (item.linkUrl.isNotEmpty) PlushButton(label: item.linkLabel, icon: Icons.open_in_new_rounded, onPressed: () => _openLink(item.linkUrl)),
            ]),
          ),
        ]),
      ),
    );
  }
}
