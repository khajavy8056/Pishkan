/**
 * Safe reader/writer for the local environment file (`.env.windows.local`).
 *
 * Why this exists: the API reads its configuration with dotenv, and dotenv
 * truncates unquoted values at the first `#` and strips trailing whitespace.
 * A generated password or a Windows path with a space would therefore silently
 * change the configuration. This module quotes every value, refuses the few
 * characters dotenv cannot round-trip, writes the file atomically and keeps a
 * timestamped copy before every change so a failed install can be rolled back.
 *
 * The file shape is intentionally the same one `scripts/install-windows.ps1`
 * produces, so both installers can be used interchangeably.
 */
import fs from 'node:fs';
import path from 'node:path';

const KEY_PATTERN = /^[A-Z0-9_]+$/;

/** dotenv double-quoted values are unescaped only for \n and \r, so anything
 *  else would be corrupted. We reject those characters instead of guessing. */
const UNSAFE_VALUE = /[\r\n"']/;

export function readEnvFile(file) {
  const result = {};
  let text;
  try {
    text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  } catch {
    return result;
  }
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const index = line.indexOf('=');
    if (index <= 0) continue;
    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    } else {
      // Mirror dotenv: an unquoted value ends at the first `#`.
      const hash = value.indexOf('#');
      if (hash >= 0) value = value.slice(0, hash).trimEnd();
    }
    result[key] = value;
  }
  return result;
}

export function formatEnvValue(value) {
  const text = String(value ?? '');
  if (UNSAFE_VALUE.test(text)) {
    throw new Error(`مقدار تنظیمات شامل کاراکتر غیرمجاز (گیومه یا خط جدید) است: ${text.slice(0, 20)}`);
  }
  return `"${text}"`;
}

export function renderEnvFile(values, header = []) {
  const lines = [...header];
  for (const [key, value] of Object.entries(values)) {
    if (!KEY_PATTERN.test(key)) throw new Error(`کلید تنظیمات نامعتبر است: ${key}`);
    lines.push(`${key}=${formatEnvValue(value)}`);
  }
  return `${lines.join('\n')}\n`;
}

/**
 * Merge `values` into an existing env file.
 * - existing keys are updated in place (order and comments preserved),
 * - new keys are appended,
 * - the previous file is copied to `<file>.bak-<timestamp>` first,
 * - the write is atomic.
 */
export function upsertEnvFile(file, values, options = {}) {
  const { backup = true, header = [] } = options;
  const exists = fs.existsSync(file);
  const before = exists ? fs.readFileSync(file, 'utf8') : null;
  if (exists && backup) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    fs.copyFileSync(file, `${file}.bak-${stamp}`);
  }

  const pending = new Map(Object.entries(values));
  for (const [key, value] of pending) {
    if (!KEY_PATTERN.test(key)) throw new Error(`کلید تنظیمات نامعتبر است: ${key}`);
    formatEnvValue(value); // validate before touching the disk
  }

  const out = [];
  const seen = new Set();
  if (before !== null) {
    for (const rawLine of before.replace(/^\uFEFF/, '').split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#') || !line.includes('=')) {
        out.push(rawLine);
        continue;
      }
      const key = line.slice(0, line.indexOf('=')).trim();
      if (pending.has(key)) {
        out.push(`${key}=${formatEnvValue(pending.get(key))}`);
        pending.delete(key);
        seen.add(key);
      } else {
        out.push(rawLine);
      }
    }
  } else {
    out.push(...header);
  }
  for (const [key, value] of pending) out.push(`${key}=${formatEnvValue(value)}`);

  const text = `${out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text, 'utf8');
  fs.renameSync(tmp, file);
  return { file, created: !exists, text };
}

/**
 * Build the environment for a child process from the *current* contents of the
 * env file.
 *
 * Why this is a named function and not two spreads inline: the API loads its
 * config with dotenv **without** `override`, so anything already present in the
 * child's environment wins over the file. A long-lived process that caches the
 * file at startup and then passes that cache to `spawn` therefore relaunches
 * the server with the old values — the edit appears to do nothing. That is
 * exactly the failure mode of "enable the public tunnel, restart, log in":
 * the tunnel origin never reaches CORS_ORIGINS and every POST is answered 403.
 *
 * Reading at call time makes "change the file, then start" always mean what it
 * says. Precedence, lowest to highest: inherited environment, file, explicit
 * overrides.
 */
export function buildChildEnv(file, overrides = {}, baseEnv = process.env, read = readEnvFile) {
  return { ...baseEnv, ...read(file), ...overrides };
}

/** Restore the most recent backup created by upsertEnvFile. */
export function restoreEnvFile(file) {
  const dir = path.dirname(file);
  const base = path.basename(file);
  const backups = fs.existsSync(dir)
    ? fs.readdirSync(dir).filter((name) => name.startsWith(`${base}.bak-`)).sort()
    : [];
  if (!backups.length) return false;
  fs.copyFileSync(path.join(dir, backups[backups.length - 1]), file);
  return true;
}
