import { one, q, run, nowIso, jsonStringify } from '../../db/index.js';
import { id, hashPassword } from '../../lib/crypto.js';
import { DEFAULT_ROLES, allPermissions } from '../../lib/permissions.js';
import { ensureSettingDefaults } from '../settings/service.js';
import { SEED_CATEGORIES, SEED_SERVICES, SEED_EXPENSE_CATEGORIES } from './seed-data.js';

export interface SeedOptions {
  withDemo?: boolean;
  admin?: { username: string; password: string; fullName?: string; mobile?: string };
  log?: (msg: string) => void;
}

async function upsertRoles(log: (m: string) => void) {
  const ts = nowIso();
  let created = 0;
  for (const role of DEFAULT_ROLES) {
    const existing = await one<{ id: string }>('SELECT id FROM roles WHERE code = ?', [role.code]);
    const permissions = jsonStringify(role.permissions === '*' ? '*' : allPermissions().filter((p) => (role.permissions as string[]).includes(p)));
    if (existing) {
      // keep administrator edits, only refresh name/description for system roles
      await run('UPDATE roles SET name = ?, description = ?, is_system = 1 WHERE id = ?', [role.name, role.description, existing.id]);
      continue;
    }
    await run(
      'INSERT INTO roles (id, code, name, description, is_system, permissions, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?, ?)',
      [id('role'), role.code, role.name, role.description, permissions, ts, ts],
    );
    created += 1;
  }
  if (created) log(`roles: ${created} created`);
}

async function buildSearchText(title: string, summary: string, description: string, tags: string[]) {
  return [title, summary, description, ...tags].join(' ').toLowerCase();
}

export async function seedCatalog(log: (m: string) => void = () => undefined) {
  const ts = nowIso();
  let categories = 0;
  let services = 0;
  const categoryIds = new Map<string, string>();

  for (const [index, cat] of SEED_CATEGORIES.entries()) {
    const existing = await one<{ id: string }>('SELECT id FROM service_categories WHERE slug = ?', [cat.slug]);
    if (existing) {
      // Existing categories belong to the administrator: never overwrite them.
      categoryIds.set(cat.slug, existing.id);
      continue;
    }
    const cid = id('cat');
    await run(
      `INSERT INTO service_categories (id, slug, title, description, icon, color, image, sort_order, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      [cid, cat.slug, cat.title, cat.description, cat.icon, cat.color, cat.image, index, ts, ts],
    );
    categoryIds.set(cat.slug, cid);
    categories += 1;
  }

  for (const [index, svc] of SEED_SERVICES.entries()) {
    const categoryId = categoryIds.get(svc.category) ?? null;
    const searchText = await buildSearchText(svc.title, svc.summary, svc.description, svc.tags);
    const existing = await one<{ id: string }>('SELECT id FROM services WHERE slug = ?', [svc.slug]);
    if (existing) {
      // Never overwrite admin edits; only refresh search index so new tags are findable.
      await run('UPDATE services SET search_text = ? WHERE id = ?', [searchText, existing.id]);
      continue;
    }
    await run(
      `INSERT INTO services (id, category_id, slug, title, summary, description, icon, form_schema, documents,
        workflow_steps, base_fee, discount_percent, estimated_days, payment_methods, tags, search_text,
        contact_notice, is_published, accepting_requests, is_custom, sort_order, needs_review, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, 1, 1, 0, ?, 1, ?, ?)`,
      [
        id('svc'), categoryId, svc.slug, svc.title, svc.summary, svc.description, svc.icon,
        jsonStringify(svc.form), jsonStringify(svc.documents), jsonStringify(svc.workflow),
        svc.baseFee, svc.estimatedDays, jsonStringify(svc.paymentMethods ?? ['online', 'cash', 'pos']),
        jsonStringify(svc.tags), searchText,
        svc.contactNotice ?? 'هزینه و زمان نمایش‌داده‌شده نمونه است و پس از بررسی مدارک تأیید می‌شود.',
        index, ts, ts,
      ],
    );
    services += 1;
  }

  const expenseCount = await one<{ c: number }>('SELECT COUNT(*) AS c FROM expense_categories');
  if (Number(expenseCount?.c ?? 0) === 0) {
    for (const [index, title] of SEED_EXPENSE_CATEGORIES.entries()) {
      await run('INSERT INTO expense_categories (id, title, sort_order, is_active, created_at) VALUES (?, ?, ?, 1, ?)', [id('exc'), title, index, ts]);
    }
  }

  for (const svc of SEED_SERVICES) {
    const row = await one<{ id: string }>('SELECT id FROM services WHERE slug = ?', [svc.slug]);
    if (!row) continue;
    const rule = await one<{ id: string }>('SELECT id FROM assignment_rules WHERE service_id = ?', [row.id]);
    if (!rule) {
      await run(
        `INSERT INTO assignment_rules (id, service_id, strategy, staff_ids, max_load, fallback, is_active, created_at, updated_at)
         VALUES (?, ?, 'least_loaded', '[]', 0, 'queue', 1, ?, ?)`,
        [id('rule'), row.id, ts, ts],
      );
    }
  }

  log(`catalogue: ${categories} categories, ${services} services created`);
  return { categories, services };
}

/** Creates the first super admin if no admin account exists. */
export async function ensureAdmin(admin: SeedOptions['admin'] = undefined, log: (m: string) => void = () => undefined) {
  if (!admin?.username || !admin?.password) return null;
  const existing = await one<{ id: string }>('SELECT id FROM users WHERE kind = ?', ['admin']);
  if (existing) return null;

  const role = await one<{ id: string }>('SELECT id FROM roles WHERE code = ?', ['super_admin']);
  if (!role) throw new Error('super_admin role is missing; run the role seed first');

  const ts = nowIso();
  const userId = id('usr');
  await run(
    `INSERT INTO users (id, kind, role_id, mobile, email, username, password_hash, full_name, status, must_change_password, created_at, updated_at)
     VALUES (?, 'admin', ?, ?, ?, ?, ?, ?, 'active', 0, ?, ?)`,
    [
      userId, role.id, admin.mobile ?? null, null, admin.username.toLowerCase(),
      await hashPassword(admin.password), admin.fullName ?? 'مدیر سامانه', ts, ts,
    ],
  );
  log(`admin: account "${admin.username}" created`);
  return userId;
}

/** Demo data for local evaluation and screenshots. Never enabled in production by default. */
export async function seedDemo(log: (m: string) => void = () => undefined) {
  const existing = await one<{ c: number }>('SELECT COUNT(*) AS c FROM requests');
  if (Number(existing?.c ?? 0) > 0) {
    log('demo: data already present, skipped');
    return;
  }
  const ts = nowIso();
  const adminRole = await one<{ id: string }>('SELECT id FROM roles WHERE code = ?', ['super_admin']);
  const staffRole = await one<{ id: string }>('SELECT id FROM roles WHERE code = ?', ['service_expert']);
  const opsRole = await one<{ id: string }>('SELECT id FROM roles WHERE code = ?', ['operator']);
  const accountantRole = await one<{ id: string }>('SELECT id FROM roles WHERE code = ?', ['accountant']);

  const demoUsers = [
    { key: 'staff1', kind: 'staff', role: staffRole?.id, name: 'سارا محمدی', mobile: '09120000001', username: 'sara', code: 'EMP-1001', specialty: 'insurance-health' },
    { key: 'staff2', kind: 'staff', role: staffRole?.id, name: 'رضا کریمی', mobile: '09120000002', username: 'reza', code: 'EMP-1002', specialty: 'companies-institutions' },
    { key: 'staff3', kind: 'staff', role: opsRole?.id, name: 'مریم احمدی', mobile: '09120000003', username: 'maryam', code: 'EMP-1003', specialty: 'subsidy-welfare' },
    { key: 'acc', kind: 'staff', role: accountantRole?.id, name: 'حسین نوری', mobile: '09120000004', username: 'hesam', code: 'EMP-1004', specialty: '' },
  ] as const;

  const staffIds: Record<string, string> = {};
  for (const user of demoUsers) {
    const uid = id('usr');
    await run(
      `INSERT INTO users (id, kind, role_id, mobile, username, password_hash, full_name, status, created_at, updated_at)
       VALUES (?, 'staff', ?, ?, ?, ?, ?, 'active', ?, ?)`,
      [uid, user.role ?? null, user.mobile, user.username, await hashPassword('Demo@12345'), user.name, ts, ts],
    );
    await run(
      `INSERT INTO staff_profiles (user_id, employee_code, position, specialties, max_active_cases, accepts_new_cases, created_at, updated_at)
       VALUES (?, ?, 'کارشناس خدمات', ?, 20, 1, ?, ?)`,
      [uid, user.code, jsonStringify(user.specialty ? [user.specialty] : []), ts, ts],
    );
    staffIds[user.key] = uid;
  }

  const customers = [
    { name: 'علی رضایی', mobile: '09121000001' },
    { name: 'زهرا کاظمی', mobile: '09121000002' },
    { name: 'محمد حسینی', mobile: '09121000003' },
  ];
  const customerIds: string[] = [];
  for (const c of customers) {
    const uid = id('usr');
    await run(
      `INSERT INTO users (id, kind, mobile, mobile_verified, full_name, status, created_at, updated_at)
       VALUES (?, 'customer', ?, 1, ?, 'active', ?, ?)`,
      [uid, c.mobile, c.name, ts, ts],
    );
    await run('INSERT INTO customer_profiles (user_id, city, extra, created_at, updated_at) VALUES (?, ?, ?, ?, ?)', [uid, 'تهران', '{}', ts, ts]);
    customerIds.push(uid);
  }

  const services = await q<{ id: string; title: string; base_fee: number; workflow_steps: string }>('SELECT id, title, base_fee, workflow_steps FROM services ORDER BY sort_order LIMIT 6');
  const statuses = ['new', 'in_progress', 'waiting_customer', 'in_progress', 'completed'];

  for (let i = 0; i < 12; i += 1) {
    const svc = services[i % services.length];
    if (!svc) break;
    const customer = customerIds[i % customerIds.length];
    const staffId = staffIds[['staff1', 'staff2', 'staff3'][i % 3] as keyof typeof staffIds];
    const status = statuses[i % statuses.length];
    const requestId = id('req');
    const total = Number(svc.base_fee);
    const paid = status === 'completed' ? total : 0;
    const createdAt = new Date(Date.now() - i * 36_00_000).toISOString();
    await run(
      `INSERT INTO requests (id, tracking_code, customer_id, service_id, assigned_to, status, priority, form_data, snapshot,
        fee, discount, total, payment_method, payment_status, current_step, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 'online', ?, 1, ?, ?)`,
      [
        requestId, `PK-${1400 + i}`, customer, svc.id, staffId, status, i % 4 === 0 ? 'high' : 'normal',
        jsonStringify({ full_name: customers[i % customers.length].name }), jsonStringify({ serviceTitle: svc.title }),
        total, total, paid > 0 ? 'paid' : 'unpaid', createdAt, createdAt,
      ],
    );
    await run(
      `INSERT INTO request_events (id, request_id, type, message, to_status, created_at) VALUES (?, ?, 'created', 'درخواست ثبت شد.', 'new', ?)`,
      [id('evt'), requestId, createdAt],
    );
    if (status !== 'new') {
      await run(
        `INSERT INTO request_events (id, request_id, type, message, from_status, to_status, created_at)
         VALUES (?, ?, 'status', 'وضعیت پرونده به‌روزرسانی شد.', 'new', ?, ?)`,
        [id('evt'), requestId, status, new Date(Date.now() - i * 1800_000).toISOString()],
      );
    }
  }

  // demo shifts for the current week
  const weekStart = new Date();
  weekStart.setHours(0, 0, 0, 0);
  for (const key of ['staff1', 'staff2', 'staff3']) {
    for (let d = 0; d < 5; d += 1) {
      const day = new Date(weekStart.getTime() + d * 86_400_000);
      const date = day.toISOString().slice(0, 10);
      await run(
        `INSERT INTO shifts (id, user_id, shift_date, start_time, end_time, status, created_at, updated_at)
         VALUES (?, ?, ?, '08:00', '16:00', 'scheduled', ?, ?)`,
        [id('shf'), staffIds[key], date, ts, ts],
      );
    }
  }

  log('demo: staff, customers, requests and shifts created');
}

export async function runSeed(options: SeedOptions = {}) {
  const log = options.log ?? (() => undefined);
  await ensureSettingDefaults();
  await upsertRoles(log);
  await seedCatalog(log);
  const adminId = await ensureAdmin(options.admin, log);
  if (options.withDemo) await seedDemo(log);
  return { adminId };
}

export { upsertRolesOnly, adminRoleId };
async function upsertRolesOnly() { await upsertRoles(() => undefined); }
async function adminRoleId(): Promise<string | null> {
  const row = await one<{ id: string }>('SELECT id FROM roles WHERE code = ?', ['super_admin']);
  return row?.id ?? null;
}
