import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowRight, Bot, Check, CheckCircle2, CircleDollarSign, Clock3, FileText, Loader2, LockKeyhole, ShieldCheck,
  Sparkles, UploadCloud, UserRound, XCircle,
} from 'lucide-react';
import clsx from 'clsx';
import { PublicLayout } from '../../components/public-layout';
import { Badge, Button, useToast } from '../../components/ui';
import { api, ApiFailure } from '../../lib/api';
import { faDateTime, faNum, rial } from '../../lib/format';
import { formatDuration, useSite } from '../../lib/site';
import { useAuth } from '../../lib/auth';
import {
  draftStageLabel, draftStageTone, paymentMethodLabel,
  type AssistantAction, type AssistantCard, type AssistantCaseCard, type AssistantDraft,
  type AssistantDraftDocument, type AssistantDraftField, type AssistantInfo, type AssistantInvoiceCard,
  type AssistantMessage, type AssistantProfileCard, type AssistantReply, type AssistantServiceCard,
  type AssistantTicketCard, type AssistantWalletCard, type AssistantCatalogCard,
} from '../../lib/assistant';

/* -------------------------------------------------------------------------- */
/*                              small presenters                              */
/* -------------------------------------------------------------------------- */

function Row({ label, value, tone }: { label: string; value: React.ReactNode; tone?: 'danger' | 'success' | 'warning' }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1 text-[11px]">
      <span className="shrink-0 text-navy-500">{label}</span>
      <span className={clsx('min-w-0 text-left font-medium', tone === 'danger' ? 'text-rose-700 dark:text-rose-300' : tone === 'success' ? 'text-emerald-700 dark:text-emerald-300' : tone === 'warning' ? 'text-amber-700 dark:text-amber-300' : 'text-navy-800 dark:text-navy-100')}>
        {value}
      </span>
    </div>
  );
}

function CardShell({ children, tone = 'default', className }: { children: React.ReactNode; tone?: 'default' | 'success' | 'warning' | 'danger'; className?: string }) {
  const tones = {
    default: 'ring-line',
    success: 'ring-emerald-200 dark:ring-emerald-900',
    warning: 'ring-amber-200 dark:ring-amber-900',
    danger: 'ring-rose-200 dark:ring-rose-900',
  };
  return (
    <div className={clsx('mt-3 rounded-2xl bg-surface-2 p-3 ring-1 dark:bg-navy-900/60', tones[tone], className)}>
      {children}
    </div>
  );
}

function ServiceCardView({ service, onRequest }: { service: AssistantServiceCard; onRequest?: (service: AssistantServiceCard) => void }) {
  // Older servers (and older fixtures) may send a partial card; the client
  // renders whatever is present instead of throwing.
  const requiredFields = service.requiredFields ?? [];
  const documents = service.documents ?? [];
  const tags = service.tags ?? [];
  return (
    <CardShell>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <Link to={`/services/${service.slug}`} className="block text-xs font-bold text-navy-900 hover:text-accent dark:text-navy-50">
            {service.title}
          </Link>
          <span className="mt-0.5 block text-[10px] text-navy-500">{service.summary}</span>
        </div>
        {service.acceptingRequests
          ? <Badge tone="success">در حال پذیرش</Badge>
          : <Badge tone="warning">موقتاً بسته</Badge>}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-navy-500">
        <span className="inline-flex items-center gap-1"><CircleDollarSign className="size-3" />{rial(service.finalFee)}</span>
        <span className="inline-flex items-center gap-1"><Clock3 className="size-3" />زمان تخمینی: {formatDuration(service.estimatedMinutes, service.estimatedDays)}</span>
        {service.categoryTitle && <span>{service.categoryTitle}</span>}
        {service.urgentEnabled && <Badge tone="info">فوری {faNum(service.urgentPercent ?? 0)}٪</Badge>}
        {service.needsReview && <Badge tone="default">نیازمند بررسی</Badge>}
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <span className="text-[10px] text-navy-500">
          {faNum(requiredFields.length)} فیلد · {faNum(documents.filter((d) => d.required).length)} مدرک الزامی
        </span>
        <div className="flex gap-2">
          <Link to={`/services/${service.slug}`} className="text-[11px] font-semibold text-accent hover:underline">جزئیات</Link>
          {onRequest && service.acceptingRequests && (
            <button type="button" onClick={() => onRequest(service)} className="text-[11px] font-semibold text-accent hover:underline">
              شروع درخواست
            </button>
          )}
        </div>
      </div>
    </CardShell>
  );
}

function CaseCardView({ card, onAction }: { card: AssistantCaseCard; onAction: (action: AssistantAction) => void }) {
  return (
    <CardShell tone={card.rejectedDocuments.length ? 'warning' : 'default'}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <span className="block text-[10px] text-navy-500">کد پیگیری {card.trackingCode}</span>
          <span className="block text-xs font-bold text-navy-900 dark:text-navy-50">{card.serviceTitle}</span>
        </div>
        <Badge tone={card.rejectedDocuments.length ? 'warning' : 'info'}>{card.statusLabel}</Badge>
      </div>
      <div className="mt-2 divide-y divide-line">
        {card.currentStepTitle && <Row label="مرحله فعلی" value={`${faNum(card.currentStep)} از ${faNum(card.stepCount)} — ${card.currentStepTitle}`} />}
        {card.nextStepTitle && <Row label="قدم بعدی" value={card.nextStepTitle} tone="success" />}
        {card.workBucketLabel && <Row label="وضعیت کار" value={card.workBucketLabel} />}
        {card.assigneeName && <Row label="کارشناس" value={card.assigneeName} />}
        <Row label="هزینه" value={`${rial(card.total)} (${card.paymentStatusLabel})`} />
        {card.estimatedCompletionAt && <Row label="تخمین تحویل" value={faDateTime(card.estimatedCompletionAt)} />}
        <Row label="آخرین تغییر" value={faDateTime(card.updatedAt)} />
      </div>
      {card.rejectedDocuments.length > 0 && (
        <div className="mt-2 rounded-xl bg-rose-50 p-2 ring-1 ring-rose-200 dark:bg-rose-500/10 dark:ring-rose-500/30">
          <p className="text-[11px] font-semibold text-rose-800 dark:text-rose-200">مدارک نیازمند اصلاح</p>
          {card.rejectedDocuments.map((doc) => (
            <p key={doc.title} className="mt-1 text-[11px] leading-5 text-rose-800 dark:text-rose-200">
              • {doc.title}{doc.note ? ` — ${doc.note}` : ''}
            </p>
          ))}
        </div>
      )}
      {card.documents.length > 0 && (
        <div className="mt-2 space-y-1">
          {card.documents.map((doc) => (
            <div key={`${doc.title}-${doc.status}`} className="flex items-center justify-between gap-2 text-[11px]">
              <span className="inline-flex items-center gap-1 text-navy-700 dark:text-navy-200">
                {doc.status === 'rejected' ? <XCircle className="size-3 text-rose-600" /> : doc.status === 'approved' ? <CheckCircle2 className="size-3 text-emerald-600" /> : <FileText className="size-3 text-navy-400" />}
                {doc.title}
              </span>
              <span className={clsx(doc.status === 'rejected' ? 'text-rose-700 dark:text-rose-300' : 'text-navy-500')}>
                {doc.status === 'approved' ? 'تأییدشده' : doc.status === 'rejected' ? (doc.reviewNote || 'رد شده') : doc.status === 'pending' ? 'در انتظار بررسی' : doc.status}
              </span>
            </div>
          ))}
        </div>
      )}
      {card.notes.length > 0 && (
        <div className="mt-2 space-y-1">
          {card.notes.slice(-2).map((note) => (
            <p key={note.createdAt} className="text-[11px] leading-5 text-navy-600 dark:text-navy-300">📝 {note.message}</p>
          ))}
        </div>
      )}
      {(card.nextAction || card.invoices.some((invoice) => invoice.remaining > 0)) && (
        <div className="mt-2 flex flex-wrap gap-2">
          {card.nextAction && <Button size="sm" variant="ghost" onClick={() => onAction(card.nextAction!)}>{card.nextAction.label}</Button>}
          {card.invoices.filter((invoice) => invoice.remaining > 0).map((invoice) => (
            <Button key={invoice.id} size="sm" variant="soft" onClick={() => invoice.action && onAction(invoice.action)}>
              پرداخت {rial(invoice.remaining)}
            </Button>
          ))}
        </div>
      )}
    </CardShell>
  );
}

function InvoiceCardView({ invoice, onAction }: { invoice: AssistantInvoiceCard; onAction: (action: AssistantAction) => void }) {
  return (
    <CardShell tone={invoice.remaining > 0 ? 'warning' : 'success'}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <span className="block text-[10px] text-navy-500">فاکتور {invoice.number}</span>
          <span className="block text-xs font-bold text-navy-900 dark:text-navy-50">{invoice.title}</span>
          {invoice.serviceTitle && <span className="block text-[10px] text-navy-500">{invoice.serviceTitle}</span>}
        </div>
        <Badge tone={invoice.remaining > 0 ? 'warning' : 'success'}>{invoice.statusLabel}</Badge>
      </div>
      <div className="mt-2 divide-y divide-line">
        <Row label="مبلغ کل" value={rial(invoice.total)} />
        <Row label="پرداخت‌شده" value={rial(invoice.paidAmount)} tone="success" />
        <Row label="مانده" value={rial(invoice.remaining)} tone={invoice.remaining > 0 ? 'danger' : 'success'} />
        {invoice.external && <Row label="نوع هزینه" value="هزینهٔ سازمان (غیر از حق‌الزحمهٔ دفتر)" />}
        {invoice.dueAt && <Row label="مهلت پرداخت" value={faDateTime(invoice.dueAt)} />}
      </div>
      {invoice.action && (
        <div className="mt-2">
          <Button size="sm" variant={invoice.remaining > 0 ? 'primary' : 'ghost'} onClick={() => onAction(invoice.action!)}>
            {invoice.remaining > 0 ? 'پرداخت فاکتور' : invoice.action.label}
          </Button>
        </div>
      )}
    </CardShell>
  );
}

function WalletCardView({ wallet, onAction }: { wallet: AssistantWalletCard; onAction: (action: AssistantAction) => void }) {
  return (
    <CardShell>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-bold text-navy-900 dark:text-navy-50">کیف پول</span>
        <Badge tone={wallet.enabled ? 'success' : 'default'}>{wallet.statusLabel}</Badge>
      </div>
      <div className="mt-2 divide-y divide-line">
        <Row label="موجودی" value={rial(wallet.balance)} tone="success" />
        {wallet.pendingTopups > 0 && <Row label="شارژ در انتظار" value={rial(wallet.pendingTopups)} tone="warning" />}
      </div>
      {wallet.action && <div className="mt-2"><Button size="sm" variant="soft" onClick={() => onAction(wallet.action!)}>{wallet.action.label}</Button></div>}
    </CardShell>
  );
}

function ProfileCardView({ profile, onAction }: { profile: AssistantProfileCard; onAction: (action: AssistantAction) => void }) {
  return (
    <CardShell tone={profile.complete ? 'success' : 'warning'}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-bold text-navy-900 dark:text-navy-50">پروفایل {profile.fullName}</span>
        <Badge tone={profile.complete ? 'success' : 'warning'}>{profile.complete ? 'کامل' : 'ناقص'}</Badge>
      </div>
      <div className="mt-2 divide-y divide-line">
        <Row label="موبایل" value={profile.mobile} />
        {profile.city && <Row label="شهر" value={profile.city} />}
        <Row label="مدارک پروفایل" value={`${faNum(profile.documentCount)} مدرک (${faNum(profile.rejectedDocumentCount)} ردشده)`} tone={profile.rejectedDocumentCount ? 'warning' : undefined} />
        {!profile.complete && <Row label="موارد ناقص" value={profile.missing.join('، ')} tone="warning" />}
      </div>
      {profile.action && <div className="mt-2"><Button size="sm" variant="soft" onClick={() => onAction(profile.action!)}>{profile.action.label}</Button></div>}
    </CardShell>
  );
}

function TicketCardView({ ticket, onAction }: { ticket: AssistantTicketCard; onAction: (action: AssistantAction) => void }) {
  return (
    <CardShell>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <span className="block text-[10px] text-navy-500">تیکت {ticket.number} · {ticket.departmentLabel}</span>
          <span className="block text-xs font-bold text-navy-900 dark:text-navy-50">{ticket.subject}</span>
        </div>
        <Badge tone={ticket.unreadForCustomer > 0 ? 'info' : 'default'}>
          {ticket.statusLabel}{ticket.unreadForCustomer > 0 ? ` · ${faNum(ticket.unreadForCustomer)} پیام جدید` : ''}
        </Badge>
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="text-[10px] text-navy-500">آخرین به‌روزرسانی {faDateTime(ticket.updatedAt)}</span>
        {ticket.action && <Button size="sm" variant="ghost" onClick={() => onAction(ticket.action!)}>{ticket.action.label}</Button>}
      </div>
    </CardShell>
  );
}

function CatalogCardView({ catalog, onAction }: { catalog: AssistantCatalogCard; onAction: (action: AssistantAction) => void }) {
  return (
    <CardShell>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-bold text-navy-900 dark:text-navy-50">{catalog.title}</span>
        <Badge>{faNum(catalog.total)} خدمت</Badge>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {catalog.categories.map((category) => (
          <Link key={category.slug} to={`/services?category=${category.slug}`}
            className="rounded-full bg-surface-3 px-2.5 py-1 text-[10px] text-navy-600 hover:bg-brand-50 dark:text-navy-300">
            {category.title} ({faNum(category.serviceCount)})
          </Link>
        ))}
      </div>
      {catalog.services.length > 0 && (
        <div className="mt-2 space-y-1">
          {catalog.services.map((service) => (
            <div key={service.id} className="flex items-center justify-between gap-2 text-[11px]">
              <Link to={`/services/${service.slug}`} className="min-w-0 truncate font-medium text-navy-800 hover:text-accent dark:text-navy-100">
                {service.title}
              </Link>
              <span className="shrink-0 text-[10px] text-navy-500">{rial(service.finalFee)}</span>
            </div>
          ))}
        </div>
      )}
      {catalog.action && <div className="mt-2"><Button size="sm" variant="ghost" onClick={() => onAction(catalog.action!)}>{catalog.action.label}</Button></div>}
    </CardShell>
  );
}

function AssistantCardView({ card, onAction, onRequest }: { card: AssistantCard; onAction: (action: AssistantAction) => void; onRequest?: (service: AssistantServiceCard) => void }) {
  switch (card.type) {
    case 'service': return <ServiceCardView service={card.service} onRequest={onRequest} />;
    case 'case': return <CaseCardView card={card.case} onAction={onAction} />;
    case 'invoice': return <InvoiceCardView invoice={card.invoice} onAction={onAction} />;
    case 'wallet': return <WalletCardView wallet={card.wallet} onAction={onAction} />;
    case 'profile': return <ProfileCardView profile={card.profile} onAction={onAction} />;
    case 'ticket': return <TicketCardView ticket={card.ticket} onAction={onAction} />;
    case 'catalog': return <CatalogCardView catalog={catalogFor(card)} onAction={onAction} />;
    default: return null;
  }
}

/* `catalogFor` keeps the exhaustive switch above typed without a cast. */
function catalogFor(card: AssistantCard): AssistantCatalogCard {
  return (card as { catalog: AssistantCatalogCard }).catalog;
}

function ActionButtons({ actions, onAction, disabled }: { actions: AssistantAction[]; onAction: (action: AssistantAction) => void; disabled?: boolean }) {
  if (!actions.length) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {actions.map((action) => (
        <Button
          key={action.id}
          size="sm"
          variant={action.kind === 'confirm' ? 'primary' : action.kind === 'cancel' ? 'ghost' : action.kind === 'upload' ? 'soft' : 'ghost'}
          disabled={disabled}
          onClick={() => onAction(action)}
        >
          {action.kind === 'login' && <LockKeyhole className="size-3.5" />}
          {action.kind === 'register' && <UserRound className="size-3.5" />}
          {action.kind === 'upload' && <UploadCloud className="size-3.5" />}
          {action.kind === 'confirm' && <ShieldCheck className="size-3.5" />}
          {action.label}
        </Button>
      ))}
    </div>
  );
}

function SubmittedDraftCard({ draft }: { draft: AssistantDraft }) {
  return (
    <CardShell tone="success" className="mt-2">
      <div className="flex items-center gap-2 text-sm font-semibold text-emerald-700 dark:text-emerald-300">
        <CheckCircle2 className="size-4" /> درخواست شما ثبت شد
      </div>
      <div className="mt-2 divide-y divide-line">
        <Row label="خدمت" value={draft.serviceTitle} />
        {draft.trackingCode && <Row label="کد پیگیری" value={draft.trackingCode} tone="success" />}
        <Row label="مبلغ" value={draft.pricing ? rial(draft.pricing.total) : '—'} />
        <Row label="زمان تخمینی" value={formatDuration(draft.estimatedMinutes, draft.estimatedDays)} />
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        {draft.requestId && (
          <Link to={`/app/requests/${draft.requestId}`} className="btn-soft btn-sm">مشاهده پرونده و بارگذاری مدارک</Link>
        )}
        <Link to="/app/invoices" className="btn-ghost btn-sm">فاکتورها و پرداخت</Link>
      </div>
    </CardShell>
  );
}

/* -------------------------------------------------------------------------- */
/*                                 draft panel                                */
/* -------------------------------------------------------------------------- */

function DraftPanel({ draft, onChange, onAction, busy }: {
  draft: AssistantDraft;
  onChange: (draft: AssistantDraft) => void;
  onAction: (action: AssistantAction) => void;
  busy: boolean;
}) {
  const { notify } = useToast();
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(draft.fields.map((f) => [f.key, f.value ?? ''])));
  const [savingKey, setSavingKey] = useState('');
  const [uploadingKey, setUploadingKey] = useState('');

  useEffect(() => {
    setValues(Object.fromEntries(draft.fields.map((f) => [f.key, f.value ?? ''])));
  }, [draft.id]);

  const saveField = async (field: AssistantDraftField) => {
    const value = values[field.key] ?? '';
    if (value === (field.value ?? '')) return;
    setSavingKey(field.key);
    try {
      const res = await api.patch<{ data: { draft: AssistantDraft } }>('/api/assistant/draft', { key: field.key, value });
      onChange(res.data.draft);
    } catch (err) {
      notify(err instanceof ApiFailure ? err.message : 'ذخیره فیلد انجام نشد', 'error');
    } finally {
      setSavingKey('');
    }
  };

  const upload = async (doc: AssistantDraftDocument, file: File) => {
    setUploadingKey(doc.key);
    try {
      const uploaded = await api.upload<{ data: { id: string } }>('/api/files/upload', file, { purpose: 'document', documentQuality: 'true' });
      const res = await api.post<{ data: { draft: AssistantDraft } }>('/api/assistant/draft/documents', {
        requirementKey: doc.key, fileId: uploaded.data.id,
      });
      onChange(res.data.draft);
      notify('مدرک به پیش‌نویس اضافه شد', 'success');
    } catch (err) {
      notify(err instanceof ApiFailure ? err.message : 'بارگذاری مدرک انجام نشد', 'error');
    } finally {
      setUploadingKey('');
    }
  };

  const useProfileDocument = async (doc: AssistantDraftDocument) => {
    if (!doc.suggestedProfileDocumentId) return;
    setUploadingKey(doc.key);
    try {
      const res = await api.post<{ data: { draft: AssistantDraft } }>('/api/assistant/draft/documents', {
        requirementKey: doc.key, customerDocumentId: doc.suggestedProfileDocumentId,
      });
      onChange(res.data.draft);
    } catch (err) {
      notify(err instanceof ApiFailure ? err.message : 'افزودن مدرک پروفایل انجام نشد', 'error');
    } finally {
      setUploadingKey('');
    }
  };

  const submitted = draft.stage === 'submitted';
  const awaiting = draft.stage === 'awaiting_confirmation';

  return (
    <CardShell tone={submitted ? 'success' : awaiting ? 'warning' : 'default'} className="mt-2">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <span className="block text-[10px] text-navy-500">پیش‌نویس درخواست</span>
          <span className="block text-sm font-bold text-navy-900 dark:text-navy-50">{draft.serviceTitle}</span>
          {draft.categoryTitle && <span className="block text-[10px] text-navy-500">{draft.categoryTitle}</span>}
        </div>
        <Badge tone={draftStageTone(draft.stage)}>{draftStageLabel(draft.stage)}</Badge>
      </div>

      {submitted ? (
        <div className="mt-3 space-y-2">
          <div className="flex items-center gap-2 text-sm font-semibold text-emerald-700 dark:text-emerald-300">
            <CheckCircle2 className="size-4" /> درخواست شما ثبت شد
          </div>
          {draft.trackingCode && <Row label="کد پیگیری" value={draft.trackingCode} tone="success" />}
          <Row label="وضعیت" value={draftStageLabel(draft.stage)} />
          <Row label="مبلغ" value={draft.pricing ? rial(draft.pricing.total) : '—'} />
          <div className="mt-2 flex flex-wrap gap-2">
            {draft.requestId && (
              <Link to={`/app/requests/${draft.requestId}`} className="btn-soft btn-sm">مشاهده پرونده و بارگذاری مدارک</Link>
            )}
            <Link to="/app/invoices" className="btn-ghost btn-sm">فاکتورها و پرداخت</Link>
            <Link to="/app" className="btn-ghost btn-sm">پنل من</Link>
          </div>
        </div>
      ) : (
        <>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <Row label="زمان تخمینی" value={formatDuration(draft.estimatedMinutes, draft.estimatedDays)} />
            <Row label="هزینه" value={draft.pricing ? rial(draft.pricing.total) : '—'} />
            <Row label="روش پرداخت" value={paymentMethodLabel(draft.paymentMethod)} />
            <Row label="اولویت" value={draft.priority === 'high' ? 'فوری' : 'عادی'} />
            {draft.pricing?.discount ? <Row label="تخفیف" value={`${faNum(draft.pricing.discount)} ریال`} tone="success" /> : null}
            <Row label="انقضا" value={faDateTime(draft.expiresAt)} />
          </div>

          <div className="mt-3 space-y-2">
            <p className="text-[11px] font-semibold text-navy-800 dark:text-navy-100">فیلدهای فرم</p>
            {draft.fields.map((field) => (
              <div key={field.key}>
                <label className="mb-1 block text-[10px] text-navy-600 dark:text-navy-300" htmlFor={`draft-${field.key}`}>
                  {field.label}{field.required && <span className="text-rose-600"> *</span>}
                  {field.fromProfile && <span className="mr-1 text-[9px] text-accent">(از پروفایل)</span>}
                </label>
                {field.options?.length ? (
                  <select
                    id={`draft-${field.key}`}
                    className="input"
                    value={values[field.key] ?? ''}
                    onBlur={() => saveField(field)}
                    onChange={(e) => setValues((prev) => ({ ...prev, [field.key]: e.target.value }))}
                  >
                    <option value="">— انتخاب کنید —</option>
                    {field.options.map((option) => <option key={option} value={option}>{option}</option>)}
                  </select>
                ) : (
                  <input
                    id={`draft-${field.key}`}
                    className={clsx('input', field.error && 'border-rose-300')}
                    value={values[field.key] ?? ''}
                    placeholder={field.placeholder ?? ''}
                    onChange={(e) => setValues((prev) => ({ ...prev, [field.key]: e.target.value }))}
                    onBlur={() => saveField(field)}
                  />
                )}
                {field.help && <span className="mt-0.5 block text-[9px] text-navy-400">{field.help}</span>}
                {field.error && <span className="mt-0.5 block text-[9px] text-rose-700">{field.error}</span>}
                {savingKey === field.key && <span className="mt-0.5 block text-[9px] text-navy-400">در حال ذخیره…</span>}
              </div>
            ))}
          </div>

          <div className="mt-3 space-y-2">
            <p className="text-[11px] font-semibold text-navy-800 dark:text-navy-100">مدارک موردنیاز</p>
            {draft.documents.length === 0 && <p className="text-[10px] text-navy-500">مدرک الزامی ثبت نشده است.</p>}
            {draft.documents.map((doc) => (
              <div key={doc.key} className={clsx('rounded-xl border p-2', doc.error ? 'border-rose-300 bg-rose-50 dark:bg-rose-500/10' : 'border-line bg-surface dark:bg-navy-950/40')}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[11px] font-medium text-navy-800 dark:text-navy-100">
                    {doc.title}{doc.required && <span className="text-rose-600"> *</span>}
                  </span>
                  {doc.attachment ? (
                    <span className="inline-flex items-center gap-1 text-[10px] text-emerald-700 dark:text-emerald-300">
                      <Check className="size-3" /> {doc.attachment.name}
                    </span>
                  ) : (
                    <span className="flex gap-2">
                      {doc.suggestedProfileDocumentId && (
                        <button type="button" disabled={uploadingKey === doc.key} onClick={() => useProfileDocument(doc)}
                          className="text-[10px] font-semibold text-accent hover:underline">
                          استفاده از «{doc.suggestedProfileDocumentName ?? 'مدرک پروفایل'}»
                        </button>
                      )}
                      <label className="inline-flex cursor-pointer items-center gap-1 text-[10px] font-semibold text-accent hover:underline">
                        {uploadingKey === doc.key ? <Loader2 className="size-3 animate-spin" /> : <UploadCloud className="size-3" />}
                        بارگذاری مدرک
                        <input type="file" className="hidden" accept="image/*,.pdf"
                          onChange={(e) => { const file = e.target.files?.[0]; if (file) upload(doc, file); e.currentTarget.value = ''; }} />
                      </label>
                    </span>
                  )}
                </div>
                {doc.error && <p className="mt-1 text-[9px] text-rose-700">{doc.error}</p>}
              </div>
            ))}
          </div>

          {(draft.missingFields.length > 0 || draft.missingDocuments.length > 0) && (
            <div className="mt-2 rounded-xl bg-amber-50 p-2 text-[11px] leading-5 text-amber-900 ring-1 ring-amber-200 dark:bg-amber-500/10 dark:text-amber-200 dark:ring-amber-500/30">
              {draft.missingFields.length > 0 && <p>فیلدهای ناقص: {draft.missingFields.join('، ')}</p>}
              {draft.missingDocuments.length > 0 && <p>مدارک ناقص: {draft.missingDocuments.join('، ')}</p>}
            </div>
          )}

          {draft.submissionError && (
            <div className="mt-2 rounded-xl bg-rose-50 p-2 text-[11px] leading-5 text-rose-800 ring-1 ring-rose-200 dark:bg-rose-500/10 dark:text-rose-200 dark:ring-rose-500/30">
              {draft.submissionError}
            </div>
          )}

          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" variant="primary" loading={busy} disabled={busy} onClick={() => onAction({ id: 'preview', kind: 'confirm', label: 'پیش‌نمایش و تأیید نهایی' })}>
              <ShieldCheck className="size-3.5" /> پیش‌نمایش و تأیید نهایی
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => onAction({ id: 'cancel-draft', kind: 'cancel', label: 'انصراف' })}>
              انصراف
            </Button>
          </div>
          <p className="mt-2 text-[9px] leading-4 text-navy-400">
            هیچ درخواستی تا تأیید صریح شما ثبت نمی‌شود. پس از تأیید، درخواست از مسیر اصلی سامانه و با همان اعتبارسنجی ایجاد می‌شود.
          </p>
        </>
      )}
    </CardShell>
  );
}

/* -------------------------------------------------------------------------- */
/*                                   page                                     */
/* -------------------------------------------------------------------------- */

const QUICK_ACTIONS = [
  { label: 'ثبت درخواست جدید', message: 'می‌خواهم یک درخواست ثبت کنم' },
  { label: 'وضعیت پرونده‌های من', message: 'وضعیت پرونده‌های من چیست؟' },
  { label: 'فاکتور و مبلغ قابل پرداخت', message: 'چقدر باید پرداخت کنم؟' },
  { label: 'موجودی کیف پول', message: 'موجودی کیف پول من چقدر است؟' },
  { label: 'مدارک لازم', message: 'برای ثبت درخواست چه مدارکی لازم است؟' },
];

export function AssistantPage() {
  const { site, setting } = useSite();
  const { user } = useAuth();
  const navigate = useNavigate();
  const { notify } = useToast();

  const [info, setInfo] = useState<AssistantInfo | null>(null);
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<AssistantDraft | null>(null);
  const [restored, setRestored] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const idRef = useRef(0);

  const nextId = useCallback(() => `m${++idRef.current}`, []);
  const enabled = info ? info.enabled : (site?.assistant.enabled ?? true);
  const showQuickActions = setting('assistant.show_quick_actions') !== 'false';

  const pushAssistant = useCallback((content: string, reply?: AssistantReply) => {
    setMessages((prev) => [...prev, { id: `${Date.now()}-${prev.length}`, role: 'assistant', content, reply }]);
    if (reply?.draft) setDraft(reply.draft);
  }, []);

  useEffect(() => {
    let alive = true;
    api.get<{ data: AssistantInfo }>('/api/assistant/info')
      .then((res) => {
        if (!alive) return;
        setInfo(res.data);
        if (res.data.draft && res.data.draft.stage !== 'submitted') {
          setDraft(res.data.draft);
          setRestored(true);
        }
      })
      .catch(() => { if (alive) setInfo({ ...emptyInfo(site) }); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // Wait for `/info`: its welcome (and the pending draft it may carry) is
    // authoritative. Falling back to the site bootstrap would greet the user
    // twice when the real info arrives a moment later.
    if (!info || messages.length > 0) return;
    const welcome = info.welcome || site?.assistant.welcome;
    if (!welcome) return;
    setMessages([{ id: 'welcome', role: 'assistant', content: welcome, reply: welcomeReply(welcome, info) }]);
  }, [info, messages.length, site?.assistant.welcome]);

  useEffect(() => {
    const node = scrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [messages, draft]);

  const send = useCallback(async (text: string) => {
    const content = text.trim();
    if (!content || loading) return;
    setInput('');
    setMessages((prev) => [...prev, { id: nextId(), role: 'user', content }]);
    setLoading(true);
    try {
      const history = messages
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .slice(-8)
        .map((m) => ({ role: m.role, content: m.content }));
      const res = await api.post<{ data: AssistantReply }>('/api/assistant/chat', { message: content, history });
      pushAssistant(res.data.reply || '…', res.data);
      if (res.data.draft) setDraft(res.data.draft);
    } catch (err) {
      setMessages((prev) => [...prev, {
        id: nextId(), role: 'assistant', error: true,
        content: err instanceof ApiFailure ? err.message : 'ارتباط با دستیار برقرار نشد. دوباره تلاش کنید.',
      }]);
    } finally {
      setLoading(false);
    }
  }, [loading, messages, nextId, pushAssistant]);

  const runAction = useCallback(async (action: AssistantAction) => {
    switch (action.kind) {
      case 'send':
        return send(action.message ?? action.label);
      case 'link': {
        const target = action.route ?? action.href;
        if (!target) return;
        if (/^https?:\/\//.test(target)) window.location.assign(target);
        else navigate(target);
        return;
      }
      case 'login':
        return navigate(`/login?next=${encodeURIComponent(action.route ?? '/assistant')}`);
      case 'register':
        return navigate(`/register?next=${encodeURIComponent(action.route ?? '/assistant')}`);
      case 'upload':
        return navigate(action.route ?? (draft?.requestId ? `/app/requests/${draft.requestId}` : '/app/documents'));
      case 'confirm': {
        if (!draft) return;
        setBusy(true);
        try {
          const res = await api.post<{ data: { draft: AssistantDraft | null } }>('/api/assistant/draft/preview', {});
          if (res.data.draft) {
            setDraft(res.data.draft);
            if (res.data.draft.stage === 'awaiting_confirmation') {
              // The preview is complete: show it and require the explicit button.
              pushAssistant(
                'پیش‌نمایش کامل شد. اگر همهٔ اطلاعات درست است، دکمهٔ «تأیید و ثبت نهایی» را بزنید.',
                previewReply(res.data.draft),
              );
            } else {
              pushAssistant('چند مورد هنوز ناقص است. آن‌ها را کامل کنید و دوباره پیش‌نمایش بگیرید.', previewReply(res.data.draft));
            }
          }
        } catch (err) {
          notify(err instanceof ApiFailure ? err.message : 'پیش‌نمایش انجام نشد', 'error');
        } finally {
          setBusy(false);
        }
        return;
      }
      case 'cancel': {
        if (!draft) return;
        setBusy(true);
        try {
          const res = await api.post<{ data: AssistantReply }>('/api/assistant/draft/cancel', {});
          setDraft(null);
          setRestored(false);
          pushAssistant(res.data.reply || 'پیش‌نویس لغو شد.', res.data);
        } catch (err) {
          notify(err instanceof ApiFailure ? err.message : 'لغو پیش‌نویس انجام نشد', 'error');
        } finally {
          setBusy(false);
        }
        return;
      }
      case 'edit':
        return;
      default:
        return;
    }
  }, [draft, navigate, notify, pushAssistant, send]);

  /** The explicit, final confirmation — the only path that creates a request. */
  const confirmDraft = useCallback(async () => {
    if (!draft) return;
    setBusy(true);
    try {
      const res = await api.post<{ data: AssistantReply }>('/api/assistant/draft/confirm', { confirm: true });
      setDraft(res.data.draft ?? null);
      setRestored(false);
      pushAssistant(res.data.reply || 'درخواست ثبت شد.', res.data);
      notify('درخواست شما ثبت شد', 'success');
    } catch (err) {
      notify(err instanceof ApiFailure ? err.message : 'ثبت درخواست انجام نشد', 'error');
    } finally {
      setBusy(false);
    }
  }, [draft, notify, pushAssistant]);

  const startService = useCallback(async (service: AssistantServiceCard) => {
    if (!user || user.kind !== 'customer') {
      navigate(`/login?next=${encodeURIComponent('/assistant')}`);
      notify('برای ثبت درخواست ابتدا وارد شوید', 'info');
      return;
    }
    setBusy(true);
    try {
      const res = await api.post<{ data: { draft: AssistantDraft } }>('/api/assistant/draft', {
        serviceSlug: service.slug, useProfile: Boolean(info?.capabilities.profileAutofill),
      });
      setDraft(res.data.draft);
      setRestored(false);
      pushAssistant(`بیایید درخواست «${service.title}» را با هم کامل کنیم. فیلدهای زیر را پر کنید و سپس پیش‌نمایش را ببینید.`, {
        ...emptyReply(),
        reply: '', intent: 'start_request', draft: res.data.draft, actions: res.data.draft.actions,
      });
    } catch (err) {
      notify(err instanceof ApiFailure ? err.message : 'شروع درخواست انجام نشد', 'error');
    } finally {
      setBusy(false);
    }
  }, [info?.capabilities.profileAutofill, navigate, notify, pushAssistant, user]);

  const quickActions = useMemo(() => {
    if (!showQuickActions) return [];
    return QUICK_ACTIONS.filter((item) => user || item.label !== 'وضعیت پرونده‌های من');
  }, [showQuickActions, user]);

  const guest = !user || user.kind !== 'customer';
  const canSubmit = Boolean(info?.capabilities.requestSubmission) || guest;
  const activeDraft = draft && draft.stage !== 'submitted' ? draft : null;
  const awaitingConfirmation = draft?.stage === 'awaiting_confirmation';

  return (
    <PublicLayout>
      <div className="mx-auto flex h-dvh max-w-3xl flex-col px-4 pb-4 pt-6 sm:px-6">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-2 text-lg font-bold text-navy-900 dark:text-navy-50">
              <Sparkles className="size-5 text-accent" />
              {info?.name || site?.assistant.name || 'دستیار هوشمند'}
            </h1>
            <p className="mt-0.5 text-[11px] leading-5 text-navy-500">{info?.disclaimer || site?.assistant.disclaimer}</p>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <Badge tone={guest ? 'default' : 'success'}>
              {guest ? 'حالت مهمان' : <><ShieldCheck className="size-3" /> حساب خودم</>}
            </Badge>
          </div>
        </div>

        <div className="card flex min-h-0 flex-1 flex-col overflow-hidden">
          <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto p-4 scrollbar-thin sm:p-5">
            {!enabled && (
              <div className="rounded-2xl bg-amber-50 p-3 text-xs text-amber-900 ring-1 ring-amber-200 dark:bg-amber-500/10 dark:text-amber-200 dark:ring-amber-500/30">
                دستیار هوشمند فعلاً توسط مدیر سامانه غیرفعال شده است.
              </div>
            )}

            {restored && activeDraft && (
              <div className="rounded-2xl border border-dashed border-line-strong bg-surface-2 p-3 text-[11px] leading-5 text-navy-600 dark:text-navy-300">
                یک پیش‌نویس نیمه‌کاره پیدا شد. می‌توانید همان را ادامه دهید یا لغو کنید.
              </div>
            )}

            {messages.map((message) => (
              <div key={message.id} className={clsx('flex', message.role === 'user' ? 'justify-start' : 'justify-end')}>
                <div className={clsx('max-w-[92%] rounded-2xl px-3.5 py-2.5 text-[13px] leading-6 sm:max-w-[85%]',
                  message.role === 'user'
                    ? 'bg-brand-700 text-white dark:bg-brand-600'
                    : message.error
                      ? 'bg-rose-50 text-rose-800 ring-1 ring-rose-200 dark:bg-rose-500/10 dark:text-rose-200 dark:ring-rose-500/30'
                      : 'bg-surface-3 text-navy-800 dark:bg-navy-900/70 dark:text-navy-100')}>
                  {message.content && <p className="whitespace-pre-wrap">{message.content}</p>}
                  {message.reply?.draft?.stage === 'submitted' && (
                    <SubmittedDraftCard draft={message.reply.draft} />
                  )}
                  {message.reply?.cards?.map((card, index) => (
                    <AssistantCardView key={`${card.type}-${index}`} card={card} onAction={runAction} onRequest={canSubmit ? startService : undefined} />
                  ))}
                  {message.reply?.suggestions?.length ? (
                    <div className="space-y-1">
                      {message.reply.suggestions.map((service) => (
                        <ServiceCardView key={service.id} service={service} onRequest={canSubmit ? startService : undefined} />
                      ))}
                    </div>
                  ) : null}
                  {message.reply?.followUpQuestions?.length ? (
                    <div className="mt-2 flex flex-wrap gap-1.5 border-t border-line pt-2">
                      {message.reply.followUpQuestions.map((question) => (
                        <button key={question} type="button" onClick={() => send(question)}
                          className="rounded-full bg-surface px-2.5 py-1 text-[10px] text-navy-600 ring-1 ring-line hover:bg-brand-50 dark:text-navy-300">
                          {question}
                        </button>
                      ))}
                    </div>
                  ) : null}
                  {message.reply?.actions?.length ? (
                    <ActionButtons actions={message.reply.actions} onAction={runAction} disabled={busy} />
                  ) : null}
                  {message.reply?.handoffSuggested && (
                    <p className="mt-2 border-t border-line pt-2 text-[10px] text-navy-500">
                      برای بررسی دقیق‌تر می‌توانید به کارشناس بگویید: <Link to="/app/support" className="text-accent hover:underline">تیکت پشتیبانی</Link>
                    </p>
                  )}
                </div>
              </div>
            ))}

            {loading && (
              <div className="flex justify-end">
                <div className="flex items-center gap-2 rounded-2xl bg-surface-3 px-3.5 py-2 text-[11px] text-navy-500 dark:bg-navy-900/70">
                  <Loader2 className="size-3.5 animate-spin" /> دستیار در حال بررسی…
                </div>
              </div>
            )}
          </div>

          {activeDraft && (
            <div className="max-h-[55dvh] overflow-y-auto border-t border-line p-3 scrollbar-thin sm:p-4">
              <DraftPanel draft={activeDraft} onChange={setDraft} onAction={runAction} busy={busy} />
              {awaitingConfirmation && (
                <div className="mt-3 flex flex-wrap items-center gap-2 rounded-2xl bg-emerald-50 p-3 ring-1 ring-emerald-200 dark:bg-emerald-500/10 dark:ring-emerald-500/30">
                  <div className="min-w-0 flex-1 text-[11px] leading-5 text-emerald-900 dark:text-emerald-200">
                    پیش‌نمایش کامل است. با زدن دکمهٔ زیر، درخواست واقعی ثبت می‌شود و کد پیگیری می‌گیرید.
                  </div>
                  <Button size="sm" loading={busy} disabled={busy} onClick={confirmDraft}>
                    <CheckCircle2 className="size-3.5" /> تأیید و ثبت نهایی
                  </Button>
                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => runAction({ id: 'cancel-final', kind: 'cancel', label: 'انصراف' })}>
                    انصراف
                  </Button>
                </div>
              )}
            </div>
          )}

          <div className="border-t border-line p-3">
            <div className="flex gap-2">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input); } }}
                placeholder="سؤال خود را بنویسید…"
                className="input"
                aria-label="پیام"
                disabled={!enabled}
              />
              <Button onClick={() => send(input)} loading={loading} disabled={!enabled || !input.trim()} icon={<ArrowRight className="size-4 rotate-180" />}>
                <span className="hidden sm:inline">ارسال</span>
              </Button>
            </div>
            {quickActions.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {quickActions.map((item) => (
                  <button key={item.label} type="button" onClick={() => send(item.message)}
                    className="rounded-full bg-surface-3 px-2.5 py-1 text-[10px] text-navy-600 hover:bg-brand-50 dark:text-navy-300">
                    {item.label}
                  </button>
                ))}
              </div>
            )}
            {guest && (
              <p className="mt-2 text-[10px] leading-4 text-navy-400">
                برای پاسخ شخصی (پرونده‌ها، فاکتورها، کیف پول) <Link to="/login?next=%2Fassistant" className="text-accent hover:underline">وارد شوید</Link> یا <Link to="/register?next=%2Fassistant" className="text-accent hover:underline">ثبت‌نام کنید</Link>.
              </p>
            )}
            <p className="mt-1 flex items-center gap-1 text-[9px] text-navy-400">
              <Bot className="size-3" /> پاسخ‌ها بر پایهٔ کاتالوگ زندهٔ خدمات است؛ نرخ یا شرطی که در سامانه نیست حدس زده نمی‌شود.
            </p>
          </div>
        </div>
      </div>
    </PublicLayout>
  );
}

function emptyInfo(site: { assistant: { name: string; welcome: string; disclaimer: string } } | null): AssistantInfo {
  return {
    enabled: true,
    name: site?.assistant.name ?? 'دستیار هوشمند',
    welcome: site?.assistant.welcome ?? '',
    disclaimer: site?.assistant.disclaimer ?? '',
    catalogOnly: true,
    capabilities: { accountAccess: false, requestSubmission: true, profileAutofill: false, tools: false },
    authenticated: false,
    draft: null,
  };
}

function emptyReply(): AssistantReply {
  return {
    reply: '', suggestions: [], followUpQuestions: [], actions: [], cards: [], draft: null,
    intent: 'unknown', sources: [], provider: 'builtin', handoffSuggested: false, disclaimer: '',
    authenticated: false, usedPersonalContext: false, toolsUsed: [], at: new Date().toISOString(),
  };
}

function welcomeReply(welcome: string, info: AssistantInfo | null): AssistantReply {
  return { ...emptyReply(), reply: welcome, intent: 'greeting', disclaimer: info?.disclaimer ?? '' };
}

function previewReply(draft: AssistantDraft): AssistantReply {
  return {
    ...emptyReply(),
    intent: 'preview_request',
    draft,
    actions: draft.actions,
    provider: 'builtin',
  };
}
