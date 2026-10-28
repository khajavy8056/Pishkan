import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from './api';

export interface Category {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  icon: string | null;
  color: string | null;
  image: string | null;
  serviceCount: number;
}

export interface Service {
  id: string;
  slug: string;
  title: string;
  summary: string;
  description: string;
  image: string | null;
  icon: string | null;
  categoryId: string | null;
  categoryTitle?: string | null;
  categorySlug?: string | null;
  coverage?:string;cityIds?:string[];urgentEnabled?:boolean;urgentPercent?:number;urgentDays?:number;urgentCapacity?:number;
  baseFee: number;
  discountPercent: number;
  finalFee: number;
  estimatedDays: number;
  paymentMethods: string[];
  tags: string[];
  form: FormField[];
  documents: { title: string; required: boolean; note?: string }[];
  workflow: { title: string; description?: string; role?: string; requiresDocument?: boolean }[];
  contactNotice: string | null;
  isPublished: boolean;
  acceptingRequests: boolean;
  isCustom: boolean;
  ownerCustomerId: string | null;
  needsReview: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface FormField {
  key: string;
  label: string;
  type: 'text' | 'tel' | 'number' | 'national_id' | 'date' | 'textarea' | 'select' | 'radio' | 'checkbox' | 'file' | 'money' | 'iban' | 'postal_code';
  required?: boolean;
  options?: string[];
  placeholder?: string;
  help?: string;
}

export interface WorkflowStep {
  title: string;
  description?: string;
  role?: string;
  requiresDocument?: boolean;
}

export interface SiteData {
  version: string;
  settings: Record<string, string | number | boolean>;
  categories: Category[];
  popularServices: Service[];
  newestServices: Service[];
  authMethods: { staffOtp?:boolean; otp: boolean; password: boolean; registrationOpen: boolean; passwordReset: boolean };
  maintenance: boolean;
  assistant: { enabled: boolean; name: string; welcome: string; disclaimer: string };
}

interface SiteState {
  site: SiteData | null;
  loading: boolean;
  reload: () => Promise<void>;
  setting: (key: string) => string;
}

const SiteContext = createContext<SiteState | null>(null);

export function SiteProvider({ children }: { children: ReactNode }) {
  const [site, setSite] = useState<SiteData | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    try {
      const res = await api.get<{ data: SiteData }>('/api/public/bootstrap');
      setSite(res.data);
      if (res.data.settings['brand.primary_color'] && typeof res.data.settings['brand.primary_color'] === 'string') {
        document.documentElement.style.setProperty('--color-brand-700', res.data.settings['brand.primary_color'] as string);
      }
      if (typeof res.data.settings['site.name'] === 'string') {
        document.title = `${res.data.settings['site.name']} — خدمات دولتی`;
      }
    } catch {
      /* the app still renders with defaults */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const setting = useCallback((key: string) => {
    const value = site?.settings?.[key];
    return value === undefined || value === null ? '' : String(value);
  }, [site]);

  const value = useMemo(() => ({ site, loading, reload, setting }), [site, loading, reload, setting]);
  return <SiteContext.Provider value={value}>{children}</SiteContext.Provider>;
}

export function useSite() {
  const ctx = useContext(SiteContext);
  if (!ctx) throw new Error('useSite must be used inside SiteProvider');
  return ctx;
}
