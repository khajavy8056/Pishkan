import {
  Children,cloneElement,isValidElement,useId,type ReactElement,createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
  type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes,
} from 'react';
import { CheckCircle2, AlertTriangle, Info, X, Loader2, ChevronLeft, ChevronRight, Inbox } from 'lucide-react';
import clsx from 'clsx';
import { STATUS_LABELS, STATUS_STYLES, faNum } from '../lib/format';

/* ---------------------------------- atoms --------------------------------- */

export function Card({ children, className, pad = true }: { children: ReactNode; className?: string; pad?: boolean }) {
  return <div className={clsx('card', pad && 'card-pad', className)}>{children}</div>;
}

export function SectionTitle({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 className="text-lg font-bold text-navy-900">{title}</h2>
        {description && <p className="mt-1 text-sm text-navy-500">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function Badge({ tone = 'default', children, className }: { tone?: 'default' | 'info' | 'success' | 'warning' | 'danger' | 'navy'; children: ReactNode; className?: string }) {
  const tones: Record<string, string> = {
    default: 'bg-navy-50 text-navy-700 ring-1 ring-navy-900/8',
    info: 'bg-brand-50 text-brand-700 ring-1 ring-brand-200',
    success: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200',
    warning: 'bg-amber-50 text-amber-800 ring-1 ring-amber-200',
    danger: 'bg-rose-50 text-rose-700 ring-1 ring-rose-200',
    navy: 'bg-navy-900 text-white',
  };
  return <span className={clsx('badge', tones[tone], className)}>{children}</span>;
}

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  return (
    <span className={clsx('badge', STATUS_STYLES[status] ?? 'bg-slate-100 text-slate-600 ring-1 ring-slate-200')}>
      {label ?? STATUS_LABELS[status] ?? status}
    </span>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={clsx('size-5 animate-spin text-brand-600', className)} />;
}

export function Loading({ label = 'در حال بارگذاری…', rows = 3 }: { label?: string; rows?: number }) {
  return (
    <div className="space-y-3" role="status" aria-live="polite">
      <div className="flex items-center gap-2 text-sm text-navy-500">
        <Spinner /> {label}
      </div>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="skeleton h-14 w-full" />
      ))}
    </div>
  );
}

export function EmptyState({ title, description, action, icon }: { title: string; description?: string; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-navy-900/12 bg-white/60 px-6 py-12 text-center">
      <div className="grid size-12 place-items-center rounded-2xl bg-navy-50 text-navy-400">
        {icon ?? <Inbox className="size-6" />}
      </div>
      <p className="font-medium text-navy-800">{title}</p>
      {description && <p className="max-w-sm text-sm text-navy-500">{description}</p>}
      {action}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-start gap-3 rounded-2xl border border-rose-200 bg-rose-50/70 p-5">
      <div className="flex items-center gap-2 font-medium text-rose-800">
        <AlertTriangle className="size-5" /> خطا
      </div>
      <p className="text-sm text-rose-700">{message}</p>
      {onRetry && <button type="button" className="btn-ghost btn-sm" onClick={onRetry}>تلاش دوباره</button>}
    </div>
  );
}

/* --------------------------------- buttons -------------------------------- */

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'navy' | 'ghost' | 'soft' | 'danger';
  size?: 'sm' | 'md';
  loading?: boolean;
  icon?: ReactNode;
};

export function Button({ variant = 'primary', size = 'md', loading, icon, children, className, disabled, ...rest }: ButtonProps) {
  const variants = { primary: 'btn-primary', navy: 'btn-navy', ghost: 'btn-ghost', soft: 'btn-soft', danger: 'btn-danger' };
  return (
    <button
      type="button"
      className={clsx(variants[variant], size === 'sm' && 'btn-sm', className)}
      disabled={disabled || loading}
      {...rest}
    >
      {loading ? <Loader2 className="size-4 animate-spin" /> : icon}
      {children}
    </button>
  );
}

/* --------------------------------- forms ---------------------------------- */

export function Field({ label, hint, error, required, children, className }: {
  label?: string; hint?: string; error?: string; required?: boolean; children: ReactNode; className?: string;
}) {
  const generated=useId();let controlId:string|undefined;
  const bind=(node:ReactNode):ReactNode=>Children.map(node,child=>{
    if(!isValidElement(child))return child;
    const el=child as ReactElement<any>;
    if(!controlId&&[Input,Select,Textarea,'input','select','textarea'].includes(el.type as any)){
      controlId=el.props.id??generated;
      return cloneElement(el,{id:controlId,'aria-required':required||undefined,'aria-invalid':!!error||undefined,'aria-describedby':hint||error?`${generated}-help`:undefined});
    }
    return el.props.children?cloneElement(el,{},bind(el.props.children)):el;
  });
  const controls=bind(children);
  return (
    <div className={className}>
      {label && (
        <label className="label" htmlFor={controlId}>
          {label}
          {required && <span className="text-rose-600"> *</span>}
        </label>
      )}
      {controls}
      {hint && !error && <p id={`${generated}-help`} className="hint">{hint}</p>}
      {error && <p id={`${generated}-help`} role="alert" className="field-error">{error}</p>}
    </div>
  );
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={clsx('input', props.className)} />;
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={clsx('input min-h-24 resize-y', props.className)} />;
}

export function Select({ options, placeholder, ...props }: SelectHTMLAttributes<HTMLSelectElement> & {
  options: { value: string; label: string }[];
  placeholder?: string;
}) {
  return (
    <select {...props} className={clsx('input appearance-none bg-[length:14px] pl-8', props.className)}
      style={{
        backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%2364748b' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")",
        backgroundRepeat: 'no-repeat', backgroundPosition: 'left 0.75rem center',
      }}
    >
      {placeholder && <option value="">{placeholder}</option>}
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

export function Switch({ checked, onChange, label, hint, disabled }: {
  checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string; disabled?: boolean;
}) {
  return (
    <label className={clsx('flex cursor-pointer items-start justify-between gap-4 rounded-xl border border-navy-900/8 bg-white px-4 py-3', disabled && 'opacity-60')}>
      <span>
        <span className="block text-sm font-medium text-navy-900">{label}</span>
        {hint && <span className="mt-0.5 block text-xs leading-relaxed text-navy-500">{hint}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={clsx(
          'relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition',
          checked ? 'bg-brand-600' : 'bg-navy-200',
        )}
      >
        <span className={clsx('absolute top-0.5 size-5 rounded-full bg-white shadow transition-all', checked ? 'right-0.5' : 'right-[22px]')} />
      </button>
    </label>
  );
}

/* ---------------------------------- modal --------------------------------- */

export function Modal({ open, onClose, title, children, footer, size = 'md' }: {
  open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode; size?: 'sm' | 'md' | 'lg';
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  if (!open) return null;
  const widths = { sm: 'max-w-md', md: 'max-w-xl', lg: 'max-w-3xl' };
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-navy-950/40 p-0 backdrop-blur-sm sm:items-center sm:p-6" onClick={onClose}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={clsx('animate-pop max-h-[92vh] w-full overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:rounded-2xl', widths[size])}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-navy-900/8 px-5 py-4">
          <h3 className="font-bold text-navy-900">{title}</h3>
          <button type="button" onClick={onClose} aria-label="بستن" className="rounded-lg p-1.5 text-navy-400 hover:bg-navy-50">
            <X className="size-5" />
          </button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto px-5 py-4 scrollbar-thin">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-navy-900/8 bg-navy-50/40 px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

/* ---------------------------------- toast --------------------------------- */

interface Toast { id: number; message: string; tone: 'success' | 'error' | 'info'; }
const ToastContext = createContext<{ notify: (message: string, tone?: Toast['tone']) => void } | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const notify = useCallback((message: string, tone: Toast['tone'] = 'success') => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, message, tone }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4500);
  }, []);
  const value = useMemo(() => ({ notify }), [notify]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed bottom-4 left-1/2 z-[60] flex w-full max-w-sm -translate-x-1/2 flex-col gap-2 px-4">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role="status"
            className={clsx('animate-pop pointer-events-auto flex items-start gap-2 rounded-xl px-4 py-3 text-sm shadow-lg ring-1',
              toast.tone === 'success' && 'bg-emerald-600 text-white ring-emerald-700',
              toast.tone === 'error' && 'bg-rose-600 text-white ring-rose-700',
              toast.tone === 'info' && 'bg-navy-900 text-white ring-navy-800',
            )}
          >
            {toast.tone === 'success' ? <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
              : toast.tone === 'error' ? <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                : <Info className="mt-0.5 size-4 shrink-0" />}
            <span className="leading-relaxed">{toast.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside ToastProvider');
  return ctx;
}

/* --------------------------------- tables --------------------------------- */

export function Pagination({ page, pageSize, total, onChange }: { page: number; pageSize: number; total: number; onChange: (page: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  return (
    <div className="mt-4 flex items-center justify-between gap-3 text-sm text-navy-600">
      <span>صفحه {faNum(page)} از {faNum(pages)} — {faNum(total)} مورد</span>
      <div className="flex gap-2">
        <Button size="sm" variant="ghost" disabled={page <= 1} onClick={() => onChange(page - 1)} icon={<ChevronRight className="size-4" />}>قبلی</Button>
        <Button size="sm" variant="ghost" disabled={page >= pages} onClick={() => onChange(page + 1)}>بعدی<ChevronLeft className="size-4" /></Button>
      </div>
    </div>
  );
}

export function Tabs({ tabs, active, onChange }: { tabs: { key: string; label: string; count?: number }[]; active: string; onChange: (key: string) => void }) {
  return (
    <div role="tablist" className="flex flex-wrap gap-1 rounded-xl bg-navy-50 p-1">
      {tabs.map((tab) => (
        <button
          key={tab.key}
          role="tab"
          aria-selected={active === tab.key}
          onClick={() => onChange(tab.key)}
          className={clsx('rounded-lg px-3 py-1.5 text-sm transition',
            active === tab.key ? 'bg-white font-medium text-navy-900 shadow-sm' : 'text-navy-600 hover:text-navy-900')}
        >
          {tab.label}
          {tab.count !== undefined && <span className="mr-1 text-xs text-navy-400">({faNum(tab.count)})</span>}
        </button>
      ))}
    </div>
  );
}

export function StatCard({ label, value, hint, icon, tone = 'brand' }: {
  label: string; value: ReactNode; hint?: string; icon?: ReactNode; tone?: 'brand' | 'emerald' | 'amber' | 'rose' | 'navy';
}) {
  const tones: Record<string, string> = {
    brand: 'bg-brand-50 text-brand-700',
    emerald: 'bg-emerald-50 text-emerald-700',
    amber: 'bg-amber-50 text-amber-700',
    rose: 'bg-rose-50 text-rose-700',
    navy: 'bg-navy-50 text-navy-800',
  };
  return (
    <div className="card card-pad flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="truncate text-xs font-medium text-navy-500">{label}</p>
        <p className="mt-1 text-2xl font-bold tracking-tight text-navy-900">{value}</p>
        {hint && <p className="mt-1 text-xs text-navy-400">{hint}</p>}
      </div>
      {icon && <span className={clsx('grid size-11 shrink-0 place-items-center rounded-xl', tones[tone])}>{icon}</span>}
    </div>
  );
}

export function BarChart({ data, max, labelKey = 'label' }: { data: { [k: string]: any }[]; max?: number; labelKey?: string }) {
  const top = max ?? Math.max(1, ...data.map((d) => Number(d.value ?? d.count ?? 0)));
  if (!data.length) return <p className="text-sm text-navy-400">داده‌ای برای نمایش نیست.</p>;
  return (
    <div className="flex h-40 items-end gap-1.5">
      {data.map((d, i) => {
        const value = Number(d.value ?? d.count ?? 0);
        return (
          <div key={i} className="group flex flex-1 flex-col items-center justify-end gap-1">
            <span className="text-[10px] text-navy-400 opacity-0 transition group-hover:opacity-100">{faNum(value)}</span>
            <div
              className="w-full rounded-t-md bg-gradient-to-t from-brand-600 to-brand-400 transition hover:from-brand-700"
              style={{ height: `${Math.max(4, (value / top) * 100)}%` }}
              title={`${d[labelKey] ?? ''}: ${faNum(value)}`}
            />
            <span className="max-w-full truncate text-[10px] text-navy-400">{d[labelKey]}</span>
          </div>
        );
      })}
    </div>
  );
}
