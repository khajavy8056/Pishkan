/**
 * The palette of ready-made form fields.
 *
 * ## What it is for
 *
 * Defining a service's form meant typing «کد ملی», `national_id`, type, required,
 * placeholder — for the fortieth time. Slower than it needs to be, and worse,
 * every retyping is a chance to drift: one service gets `national_id`, the next
 * `melli_code`, and the autofill/profile/archive logic that addresses fields by
 * key quietly stops matching half the catalogue. A palette solves both halves:
 * click, and the field arrives with the standard that already exists.
 *
 * ## Where the entries come from — three sources, one merge
 *
 *  1. **`standardFormFields`** (the factory in `seed-data.ts`) — the shapes the
 *     seeded catalogue itself is built from. They are *imported*, not copied, so
 *     a palette entry and a seeded service cannot disagree, which is the whole
 *     promise of "با همون استاندارد قبلی ساخته بشه".
 *  2. **The live scan of `services.form_schema`** — every field any service
 *     actually defines, with a usage count. This is why a field the office
 *     invents today is in the palette tomorrow without anybody maintaining a
 *     list: the catalogue *is* the list. It is computed in JavaScript rather
 *     than with `json_each`/`jsonb_array_elements` on purpose — those two are
 *     each the only syntax their engine has, and this file has to answer the
 *     same way on the office laptop's SQLite and on the server's PostgreSQL.
 *  3. **`form_field_presets`** — an explicit save. Needed for the two cases the
 *     scan cannot cover: a field drafted but not yet used by any service, and a
 *     corrected standard that must survive the archiving of the service it came
 *     from.
 *
 * One key, one entry: a saved preset wins over the built-in, which wins over the
 * scanned one, so a deliberate correction is never shadowed by drift elsewhere in
 * the catalogue.
 *
 * ## What it deliberately does not do
 *
 * It never replaces the free-form editor. Everything in here is an *insert into
 * that editor* — a field with a key nobody has thought about before is still
 * definable, which is how the catalogue grew past any fixed list in the first
 * place.
 */
import { z } from 'zod';
import { jsonStringify, nowIso, jsonParse, q, run } from '../../db/index.js';
import { id } from '../../lib/crypto.js';
import { normalizePersian } from '../../lib/text.js';
import { badRequest } from '../../http/errors.js';
import { f as standardFormFields, type FormField } from './seed-data.js';

/**
 * The one definition of what a form field *is*.
 *
 * `routes/catalog.ts` validates a service's `form` array with this, and saving a
 * preset runs through it too — a palette entry that the service schema would
 * reject is a trap, not a shortcut.
 */
export const formFieldSchema = z.object({
  key: z.string().min(2).max(41),
  label: z.string().min(2).max(120),
  type: z.enum([
    'text', 'tel', 'number', 'national_id', 'date', 'textarea', 'select', 'radio',
    'checkbox', 'file', 'money', 'iban', 'postal_code',
  ]),
  required: z.boolean().optional(),
  options: z.array(z.string()).optional(),
  placeholder: z.string().max(120).optional(),
  help: z.string().max(300).optional(),
  maxLength: z.number().int().min(1).max(500).optional(),
});

export const FIELD_TYPE_LABELS: Record<FormField['type'], string> = {
  text: 'متن',
  tel: 'شماره تماس',
  number: 'عدد',
  national_id: 'کد ملی',
  date: 'تاریخ',
  textarea: 'متن طولانی',
  select: 'انتخاب از فهرست',
  radio: 'تک‌انتخاب',
  checkbox: 'تیک تأیید',
  file: 'فایل / تصویر',
  money: 'مبلغ (ریال)',
  iban: 'شماره شبا',
  postal_code: 'کد پستی',
};

export type PresetSource = 'builtin' | 'service' | 'manual';

export interface FieldPreset {
  key: string;
  label: string;
  type: FormField['type'];
  /** The field exactly as it will be inserted into the service's form. */
  field: FormField;
  source: PresetSource;
  /** How many services already define this key — the trust signal. */
  usage: number;
  /** Up to three of those service titles, for the palette's hint line. */
  usedIn: string[];
  typeLabel: string;
}

/**
 * Keys the editor invents for itself are not standards.
 *
 * `addField` in the panel starts a row as `field_3`; registering those would fill
 * the palette with empty rows that look like intentional fields, and a person
 * clicking one would get a blank field with a meaningless key. `untitled_1` is
 * excluded on the same reasoning (it is what `custom-services` names an
 * unspecified field before the office writes the label).
 */
const PLACEHOLDER_KEY = /^(field|untitled|new|test)_?\d*$/i;

function usableField(field: unknown): field is FormField {
  const parsed = formFieldSchema.safeParse(field);
  if (!parsed.success) return false;
  return !PLACEHOLDER_KEY.test(parsed.data.key);
}

/** Everything the catalogue already defines, grouped by key with its usage. */
async function scanCatalogue(): Promise<Map<string, { field: FormField; usage: number; usedIn: string[] }>> {
  const rows = await q<{ title: string; form_schema: string | null }>(
    `SELECT title, form_schema FROM services WHERE form_schema IS NOT NULL AND form_schema <> '[]'`,
  );
  const found = new Map<string, { field: FormField; usage: number; usedIn: string[] }>();
  for (const row of rows) {
    const fields = jsonParse<unknown[]>(row.form_schema, []);
    const seenHere = new Set<string>();
    for (const candidate of Array.isArray(fields) ? fields : []) {
      if (!usableField(candidate)) continue;
      const existing = found.get(candidate.key);
      if (!existing) {
        found.set(candidate.key, { field: candidate, usage: 1, usedIn: [row.title] });
      } else {
        // One service defining a key twice says nothing about adoption, so the
        // count is per service — otherwise a duplicated row inflates trust.
        if (!seenHere.has(candidate.key)) {
          existing.usage += 1;
          if (existing.usedIn.length < 3) existing.usedIn.push(row.title);
        }
      }
      seenHere.add(candidate.key);
    }
  }
  return found;
}

/** Explicitly saved presets, newest standard for each key. */
async function savedPresets(): Promise<Map<string, { field: FormField; source: PresetSource; useCount: number }>> {
  const out = new Map<string, { field: FormField; source: PresetSource; useCount: number }>();
  let rows: { key: string; definition: string; source: string; use_count: number }[] = [];
  try {
    rows = await q<{ key: string; definition: string; source: string; use_count: number }>(
      'SELECT key, definition, source, use_count FROM form_field_presets',
    );
  } catch {
    // The table is created by 044. Reading it before migrations have run happens
    // on a server mid-upgrade, and a palette that falls back to the catalogue is
    // a worse-but-working answer; an exception here would take the whole service
    // editor down, which is what stops an office from finishing the update.
    rows = [];
  }
  for (const row of rows) {
    const field = jsonParse<unknown>(row.definition, null);
    if (!usableField(field)) continue;
    out.set(row.key, {
      field,
      source: row.source === 'builtin' ? 'builtin' : (row.source === 'service' ? 'service' : 'manual'),
      useCount: Number(row.use_count ?? 0),
    });
  }
  return out;
}

/**
 * The palette, merged and searched.
 *
 * `query` matches the Persian label, the English key and the type name, after
 * `normalizePersian` on both sides — so `ملی`, `ملي` (Arabic lam-alef, which is
 * what a pasted label from another system carries) and `national_id` all find
 * «کد ملی». Words are AND-ed, because «تاریخ تولد» should not surface
 * «تاریخ عقد» just because both contain تاریخ.
 */
export async function listPresets(options: { query?: string; limit?: number } = {}): Promise<FieldPreset[]> {
  const [catalogue, saved] = await Promise.all([scanCatalogue(), savedPresets()]);
  const merged = new Map<string, FieldPreset>();

  const put = (key: string, field: FormField, source: PresetSource, usage: number, usedIn: string[]) => {
    merged.set(key, {
      key,
      label: field.label,
      type: field.type,
      field,
      source,
      usage,
      usedIn,
      typeLabel: FIELD_TYPE_LABELS[field.type] ?? field.type,
    });
  };

  // Lowest priority first; each later source overwrites the same key but keeps
  // the evidence of how widely the key is used, which is about the key, not the
  // source it was read from.
  for (const [key, hit] of catalogue) put(key, hit.field, 'service', hit.usage, hit.usedIn);
  for (const [key, field] of Object.entries(standardFormFields)) {
    if (!usableField(field)) continue;
    const prior = merged.get(key);
    put(key, field, 'builtin', prior?.usage ?? 0, prior?.usedIn ?? []);
  }
  for (const [key, hit] of saved) {
    const prior = merged.get(key);
    put(key, hit.field, hit.source, Math.max(prior?.usage ?? 0, hit.useCount), prior?.usedIn ?? []);
  }

  const words = normalizePersian(options.query ?? '').split(' ').filter(Boolean);
  let items = [...merged.values()];
  if (words.length) {
    items = items.filter((preset) => {
      const haystack = normalizePersian(
        `${preset.label} ${preset.key} ${preset.typeLabel} ${preset.field.help ?? ''} ${preset.field.placeholder ?? ''}`,
      );
      return words.every((word) => haystack.includes(word));
    });
  }
  // Most-used first: the field every service needs should be the first thing the
  // office sees, and an unused saved preset should still beat an empty hit.
  items.sort((a, b) => (b.usage - a.usage) || a.label.localeCompare(b.label, 'fa'));
  const limit = Math.min(200, Math.max(1, options.limit ?? 80));
  return items.slice(0, limit);
}

/**
 * Remember the fields a service was saved with.
 *
 * Called from `createService`/`updateService`, which is what makes the promise
 * «هر فیلدی که اینجوری ایجاد بشه دیگه توی لیست فیلدهای آماده هم بیاد» true for
 * the *next* service as well as this one — and true without a second save step
 * anybody has to remember.
 */
export async function registerFieldsFromService(
  fields: unknown,
  actor: { id?: string } = {},
): Promise<void> {
  if (!Array.isArray(fields)) return;
  const now = nowIso();
  for (const candidate of fields) {
    if (!usableField(candidate)) continue;
    await run(
      `INSERT INTO form_field_presets (id, key, label, type, definition, source, use_count, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'service', 1, ?, ?, ?)
       ON CONFLICT (key) DO UPDATE SET
         label = form_field_presets.label,
         type = form_field_presets.type,
         definition = form_field_presets.definition,
         use_count = form_field_presets.use_count + 1,
         updated_at = excluded.updated_at`,
      [id('ffp'), candidate.key, candidate.label, candidate.type, jsonStringify(candidate), actor.id ?? null, now, now],
    );
  }
}

/**
 * Save (or correct) a preset on purpose.
 *
 * `source` becomes `manual`, which is also the *rank*: a deliberate standard wins
 * over a scanned one for the same key. The label/type columns are denormalised
 * next to the JSON so the list can be ordered and searched by the database later
 * without reading every definition.
 */
export async function savePreset(rawField: unknown, actor: { id?: string } = {}): Promise<FieldPreset> {
  const parsed = formFieldSchema.safeParse(rawField);
  if (!parsed.success) {
    throw badRequest('این فیلد برای ذخیره به‌عنوان فیلد آماده آماده نیست؛ برچسب و کلید را کامل کنید.');
  }
  const field = parsed.data as FormField;
  if (PLACEHOLDER_KEY.test(field.key)) {
    throw badRequest('کلید فیلد باید معنادار باشد (مثلاً birth_date) تا بشود آن را دوباره استفاده کرد.');
  }
  const now = nowIso();
  await run(
    `INSERT INTO form_field_presets (id, key, label, type, definition, source, use_count, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'manual', 0, ?, ?, ?)
     ON CONFLICT (key) DO UPDATE SET
       label = excluded.label,
       type = excluded.type,
       definition = excluded.definition,
       source = 'manual',
       created_by = COALESCE(excluded.created_by, form_field_presets.created_by),
       updated_at = excluded.updated_at`,
    [id('ffp'), field.key, field.label, field.type, jsonStringify(field), actor.id ?? null, now, now],
  );
  return {
    key: field.key,
    label: field.label,
    type: field.type,
    field,
    source: 'manual',
    usage: 0,
    usedIn: [],
    typeLabel: FIELD_TYPE_LABELS[field.type] ?? field.type,
  };
}

/** Drop a saved preset. The catalogue's own fields stay (they are the scan's). */
export async function deletePreset(presetKey: string): Promise<void> {
  const removed = await run('DELETE FROM form_field_presets WHERE key = ? AND source = ?', [presetKey, 'manual']);
  if (!Number(removed?.changes ?? 0)) throw badRequest('فیلد آماده‌ای با این کلید ذخیره نشده بود؛ فیلدهایی که در خدمات هستند با حذف خدمت از فهرست می‌روند.');
}
