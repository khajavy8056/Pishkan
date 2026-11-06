import 'package:local_auth/local_auth.dart';

/// Fingerprint/face unlock for returning customers (design's «ورود با اثر
/// انگشت»). The session token already lives in encrypted storage; biometrics
/// simply gate access to it on this device.
class BiometricAuth {
  static final LocalAuthentication _auth = LocalAuthentication();

  static Future<bool> isAvailable() async {
    try {
      final supported = await _auth.isDeviceSupported();
      final canCheck = await _auth.canCheckBiometrics;
      return supported && canCheck;
    } catch (_) {
      return false;
    }
  }

  static Future<bool> authenticate() async {
    try {
      return await _auth.authenticate(
        localizedReason: 'برای ورود به حساب پیشخوان، هویت خود را تأیید کنید.',
        options: const AuthenticationOptions(stickyAuth: true, biometricOnly: true),
      );
    } catch (_) {
      return false;
    }
  }
}
