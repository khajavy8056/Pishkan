/**
 * Permission catalogue.
 *
 * Permissions are `<resource>.<action>` strings. Role documents keep them as a
 * JSON array in `roles.permissions` so admins can compose custom roles without
 * a code change. Server-side checks are mandatory for every protected route.
 */

export const RESOURCES = [
  'dashboard',
  'requests',
  'customers',
  'services',
  'categories',
  'staff',
  'shifts',
  'attendance',
  'invoices',
  'payments',
  'expenses',
  'reports',
  'messages',
  'documents',
  'payroll',
  'settings',
  'roles',
  'audit',
  'backup',
  'system',
] as const;

export const ACTIONS = ['view', 'create', 'edit', 'approve', 'cancel', 'delete', 'export'] as const;

export type Resource = (typeof RESOURCES)[number];
export type Action = (typeof ACTIONS)[number];
export const PAYROLL_PERMISSIONS = [
  'payroll.view',
  'payroll.contracts.edit',
  'payroll.accrue',
  'payroll.settle',
  'payroll.reports.view',
] as const;

export type Permission = `${Resource}.${Action}` | (typeof PAYROLL_PERMISSIONS)[number];

export function allPermissions(): Permission[] {
  return [...RESOURCES.flatMap((r) => ACTIONS.map((a) => `${r}.${a}` as Permission)), ...PAYROLL_PERMISSIONS];
}

export const PERMISSION_LABELS: Record<Action, string> = {
  view: 'مشاهده',
  create: 'ایجاد',
  edit: 'ویرایش',
  approve: 'تأیید',
  cancel: 'لغو',
  delete: 'حذف',
  export: 'خروجی گرفتن',
};

export const RESOURCE_LABELS: Record<Resource, string> = {
  dashboard: 'داشبورد',
  requests: 'درخواست‌ها',
  customers: 'مشتریان',
  services: 'خدمات',
  categories: 'دسته‌بندی‌ها',
  staff: 'کارکنان',
  shifts: 'شیفت‌ها',
  attendance: 'حضور و غیاب',
  invoices: 'فاکتورها',
  payments: 'پرداخت‌ها',
  expenses: 'هزینه‌ها',
  reports: 'گزارش‌ها',
  messages: 'پیام‌ها',
  documents: 'مدارک',
  payroll: 'حقوق و تسویه کارکنان',
  settings: 'تنظیمات',
  roles: 'نقش‌ها و مجوزها',
  audit: 'تاریخچه عملیات',
  backup: 'پشتیبان‌گیری',
  system: 'زیرساخت',
};

/** Default roles shipped with the system. Admins can edit them afterwards. */
export const DEFAULT_ROLES: {
  code: string;
  name: string;
  description: string;
  system: boolean;
  permissions: Permission[] | '*';
}[] = [
  {
    code: 'super_admin',
    name: 'مدیر کل',
    description: 'دسترسی کامل به تمام بخش‌های سامانه',
    system: true,
    permissions: '*',
  },
  {
    code: 'manager',
    name: 'مدیر داخلی / سرپرست',
    description: 'مدیریت عملیات، کارکنان و گزارش‌ها بدون تغییر تنظیمات حساس',
    system: true,
    permissions: [
      'dashboard.view',
      'requests.view', 'requests.create', 'requests.edit', 'requests.approve', 'requests.cancel', 'requests.export',
      'customers.view', 'customers.edit', 'customers.export',
      'services.view', 'services.create', 'services.edit',
      'categories.view',
      'staff.view', 'staff.create', 'staff.edit',
      'shifts.view', 'shifts.create', 'shifts.edit', 'shifts.approve',
      'attendance.view', 'attendance.edit',
      'invoices.view', 'invoices.create', 'invoices.edit', 'invoices.approve',
      'payments.view', 'payments.create', 'payments.approve',
      'expenses.view', 'expenses.create',
      'reports.view', 'reports.export',
      'messages.view', 'messages.create',
      'documents.view', 'documents.approve',
      'audit.view',
    ],
  },
  {
    code: 'service_expert',
    name: 'کارشناس خدمات',
    description: 'پاسخ‌گویی به درخواست‌ها، بررسی مدارک و صدور خدمت اختصاصی',
    system: true,
    permissions: [
      'dashboard.view',
      'requests.view', 'requests.create', 'requests.edit', 'requests.approve',
      'customers.view', 'customers.create', 'customers.edit',
      'services.view', 'services.create',
      'categories.view',
      'invoices.view', 'invoices.create',
      'payments.view',
      'messages.view', 'messages.create',
      'documents.view', 'documents.approve',
    ],
  },
  {
    code: 'operator',
    name: 'کارمند اجرایی',
    description: 'پیگیری پرونده‌های ارجاع‌شده و به‌روزرسانی وضعیت',
    system: true,
    permissions: [
      'dashboard.view',
      'requests.view', 'requests.edit',
      'customers.view',
      'services.view',
      'messages.view', 'messages.create',
      'documents.view',
      'shifts.view',
    ],
  },
  {
    code: 'document_reviewer',
    name: 'مسئول بررسی مدارک',
    description: 'بررسی، تأیید یا رد مدارک ارسالی مشتریان',
    system: true,
    permissions: [
      'dashboard.view',
      'requests.view',
      'documents.view', 'documents.approve',
      'messages.view', 'messages.create',
    ],
  },
  {
    code: 'accountant',
    name: 'مسئول مالی و حسابداری',
    description: 'مدیریت فاکتورها، پرداخت‌ها، هزینه‌ها و گزارش‌های مالی',
    system: true,
    permissions: [
      'dashboard.view',
      'requests.view',
      'customers.view',
      'invoices.view', 'invoices.create', 'invoices.edit', 'invoices.cancel', 'invoices.export',
      'payments.view', 'payments.create', 'payments.approve', 'payments.cancel', 'payments.export',
      'expenses.view', 'expenses.create', 'expenses.edit', 'expenses.export',
      'reports.view', 'reports.export',
      'payroll.view', 'payroll.contracts.edit', 'payroll.accrue', 'payroll.settle', 'payroll.reports.view',
    ],
  },
];

export function expandPermissions(perms: string[] | '*', available: string[] = allPermissions()): string[] {
  if (perms === '*') return available;
  const set = new Set<string>();
  for (const p of perms) {
    if (p.endsWith('.*')) {
      const resource = p.slice(0, -2);
      for (const candidate of available) if (candidate.startsWith(`${resource}.`)) set.add(candidate);
    } else if (available.includes(p)) {
      set.add(p);
    }
  }
  return [...set];
}

export function hasPermission(granted: string[] | '*', required: string): boolean {
  if (granted === '*') return true;
  if (granted.includes(required)) return true;
  const [resource] = required.split('.');
  return granted.includes(`${resource}.*`);
}

export function hasAny(granted: string[] | '*', required: string[]): boolean {
  return required.some((r) => hasPermission(granted, r));
}

export function hasAll(granted: string[] | '*', required: string[]): boolean {
  return required.every((r) => hasPermission(granted, r));
}
