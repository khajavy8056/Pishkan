import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:pishkan_app/core/referral.dart';
import 'package:pishkan_app/core/session.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  test('only accepts valid invitation URIs and binds them to the configured server', () async {
    SharedPreferences.setMockInitialValues({});
    await SessionStore.instance.setServerUrl('https://office.example');
    await ReferralStore.acceptUri(Uri.parse('pishkan://invite?ref=short&origin=https%3A%2F%2Foffice.example'));
    expect(ReferralStore.code.value, isEmpty);
    const token = 'abcdefghijklmnopqrstuvwxyz123456';
    await ReferralStore.acceptUri(Uri.parse('pishkan://invite?ref=$token&origin=https%3A%2F%2Foffice.example'));
    expect(ReferralStore.code.value, token);
    expect(ReferralStore.matchesServer(token), isTrue);
    await SessionStore.instance.setServerUrl('https://other.example');
    expect(ReferralStore.matchesServer(token), isFalse);
    await ReferralStore.clear();
    expect(ReferralStore.code.value, isEmpty);
    expect((await SharedPreferences.getInstance()).getString('referral.code'), isNull);
  });

  test('a code with no recorded origin is accepted, a foreign origin is not', () async {
    SharedPreferences.setMockInitialValues({});
    // Fresh install, no server configured yet: the code carries no binding.
    expect(ReferralStore.matchesServer(''), isFalse);
    expect(ReferralStore.matchesServer('anything'), isTrue);
    // Once a code is stored with an origin, only that office may receive it.
    await SessionStore.instance.setServerUrl('https://office.example');
    const token = 'zyxwvutsrqponmlkjihgfedcba654321';
    await ReferralStore.acceptUri(Uri.parse('pishkan://invite?ref=$token&origin=https%3A%2F%2Foffice.example'));
    await SessionStore.instance.setServerUrl('https://office.example');
    expect(ReferralStore.matchesServer(token), isTrue);
    await SessionStore.instance.setServerUrl('http://office.example');
    expect(ReferralStore.matchesServer(token), isFalse, reason: 'scheme change is a different origin');
    await ReferralStore.clear();
  });
}
