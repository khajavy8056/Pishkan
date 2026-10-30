import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Search, ArrowLeft, Clock } from 'lucide-react';
import clsx from 'clsx';
import { AppShell, PageHeader } from '../../components/shell';
import { EmptyState, Loading, Select } from '../../components/ui';
import { api } from '../../lib/api';
import { useSite } from '../../lib/site';
import { faNum, rial } from '../../lib/format';

export function CustomerServices() {
  const { site } = useSite();
  const [services, setServices] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => {
      setLoading(true);
      api.list<any>('/api/public/services', { q: query || undefined, category: category || undefined, pageSize: 60 })
        .then((res) => setServices(res.data))
        .finally(() => setLoading(false));
    }, 250);
    return () => clearTimeout(timer);
  }, [query, category]);

  return (
    <AppShell variant="customer">
      <PageHeader title="خدمات قابل درخواست" description="خدمت مورد نظر را انتخاب کنید تا فرم اختصاصی آن باز شود." />

      <div className="card mb-4 flex flex-col gap-2 p-3 sm:flex-row">
        <div className="flex flex-1 items-center gap-2 rounded-xl bg-surface-3 px-3">
          <Search className="size-4 text-navy-400" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="جست‌وجوی خدمت…" className="w-full bg-transparent py-2 text-sm outline-none" />
        </div>
        <Select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="دسته" className="sm:w-56"
          options={[{ value: '', label: 'همه دسته‌ها' }, ...(site?.categories ?? []).map((c) => ({ value: c.slug, label: c.title }))]} />
      </div>

      {loading && <Loading />}
      {!loading && services.length === 0 && <EmptyState title="خدمتی یافت نشد" description="عبارت دیگری را جست‌وجو کنید." />}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {services.map((service) => (
          <div key={service.id} className="card flex flex-col p-4">
            <div className="flex items-start justify-between gap-2">
              <span className="badge bg-brand-50 text-accent">{service.categoryTitle ?? 'خدمت'}</span>
              {!service.acceptingRequests && <span className="badge bg-amber-50 text-amber-800">غیرفعال</span>}
            </div>
            <p className="mt-2 font-semibold text-navy-900">{service.title}</p>
            <p className="mt-1 line-clamp-2 flex-1 text-xs leading-6 text-navy-500">{service.summary}</p>
            <div className="mt-3 flex items-center justify-between border-t border-navy-900/5 pt-2 text-[11px]">
              <span className="flex items-center gap-1 text-navy-500"><Clock className="size-3.5" /> {faNum(service.estimatedDays)} روز</span>
              <span className="font-semibold text-navy-900">{rial(service.finalFee)}</span>
            </div>
            <Link to={`/services/${service.slug}`}
              className={clsx('btn-sm mt-3 w-full', service.acceptingRequests ? 'btn-primary' : 'btn-ghost pointer-events-none opacity-60')}>
              {service.acceptingRequests ? 'ثبت درخواست' : 'موقتاً غیرفعال'}
              <ArrowLeft className="size-3.5" />
            </Link>
          </div>
        ))}
      </div>
    </AppShell>
  );
}
