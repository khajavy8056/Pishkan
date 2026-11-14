import 'dart:io';

import 'package:camera/camera.dart';
import 'package:flutter/material.dart';
import 'package:image_cropper/image_cropper.dart';

/// Document-specific camera. The overlay guides framing; cropping and rotation
/// are explicit. It does not assert that the content is readable or a given
/// document type; the server performs a separate preliminary quality screen.
class DocumentCameraScreen extends StatefulWidget {
  const DocumentCameraScreen({super.key});

  @override
  State<DocumentCameraScreen> createState() => _DocumentCameraScreenState();
}

class _DocumentCameraScreenState extends State<DocumentCameraScreen> with WidgetsBindingObserver {
  CameraController? _camera;
  String? _error;
  File? _capture;
  bool _busy = false;
  bool _torch = false;
  int _generation = 0;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _openCamera();
  }

  Future<void> _openCamera() async {
    final generation = ++_generation;
    try {
      final cameras = await availableCameras();
      if (cameras.isEmpty) throw StateError('No camera');
      final camera = cameras.firstWhere((c) => c.lensDirection == CameraLensDirection.back, orElse: () => cameras.first);
      final controller = CameraController(camera, ResolutionPreset.high, enableAudio: false);
      await controller.initialize();
      if (!mounted || generation != _generation) { await controller.dispose(); return; }
      _camera = controller;
      setState(() { _error = null; _torch = false; });
    } catch (_) {
      if (mounted && generation == _generation) setState(() => _error = 'دوربین باز نشد. اجازهٔ دوربین را در تنظیمات گوشی بررسی کنید.');
    }
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.inactive || state == AppLifecycleState.paused) {
      _generation++;
      final camera = _camera;
      _camera = null;
      camera?.dispose();
    } else if (state == AppLifecycleState.resumed && _camera == null && _capture == null) {
      _openCamera();
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _generation++;
    _camera?.dispose();
    super.dispose();
  }

  Future<void> _takePhoto() async {
    final camera = _camera;
    if (camera == null || !camera.value.isInitialized || _busy) return;
    setState(() => _busy = true);
    try {
      final photo = await camera.takePicture();
      if (mounted) setState(() => _capture = File(photo.path));
    } catch (_) {
      if (mounted) setState(() => _error = 'عکس گرفته نشد. دوباره تلاش کنید.');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _toggleTorch() async {
    final camera = _camera;
    if (camera == null) return;
    try {
      await camera.setFlashMode(_torch ? FlashMode.off : FlashMode.torch);
      if (mounted) setState(() => _torch = !_torch);
    } catch (_) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('چراغ در این دوربین در دسترس نیست.')));
    }
  }

  Future<void> _crop() async {
    final captured = _capture;
    if (captured == null || _busy) return;
    setState(() => _busy = true);
    try {
      final cropped = await ImageCropper().cropImage(sourcePath: captured.path, uiSettings: [
        AndroidUiSettings(toolbarTitle: 'برش و چرخش مدرک', toolbarColor: const Color(0xFF0B1F3A), toolbarWidgetColor: Colors.white,
            lockAspectRatio: false),
      ]);
      if (mounted && cropped != null) setState(() => _capture = File(cropped.path));
    } catch (_) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('ویرایش تصویر انجام نشد؛ عکس اصلی باقی مانده است.')));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final camera = _camera;
    return Scaffold(
      backgroundColor: Colors.black,
      appBar: AppBar(backgroundColor: Colors.black, foregroundColor: Colors.white,
        title: const Text('دوربین مدرک', style: TextStyle(color: Colors.white)),
        actions: [if (_capture == null) IconButton(tooltip: 'چراغ', onPressed: _toggleTorch, icon: Icon(_torch ? Icons.flash_on : Icons.flash_off))]),
      body: SafeArea(child: Column(children: [
        const Padding(padding: EdgeInsets.all(12), child: Text('مدرک را صاف، در نور کافی و کامل داخل کادر قرار دهید.', textAlign: TextAlign.center, style: TextStyle(color: Colors.white))),
        Expanded(child: Padding(padding: const EdgeInsets.all(14), child: ClipRRect(borderRadius: BorderRadius.circular(16), child: Stack(fit: StackFit.expand, children: [
          if (_capture != null) Image.file(_capture!, fit: BoxFit.contain)
          else if (camera != null && camera.value.isInitialized) Center(child: CameraPreview(camera))
          else Center(child: _error == null ? const CircularProgressIndicator(color: Colors.white) : Text(_error!, textAlign: TextAlign.center, style: TextStyle(color: Colors.white))),
          if (_capture == null && camera != null && camera.value.isInitialized)
            IgnorePointer(child: Center(child: Container(width: double.infinity, height: 220, margin: const EdgeInsets.symmetric(horizontal: 16), decoration: BoxDecoration(border: Border.all(color: Colors.white, width: 2), borderRadius: BorderRadius.circular(14))))),
        ])))),
        if (_capture == null) ...[
          if (_error != null) TextButton(onPressed: _openCamera, child: const Text('تلاش دوباره')),
          IconButton.filled(onPressed: _busy ? null : _takePhoto, iconSize: 44, icon: const Icon(Icons.camera_alt_rounded), tooltip: 'گرفتن عکس'),
        ] else
          Wrap(alignment: WrapAlignment.center, spacing: 12, children: [
            OutlinedButton.icon(onPressed: _busy ? null : () { setState(() => _capture = null); if (_camera == null) _openCamera(); }, icon: const Icon(Icons.refresh), label: const Text('عکس دوباره')),
            OutlinedButton.icon(onPressed: _busy ? null : _crop, icon: const Icon(Icons.crop_rotate), label: const Text('برش و چرخش')),
            FilledButton.icon(onPressed: _busy ? null : () => Navigator.pop(context, _capture), icon: const Icon(Icons.check), label: const Text('استفاده از عکس')),
          ]),
        const SizedBox(height: 16),
      ])),
    );
  }
}
