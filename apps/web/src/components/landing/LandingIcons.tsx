import {
  BadgeCheck,
  BookOpen,
  BriefcaseBusiness,
  Building2,
  Calculator,
  CarFront,
  ClipboardCheck,
  CreditCard,
  FileCheck2,
  FilePenLine,
  FileSpreadsheet,
  FileText,
  GraduationCap,
  HandCoins,
  Headset,
  HeartHandshake,
  HeartPulse,
  House,
  IdCard,
  Landmark,
  LayoutGrid,
  MessagesSquare,
  Plane,
  ReceiptText,
  Scale,
  ScrollText,
  ShieldAlert,
  ShieldCheck,
  ShieldPlus,
  Stethoscope,
  Store,
  Zap,
  type LucideIcon,
} from 'lucide-react';

const ICON_MAP: Record<string, LucideIcon> = {
  'file-text': FileText,
  'shield-plus': ShieldPlus,
  'building-2': Building2,
  building: Building2,
  'hand-coins': HandCoins,
  'car-front': CarFront,
  car: CarFront,
  calculator: Calculator,
  scale: Scale,
  'graduation-cap': GraduationCap,
  house: House,
  home: House,
  landmark: Landmark,
  shield: ShieldCheck,
  'shield-check': ShieldCheck,
  'book-open': BookOpen,
  store: Store,
  backpack: BriefcaseBusiness,
  'messages-square': MessagesSquare,
  'layout-grid': LayoutGrid,
  zap: Zap,
  headset: Headset,
  'heart-handshake': HeartHandshake,
  cpu: Calculator,
  'badge-check': BadgeCheck,
  badge: BadgeCheck,
  // Common emoji mappings from seeded catalog
  '🧾': ReceiptText,
  '⚠️': ShieldAlert,
  '📋': ClipboardCheck,
  '📝': FilePenLine,
  '🩺': Stethoscope,
  '💳': CreditCard,
  '🏢': Building2,
  '🚗': CarFront,
  '⚖️': Scale,
  '🏠': House,
  '🎓': GraduationCap,
  '🛂': IdCard,
  '✈️': Plane,
  '📜': ScrollText,
  '💰': HandCoins,
  '🏥': HeartPulse,
  '✅': FileCheck2,
};

export function resolveLandingIcon(
  icon?: string | null,
  fallbackText?: string | null,
  categoryIcon?: string | null,
): LucideIcon {
  if (icon && ICON_MAP[icon]) return ICON_MAP[icon];

  const text = `${icon ?? ''} ${fallbackText ?? ''}`.trim();
  if (text.includes('قبض') || text.includes('فیش')) return ReceiptText;
  if (text.includes('اعتراض') || text.includes('شکایت')) return ShieldAlert;
  if (text.includes('سوابق') || text.includes('لیست')) return FileSpreadsheet;
  if (text.includes('تعهد') || text.includes('گواهی') || text.includes('نامه')) return FilePenLine;
  if (text.includes('بیمه') || text.includes('سلامت') || text.includes('درمان')) return HeartPulse;
  if (text.includes('یارانه') || text.includes('وام') || text.includes('کالابرگ')) return HandCoins;
  if (text.includes('خودرو') || text.includes('پلاک') || text.includes('خلافی') || text.includes('گواهینامه')) return CarFront;
  if (text.includes('شرکت') || text.includes('مؤسسه') || text.includes('تاسیس')) return Building2;
  if (text.includes('مالیات') || text.includes('دارایی')) return Calculator;
  if (text.includes('قضایی') || text.includes('ثنا') || text.includes('دادگستری')) return Scale;
  if (text.includes('مسکن') || text.includes('ملک') || text.includes('پستی') || text.includes('اجاره')) return House;
  if (text.includes('سنجش') || text.includes('استخدام') || text.includes('دانشگاه') || text.includes('آموزش')) return GraduationCap;
  if (text.includes('گذرنامه') || text.includes('شناسنامه') || text.includes('کارت ملی')) return IdCard;
  if (text.includes('حساب') || text.includes('بانک') || text.includes('پرداخت')) return CreditCard;

  if (categoryIcon && ICON_MAP[categoryIcon]) return ICON_MAP[categoryIcon];
  return FileText;
}

export function LandingGlyph({
  icon,
  title,
  categoryIcon,
  className = 'size-6',
  strokeWidth = 2,
}: {
  icon?: string | null;
  title?: string | null;
  categoryIcon?: string | null;
  className?: string;
  strokeWidth?: number;
}) {
  if (icon && (/^\/uploads\/public\//.test(icon) || /^https?:\/\//.test(icon))) {
    return <img src={icon} alt="" className={`${className} rounded object-cover`} />;
  }
  const Icon = resolveLandingIcon(icon, title, categoryIcon);
  return <Icon className={className} strokeWidth={strokeWidth} aria-hidden="true" />;
}

const SLUG_GRADIENTS: Record<string, [string, string]> = {
  'insurance-health': ['#38bdf8', '#1d4ed8'],
  'companies-institutions': ['#818cf8', '#312e81'],
  'subsidy-welfare': ['#22d3ee', '#0e7490'],
  'vehicle-services': ['#f6c453', '#d97706'],
  'tax-services': ['#a78bfa', '#7c3aed'],
  'judicial-services': ['#60a5fa', '#1e3a8a'],
  'exams-employment': ['#38bdf8', '#0369a1'],
  'housing-land': ['#34d399', '#059669'],
  'civil-registry': ['#fb7185', '#be123c'],
  'municipal-services': ['#2dd4bf', '#0f766e'],
  'banking-finance': ['#fbbf24', '#b45309'],
  'business-licenses': ['#34d399', '#047857'],
};

const PALETTE: [string, string][] = [
  ['#22d3ee', '#1d4ed8'],
  ['#a78bfa', '#7c3aed'],
  ['#f6c453', '#d97706'],
  ['#34d399', '#059669'],
  ['#38bdf8', '#0284c7'],
  ['#fb7185', '#be123c'],
];

export function resolveGradient(slug?: string | null, color?: string | null, index = 0): [string, string] {
  if (slug && SLUG_GRADIENTS[slug]) return SLUG_GRADIENTS[slug];
  if (color && /^#[0-9a-f]{6}$/i.test(color)) {
    return [`color-mix(in oklab, ${color} 72%, #38bdf8)`, color];
  }
  return PALETTE[index % PALETTE.length];
}
