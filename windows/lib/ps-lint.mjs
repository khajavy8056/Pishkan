#!/usr/bin/env node
/**
 * Static checks for the PowerShell files of the Windows launcher.
 *
 * Why this exists (real production bug, 2026-10-30):
 *   Windows PowerShell 5.1 decodes a `.ps1` file with the **system ANSI code
 *   page** unless the file starts with a UTF-8 BOM. Our scripts are UTF-8 with
 *   Persian text; without the BOM the em dash (—) turned into `â€”`, and the
 *   third byte of that sequence is `”` — which PowerShell treats as a string
 *   delimiter. Every Persian string in the installer therefore "ended" early and
 *   the whole script failed to parse ("Unexpected token ')'").
 *
 * The fix is a UTF-8 BOM on every script plus this regression check, which runs
 * on Linux in `npm run test:windows` and in CI:
 *   1. every `.ps1` must start with EF BB BF,
 *   2. the file must be valid UTF-8 without replacement characters,
 *   3. decoding it as cp1252 (what PS 5.1 does *without* the BOM) must not
 *      produce typographic quotes — proof that a lost BOM would break parsing,
 *   4. `.cmd` launchers must be pure ASCII (cmd.exe reads them in the OEM
 *      code page, so non-ASCII text there is never safe).
 *
 * This is a static check, not a PowerShell parser: it cannot prove the scripts
 * are semantically correct, and it is documented as such.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { MODULE_DIR } from './common.mjs';

const require = createRequire(import.meta.url);

const WINDOWS_DIR = path.resolve(MODULE_DIR, '..');
const BOM = Buffer.from([0xef, 0xbb, 0xbf]);
const SMART_QUOTES = /[\u2018\u2019\u201c\u201d]/;

export function collectFiles(dir = WINDOWS_DIR, extensions = ['.ps1', '.cmd']) {
  const found = [];
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'assets') continue;
        walk(full);
      } else if (extensions.includes(path.extname(entry.name).toLowerCase())) {
        found.push(full);
      }
    }
  };
  walk(dir);
  return found.sort();
}

/** Brace/paren/bracket balance, ignoring strings and comments. */
export function checkBalance(text) {
  const problems = [];
  let brace = 0;
  let paren = 0;
  let bracket = 0;
  let line = 1;
  let quote = null;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === '\n') line += 1;
    if (quote) {
      if (char === quote) {
        if (quote === "'" && text[i + 1] === "'") { i += 1; continue; }
        quote = null;
      } else if (char === '`' && quote === '"') {
        i += 1;
      }
      continue;
    }
    if (char === '#' && (i === 0 || text[i - 1] !== '`')) {
      while (i < text.length && text[i] !== '\n') i += 1;
      line += 1;
      continue;
    }
    if (char === "'" || char === '"') { quote = char; continue; }
    if (char === '{') brace += 1;
    if (char === '}') brace -= 1;
    if (char === '(') paren += 1;
    if (char === ')') paren -= 1;
    if (char === '[') bracket += 1;
    if (char === ']') bracket -= 1;
    if (brace < 0) problems.push(`خط ${line}: آکولاد بسته اضافی`);
    if (paren < 0) problems.push(`خط ${line}: پرانتز بسته اضافی`);
    if (bracket < 0) problems.push(`خط ${line}: براکت بسته اضافی`);
  }
  if (quote) problems.push(`گیومه ${quote} بسته نشده است`);
  if (brace !== 0) problems.push(`عدم توازن آکولاد: ${brace}`);
  if (paren !== 0) problems.push(`عدم توازن پرانتز: ${paren}`);
  if (bracket !== 0) problems.push(`عدم توازن براکت: ${bracket}`);
  return problems;
}

/**
 * Properties that do not exist on every Windows machine.
 *
 * `ProcessStartInfo.StandardInputEncoding` needs .NET Framework 4.7.2+ (and .NET
 * Core 2.1+). A real user on Windows 10 with an older framework got
 *
 *   The property 'StandardInputEncoding' cannot be found on this object.
 *
 * the moment the installer window opened a child process. Assigning such a
 * property is only safe behind an existence check, so the linter demands one on
 * the same statement block. A syntax parser cannot see this; only the runtime
 * does — and the runtime is a customer machine.
 */
const GUARDED_PROPERTIES = ['StandardInputEncoding', 'StandardOutputEncoding', 'StandardErrorEncoding'];

function checkDotNetProperties(text) {
  const problems = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((line, index) => {
    for (const property of GUARDED_PROPERTIES) {
      const assignment = new RegExp(`\\.${property}\\s*=`);
      if (!assignment.test(line)) continue;
      // Look back a few lines for the guard that makes the assignment safe.
      const window = lines.slice(Math.max(0, index - 6), index + 1).join('\n');
      if (window.includes(`Properties.Match('${property}')`) || window.includes(`Properties.Match("${property}")`)) continue;
      problems.push(
        `${property} بدون بررسی وجود روی .NET قدیمی خطا می‌دهد ` +
        `(«The property '${property}' cannot be found on this object») — خط ${index + 1}`,
      );
    }
  });
  return problems;
}

/**
 * `ConvertTo-Json` without `-Compress` pretty-prints across many lines in
 * Windows PowerShell 5.1. The installer sends its job to Node through stdin, and
 * a multi-line payload once reached the other side as a single "{" — the install
 * died with «ورودی تنظیمات نصب‌کننده معتبر نیست (JSON)» on a real machine.
 * Anything that crosses a process boundary must be one line.
 */
function checkJsonSerialisation(text) {
  const problems = [];
  text.split(/\r?\n/).forEach((line, index) => {
    if (!/ConvertTo-Json/.test(line)) return;
    if (line.includes('-Compress')) return;
    problems.push(
      `ConvertTo-Json بدون -Compress (خروجی چندخطی می‌شود و در stdin/فایل یک‌خطی خراب می‌شود) — خط ${index + 1}`,
    );
  });
  return problems;
}

export function lintFile(file) {
  const buffer = fs.readFileSync(file);
  const relative = path.relative(WINDOWS_DIR, file).replace(/\\/g, '/');
  const problems = [];
  const extension = path.extname(file).toLowerCase();

  if (extension === '.cmd') {
    const nonAscii = buffer.toString('latin1').match(/[\x80-\xff]/g);
    if (nonAscii) problems.push(`فایل .cmd باید فقط ASCII باشد (${nonAscii.length} بایت غیر ASCII)`);
    // cmd.exe resolves `goto` labels reliably only with CRLF line endings.
    const text = buffer.toString('latin1');
    const bareLf = (text.match(/(?<!\r)\n/g) ?? []).length;
    if (bareLf > 0) problems.push(`پایان خط CRLF نیست (${bareLf} خط با LF تنها)`);
    return { file: relative, ok: problems.length === 0, problems };
  }

  const hasBom = buffer.subarray(0, 3).equals(BOM);
  if (!hasBom) {
    problems.push('UTF-8 BOM ندارد (PowerShell 5.1 متن فارسی را خراب می‌خواند و اسکریپت پارس نمی‌شود)');
    // Explain the consequence: this is what PS 5.1 would actually read.
    const ansi = buffer.toString('latin1');
    if (SMART_QUOTES.test(ansi)) {
      problems.push('بدون BOM، رمزگشایی ANSI گیومهٔ تایپوگرافی (” “ ’ ‘) می‌سازد که PowerShell آن را پایان رشته می‌داند');
    }
  }
  const text = buffer.toString('utf8').replace(/^\uFEFF/, '');
  if (text.includes('\uFFFD')) problems.push('بایت‌های UTF-8 نامعتبر (کاراکتر جایگزین) پیدا شد');

  problems.push(...checkBalance(text));
  problems.push(...checkDotNetProperties(text));
  problems.push(...checkJsonSerialisation(text));
  return { file: relative, ok: problems.length === 0, problems };
}

/**
 * Rewrite the files so they satisfy the rules (`--fix`).
 *
 * Encoding rules get broken by tools, not by people: an editor saves a .cmd with
 * LF, a zip round-trip drops the BOM. Fixing them by hand is error-prone, and a
 * broken launcher is invisible until someone double-clicks it on Windows.
 */
export function fixFile(file) {
  const buffer = fs.readFileSync(file);
  const extension = path.extname(file).toLowerCase();
  const changes = [];
  if (extension === '.cmd') {
    const text = buffer.toString('latin1');
    const normalized = text.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n');
    if (normalized !== text) {
      fs.writeFileSync(file, Buffer.from(normalized, 'latin1'));
      changes.push('پایان خط به CRLF تغییر کرد');
    }
    return changes;
  }
  if (extension === '.ps1') {
    let body = buffer;
    if (!body.subarray(0, 3).equals(BOM)) {
      body = Buffer.concat([BOM, body]);
      changes.push('UTF-8 BOM اضافه شد');
    }
    const text = body.toString('utf8').replace(/\r\n/g, '\n').replace(/\n/g, '\r\n');
    const normalized = Buffer.concat([BOM, Buffer.from(text.slice(1), 'utf8')]);
    if (!Buffer.from(text.slice(1), 'utf8').equals(body.subarray(3))) {
      fs.writeFileSync(file, normalized);
      changes.push('پایان خط به CRLF تغییر کرد');
    } else if (changes.length) {
      fs.writeFileSync(file, body);
    }
    return changes;
  }
  return changes;
}

export function fixAll() {
  return collectFiles().map((file) => ({
    file: path.relative(WINDOWS_DIR, file).replace(/\\/g, '/'),
    changes: fixFile(file),
  }));
}

export function lintAll() {
  return collectFiles().map(lintFile);
}

/**
 * Real syntax check with the tree-sitter PowerShell grammar.
 *
 * The encoding check above cannot tell whether a script is syntactically valid,
 * and there is no PowerShell interpreter on the CI machine, so the grammar is
 * used as a parser. It is a dev dependency that ships as WebAssembly (no native
 * build); when it is not installed the check is reported as *skipped* instead of
 * silently passing.
 */
export async function parseAll(files = collectFiles(WINDOWS_DIR, ['.ps1'])) {
  let Parser;
  let Language;
  try {
    ({ Parser, Language } = await import('web-tree-sitter'));
  } catch {
    return { available: false, reason: 'بستهٔ web-tree-sitter نصب نشده است', results: [] };
  }
  let wasmPath;
  try {
    const packageJson = require.resolve('tree-sitter-powershell/package.json');
    wasmPath = path.join(path.dirname(packageJson), 'tree-sitter-powershell.wasm');
    if (!fs.existsSync(wasmPath)) throw new Error('wasm not found');
  } catch {
    return { available: false, reason: 'گرامر tree-sitter-powershell نصب نشده است', results: [] };
  }

  await Parser.init();
  const language = await Language.load(wasmPath);
  const parser = new Parser();
  parser.setLanguage(language);

  const results = [];
  for (const file of files) {
    const source = file.endsWith('.ps1')
      ? fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')
      : fs.readFileSync(file, 'utf8');
    const tree = parser.parse(source);
    const problems = [];
    const walk = (node) => {
      if (node.type === 'ERROR' || node.isMissing) {
        const line = node.startPosition.row + 1;
        const snippet = source.slice(node.startIndex, node.endIndex).split('\n')[0].slice(0, 60);
        problems.push(`خط ${line}: ${node.type === 'ERROR' ? 'ساختار نامعتبر' : 'توکن گم‌شده'} «${snippet}»`);
      }
      for (const child of node.children) walk(child);
    };
    walk(tree.rootNode);
    results.push({ file: path.relative(WINDOWS_DIR, file).replace(/\\/g, '/'), ok: problems.length === 0, problems });
  }
  parser.delete();
  return { available: true, results };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  if (process.argv.includes('--fix')) {
    const fixed = fixAll().filter((entry) => entry.changes.length);
    for (const entry of fixed) process.stdout.write(`✎ ${entry.file}: ${entry.changes.join('، ')}\n`);
    process.stdout.write(fixed.length ? `\n${fixed.length} فایل اصلاح شد.\n\n` : '\nهمهٔ فایل‌ها از قبل درست بودند.\n\n');
  }
  const results = lintAll();
  let failed = 0;
  for (const result of results) {
    if (result.ok) {
      process.stdout.write(`✓ ${result.file}\n`);
    } else {
      failed += 1;
      process.stdout.write(`✗ ${result.file}\n`);
      for (const problem of result.problems) process.stdout.write(`    - ${problem}\n`);
    }
  }
  const parsed = await parseAll();
  if (!parsed.available) {
    process.stdout.write(`\nپارس PowerShell انجام نشد: ${parsed.reason}\n`);
  } else {
    for (const result of parsed.results) {
      if (result.ok) {
        process.stdout.write(`✓ پارس ${result.file}\n`);
      } else {
        failed += 1;
        process.stdout.write(`✗ پارس ${result.file}\n`);
        for (const problem of result.problems) process.stdout.write(`    - ${problem}\n`);
      }
    }
  }
  process.stdout.write(`\n${results.length - failed}/${results.length} فایل ویندوز سالم است.\n`);
  process.exit(failed ? 1 : 0);
}
