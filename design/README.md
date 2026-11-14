# Brand assets

The visual identity of تک پیشخوان. Everything here is the **source of truth**;
the app and the web bundle are generated from these files.

## Files

| File | Use |
| --- | --- |
| `logo-source/build/logo-mark.png` | Symbol only, transparent, 1090×688. The app icon, splash, favicons. |
| `logo-source/build/logo-mark.svg` | Same mark as vector paths (66 paths, ~95 KB). Sharp at any size. |
| `logo-source/build/logo-full-color.png` | Mark + wordmark, navy wordmark. Light backgrounds. |
| `logo-source/build/logo-full-dark.png` | Mark + wordmark, **white** wordmark. Dark backgrounds. |
| `logo-source/build/app-icon-navy-1024.png` | Launcher icon, navy tile. |
| `logo-source/build/app-icon-light-1024.png` | Launcher icon, white tile. |
| `logo-source/build/app-icon-foreground-1024.png` | Adaptive-icon foreground layer, transparent, mark inside the 60% safe zone. |
| `logo-source/redraw-master.png` | The redraw on a flat magenta key, before alpha extraction. Re-derive `logo-mark.png` from this if it is ever needed. |
| `logo-source/original-reference.png` | The design the team supplied. Kept for provenance — do not ship. |

## Where each one is used

- **Android launcher** — `apps/mobile/android/app/src/main/res/mipmap-*/ic_launcher.png`
  (48/72/96/144/192 px) and `ic_launcher_foreground.png` (108/162/216/324/432 px,
  108dp canvas). The adaptive XML is `mipmap-anydpi-v26/ic_launcher.xml`; its
  background colour lives in `values/ic_launcher_background.xml` (`#0B1F3A`).
- **In-app logo** — `apps/mobile/assets/icon.png`, a 1024² transparent square.
  Splash, login, profile and server-setup all draw it inside `ClipOval`/
  `ClipRRect`, so it must stay square **and** keep its alpha channel.
- **Web** — `apps/web/public/favicon.svg`, `favicon.ico`,
  `icons/icon-{64,192,512}.png`, `icons/apple-touch-icon.png`,
  `icons/favicon-512.png`.

## Regenerating

Nothing here is produced by a checked-in script — the artwork came out of the
redraw pass and was exported with PIL. To change the icon, replace
`logo-mark.png`, then rebuild the derived sizes at the exact dimensions listed
above and re-run `apps/mobile/test/brand_assets_test.dart`, which pins every
size and the alpha channel.

## Notes

- The wordmark is set in **Vazirmatn Bold** (`apps/mobile/assets/fonts/`), the
  same face the app uses, so the logo and the UI never drift apart.
- `assets/icon.png` is intentionally *not* listed under `assets/brand/` in
  `pubspec.yaml`; the full logo files are ≈1 MB and no screen uses them yet.
