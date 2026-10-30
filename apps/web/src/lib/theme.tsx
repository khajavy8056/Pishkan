import { useCallback, useEffect, useSyncExternalStore, type ReactNode } from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';
import clsx from 'clsx';

/**
 * Theme store — light / dark / system.
 *
 * The store lives outside React so that any component (public header, shell,
 * settings page, tests rendered without providers) can read and change the
 * theme. `ThemeProvider` only wires browser side effects: applying the class to
 * <html>, persisting the choice and following the OS preference while the user
 * keeps "system" selected.
 */

export type ThemeMode = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'pishkan.theme';

/** Address-bar colour per theme (also used by the PWA manifest). */
export const THEME_COLORS: Record<ResolvedTheme, string> = {
  light: '#f2f6fc',
  dark: '#060c17',
};

export const THEME_OPTIONS: { value: ThemeMode; label: string; hint: string }[] = [
  { value: 'light', label: 'روشن', hint: 'همیشه روشن' },
  { value: 'dark', label: 'تیره', hint: 'همیشه تیره' },
  { value: 'system', label: 'سیستم', hint: 'هماهنگ با تنظیم دستگاه' },
];

function hasWindow(): boolean {
  return typeof window !== 'undefined' && typeof document !== 'undefined';
}

export function systemPrefersDark(): boolean {
  if (!hasWindow() || typeof window.matchMedia !== 'function') return false;
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  } catch {
    return false;
  }
}

export function resolveTheme(mode: ThemeMode): ResolvedTheme {
  return mode === 'system' ? (systemPrefersDark() ? 'dark' : 'light') : mode;
}

export function isThemeMode(value: unknown): value is ThemeMode {
  return value === 'light' || value === 'dark' || value === 'system';
}

function readStoredMode(): ThemeMode {
  if (!hasWindow()) return 'system';
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isThemeMode(stored) ? stored : 'system';
  } catch {
    return 'system';
  }
}

let currentMode: ThemeMode = readStoredMode();
let currentResolved: ResolvedTheme = resolveTheme(currentMode);
let snapshot = `${currentMode}:${currentResolved}`;
const listeners = new Set<() => void>();

/** Apply the resolved theme to the document (idempotent, safe to call twice). */
export function applyTheme(resolved: ResolvedTheme): void {
  if (!hasWindow()) return;
  const root = document.documentElement;
  root.classList.toggle('dark', resolved === 'dark');
  root.dataset.theme = resolved;
  root.style.colorScheme = resolved;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', THEME_COLORS[resolved]);
}

function publish(nextMode: ThemeMode, options: { persist?: boolean; notify?: boolean } = {}): void {
  currentMode = nextMode;
  currentResolved = resolveTheme(nextMode);
  snapshot = `${currentMode}:${currentResolved}`;
  applyTheme(currentResolved);
  if (options.persist !== false && hasWindow()) {
    try {
      if (nextMode === 'system') window.localStorage.removeItem(THEME_STORAGE_KEY);
      else window.localStorage.setItem(THEME_STORAGE_KEY, nextMode);
    } catch {
      /* storage can be blocked; the in-memory theme still applies */
    }
  }
  if (options.notify !== false) listeners.forEach((listener) => listener());
}

/** Change the theme; persisted immediately. */
export function setThemeMode(mode: ThemeMode): void {
  if (mode === currentMode) {
    applyTheme(currentResolved);
    return;
  }
  publish(mode);
}

/** Switch between the two concrete themes (used by the compact toggle). */
export function toggleTheme(): ResolvedTheme {
  const next: ResolvedTheme = currentResolved === 'dark' ? 'light' : 'dark';
  publish(next);
  return next;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): string {
  return snapshot;
}

function getServerSnapshot(): string {
  return 'system:light';
}

export interface ThemeApi {
  mode: ThemeMode;
  /** `theme` is an alias used by older call sites. */
  theme: ResolvedTheme;
  resolved: ResolvedTheme;
  setMode: (mode: ThemeMode) => void;
  toggle: () => void;
}

export function useTheme(): ThemeApi {
  const value = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const [mode, resolved] = value.split(':') as [ThemeMode, ResolvedTheme];
  const setMode = useCallback((next: ThemeMode) => setThemeMode(next), []);
  const toggle = useCallback(() => { toggleTheme(); }, []);
  return { mode, theme: resolved, resolved, setMode, toggle };
}

/**
 * Applies the theme on mount and keeps "system" in sync with the OS setting.
 * Renders nothing extra, so it can wrap the app without changing layout.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    // Re-read storage in case another tab (or the boot script) changed it.
    publish(readStoredMode(), { persist: false, notify: true });

    const media = typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-color-scheme: dark)')
      : null;
    const onChange = () => {
      if (currentMode === 'system') publish('system', { persist: false, notify: true });
      else applyTheme(currentResolved);
    };
    media?.addEventListener?.('change', onChange);

    const onStorage = (event: StorageEvent) => {
      if (event.key !== THEME_STORAGE_KEY) return;
      publish(isThemeMode(event.newValue) ? event.newValue : 'system', { persist: false, notify: true });
    };
    window.addEventListener('storage', onStorage);

    return () => {
      media?.removeEventListener?.('change', onChange);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  return <>{children}</>;
}

/* -------------------------------------------------------------------------- */
/*                                 controls                                   */
/* -------------------------------------------------------------------------- */

/** Compact icon button: shows the theme you would switch to. */
export function ThemeToggle({ className, tone = 'default' }: { className?: string; tone?: 'default' | 'on-dark' }) {
  const { resolved, toggle } = useTheme();
  const next = resolved === 'dark' ? 'روشن' : 'تیره';
  return (
    <button
      type="button"
      onClick={toggle}
      className={clsx(
        'relative inline-flex size-9 items-center justify-center rounded-xl border transition',
        tone === 'default'
          ? 'border-line bg-surface text-navy-600 shadow-xs hover:border-line-strong hover:bg-surface-3 hover:text-navy-900'
          : 'border-white/15 bg-white/5 text-shell-fg hover:border-white/30 hover:bg-white/10 hover:text-white',
        className,
      )}
      aria-label={`تغییر به حالت ${next}`}
      title={`حالت ${next}`}
    >
      <Sun className={clsx('absolute size-4 transition-all duration-200', resolved === 'dark' ? 'rotate-90 scale-0 opacity-0' : 'rotate-0 scale-100 opacity-100')} />
      <Moon className={clsx('absolute size-4 transition-all duration-200', resolved === 'dark' ? 'rotate-0 scale-100 opacity-100' : '-rotate-90 scale-0 opacity-0')} />
    </button>
  );
}

/** Three-way control (light / dark / system) for settings and profile pages. */
export function ThemeSegmented({ className }: { className?: string }) {
  const { mode, setMode } = useTheme();
  const icons = { light: Sun, dark: Moon, system: Monitor };
  return (
    <div className={clsx('segmented', className)} role="group" aria-label="حالت نمایش">
      {THEME_OPTIONS.map((option) => {
        const Icon = icons[option.value];
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={mode === option.value}
            onClick={() => setMode(option.value)}
            title={option.hint}
            className="inline-flex items-center gap-1.5"
          >
            <Icon className="size-3.5" />
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
