import { beforeAll, describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../src/lib/auth';
import { SiteProvider } from '../src/lib/site';
import { ToastProvider } from '../src/components/ui';
import { CustomerDocuments } from '../src/pages/customer/Documents';
import { setAuthUser } from './setup';

function renderDocuments() {
  return render(
    <AuthProvider>
      <SiteProvider>
        <ToastProvider>
          <MemoryRouter initialEntries={['/app/documents']}>
            <CustomerDocuments />
          </MemoryRouter>
        </ToastProvider>
      </SiteProvider>
    </AuthProvider>,
  );
}

describe('customer document centre', () => {
  beforeAll(() => {
    setAuthUser({
      id: 'usr_customer', kind: 'customer', fullName: 'مشتری آزمایشی', roleCode: 'customer',
      permissions: [], profileState: { complete: true, missing: [] },
    });
  });

  it('lists profile documents with optimisation details and validity state', async () => {
    renderDocuments();
    await waitFor(() => expect(screen.getAllByText('مدارک من').length).toBeGreaterThan(0));
    await waitFor(() => expect(screen.getAllByText('کارت ملی').length).toBeGreaterThan(0));
    expect(screen.getByText('بهینه‌سازی شد')).toBeTruthy();
    expect(screen.getByText(/کمتر/)).toBeTruthy();
    expect(screen.getByText('بدون تاریخ انقضا')).toBeTruthy();
    expect(screen.getByText(/Lossless WebP/)).toBeTruthy();
  });

  it('offers upload and reuse actions', async () => {
    renderDocuments();
    await waitFor(() => expect(screen.getByText('افزودن مدرک')).toBeTruthy());
    expect(screen.getAllByText('استفاده در پرونده').length).toBeGreaterThan(0);
    expect(screen.getAllByText('مشاهده').length).toBeGreaterThan(0);
  });
});
