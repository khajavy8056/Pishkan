import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:pishkan_app/core/session.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('migrates the session profile to secure storage and logout removes it', () async {
    FlutterSecureStorage.setMockInitialValues({'pishkan.session.token': 'saved-token'});
    SharedPreferences.setMockInitialValues({
      'pishkan.server.url': 'http://192.168.1.2:3001',
      'pishkan.user.json': '{"id":"customer-1","fullName":"مشتری"}',
      'pishkan.pref.biometric': true,
    });
    final store = SessionStore.instance;
    // Both callers must await the same initial read rather than start races.
    await Future.wait([store.load(), store.load()]);
    expect(store.isSignedIn, isTrue);
    expect(store.userId, 'customer-1');
    expect(store.serverUrl, 'http://192.168.1.2:3001');
    final prefs = await SharedPreferences.getInstance();
    const secure = FlutterSecureStorage();
    expect(prefs.getString('pishkan.user.json'), isNull);
    expect(await secure.read(key: 'pishkan.user.json'), contains('customer-1'));
    await store.signOut();
    expect(store.isSignedIn, isFalse);
    expect(await secure.read(key: 'pishkan.session.token'), isNull);
    expect(await secure.read(key: 'pishkan.user.json'), isNull);
    expect(prefs.getBool('pishkan.pref.biometric'), isNull);
  });
}
