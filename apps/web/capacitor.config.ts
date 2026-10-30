import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Android (and future iOS) shell for the same SPA.
 *
 * The app ships the built `dist/` folder and talks to the production API over
 * HTTPS. Set `PISHKAN_SERVER_URL` at build time:
 *
 *   PISHKAN_SERVER_URL=https://pishkan.example.ir npm run build
 *   npx cap sync android
 *
 * For a fully offline-capable shell, remove `server.url` and point requests to
 * the bundled assets — but a government service desk needs live data, so the
 * default is the remote origin.
 */
const serverUrl = process.env.PISHKAN_SERVER_URL || '';

const config: CapacitorConfig = {
  appId: 'ir.pishkan.daftar',
  appName: 'دفتر پیشخوان',
  webDir: 'dist',
  bundledWebRuntime: false,
  android: {
    allowMixedContent: false,
    captureInput: true,
    webContentsDebuggingEnabled: false,
  },
  server: serverUrl
    ? { url: serverUrl, cleartext: false, androidScheme: 'https' }
    : { androidScheme: 'https' },
  plugins: {
    SplashScreen: {
      launchAutoHide: true,
      backgroundColor: '#0b1f3a',
      showSpinner: false,
    },
  },
};

export default config;
