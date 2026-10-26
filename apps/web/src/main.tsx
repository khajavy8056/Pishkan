import { CompensationPage } from './pages/shared/Compensation';
import { EligibleQueue } from './pages/staff/Queue';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AuthProvider } from './lib/auth';
import { SiteProvider } from './lib/site';
import { ToastProvider } from './components/ui';
import { RequireRole } from './components/shell';
import type { ReactNode } from 'react';

import { HomePage } from './pages/public/Home';
import { ServiceDetailPage, ServicesPage } from './pages/public/Services';
import {
  AssistantPage, LegalPage, LoginPage, NotFoundPage, RegisterPage, ResetPasswordPage, StatusPage,
} from './pages/public/Auth';
import {
  CustomerDashboard, CustomerInvoices, CustomerMessages, CustomerOffers, CustomerProfile,
  CustomerRequestDetail, CustomerRequests,
} from './pages/customer/CustomerPages';
import { CustomerServices } from './pages/customer/ServicesPane';
import {
  RequestDetail, StaffCustomers, StaffCustomService, StaffDocuments, StaffFinance,
  StaffPerformance, StaffRequests, StaffShifts, StaffWorkbench,
} from './pages/staff/StaffPages';
import { MessageCenter } from './pages/shared/MessageCenter';
import { AdminDashboard } from './pages/admin/AdminDashboard';
import { AdminServiceEditor, AdminServices } from './pages/admin/CatalogAdmin';
import { AdminCustomers, AdminStaff } from './pages/admin/PeopleAdmin';
import { AdminFinance, AdminReports } from './pages/admin/FinanceAdmin';
import { AdminAudit, AdminShifts, AdminSystem } from './pages/admin/Operations';
import { SettingsCenter } from './pages/admin/SettingsCenter';

import './styles.css';

const customer = (node: ReactNode) => <RequireRole kinds={['customer']}>{node}</RequireRole>;
const staffOnly = (node: ReactNode) => <RequireRole kinds={['staff', 'admin']}>{node}</RequireRole>;
const adminOnly = (node: ReactNode) => <RequireRole kinds={['admin']}>{node}</RequireRole>;

function ScrollToTop() {
  const { pathname } = useLocation();
  // Reset scroll position on navigation (RTL pages can otherwise keep the old offset).
  if (typeof window !== 'undefined') window.scrollTo({ top: 0 });
  void pathname;
  return null;
}

function App() {
  return (
    <AuthProvider>
      <SiteProvider>
        <ToastProvider>
          <BrowserRouter>
            <ScrollToTop />
            <Routes>
              {/* public */}
              <Route path="/" element={<HomePage />} />
              <Route path="/services" element={<ServicesPage />} />
              <Route path="/services/:slug" element={<ServiceDetailPage />} />
              <Route path="/assistant" element={<AssistantPage />} />
              <Route path="/status" element={<StatusPage />} />
              <Route path="/legal" element={<LegalPage />} />
              <Route path="/login" element={<LoginPage />} />
              <Route path="/register" element={<RegisterPage />} />
              <Route path="/reset-password" element={<ResetPasswordPage />} />

              {/* customer */}
              <Route path="/app" element={customer(<CustomerDashboard />)} />
              <Route path="/app/services" element={customer(<CustomerServices />)} />
              <Route path="/app/requests" element={customer(<CustomerRequests />)} />
              <Route path="/app/requests/:id" element={customer(<CustomerRequestDetail />)} />
              <Route path="/app/invoices" element={customer(<CustomerInvoices />)} />
              <Route path="/app/offers" element={customer(<CustomerOffers />)} />
              <Route path="/app/messages" element={customer(<CustomerMessages />)} />
              <Route path="/app/profile" element={customer(<CustomerProfile />)} />

              {/* staff */}
              <Route path="/staff" element={staffOnly(<StaffWorkbench />)} />
              <Route path="/staff/requests" element={staffOnly(<StaffRequests />)} />
              <Route path="/staff/requests/:id" element={staffOnly(<RequestDetail />)} />
              <Route path="/staff/documents" element={staffOnly(<StaffDocuments />)} />
              <Route path="/staff/customers" element={staffOnly(<StaffCustomers />)} />
              <Route path="/staff/custom-services" element={staffOnly(<StaffCustomService />)} />
              <Route path="/staff/messages" element={staffOnly(<MessageCenter variant="staff" />)} />
              <Route path="/staff/shifts" element={staffOnly(<StaffShifts />)} />
              <Route path="/staff/queue" element={staffOnly(<EligibleQueue />)} />
              <Route path="/staff/finance" element={staffOnly(<StaffFinance />)} />
              <Route path="/staff/performance" element={staffOnly(<StaffPerformance />)} />

              {/* admin */}
              <Route path="/admin" element={adminOnly(<AdminDashboard />)} />
              <Route path="/admin/requests" element={adminOnly(<StaffRequests variant="admin" />)} />
              <Route path="/admin/requests/:id" element={adminOnly(<RequestDetail variant="admin" />)} />
              <Route path="/admin/services" element={adminOnly(<AdminServices />)} />
              <Route path="/admin/services/:id" element={adminOnly(<AdminServiceEditor />)} />
              <Route path="/admin/customers" element={adminOnly(<AdminCustomers />)} />
              <Route path="/admin/staff" element={adminOnly(<AdminStaff />)} />
              <Route path="/admin/shifts" element={adminOnly(<AdminShifts />)} />
              <Route path="/admin/messages" element={adminOnly(<MessageCenter variant="admin" />)} />
              <Route path="/admin/payroll" element={adminOnly(<CompensationPage admin />)} />
              <Route path="/admin/finance" element={adminOnly(<AdminFinance />)} />
              <Route path="/admin/reports" element={adminOnly(<AdminReports />)} />
              <Route path="/admin/settings" element={adminOnly(<SettingsCenter />)} />
              <Route path="/admin/system" element={adminOnly(<AdminSystem />)} />
              <Route path="/admin/audit" element={adminOnly(<AdminAudit />)} />

              {/* legacy/aliases */}
              <Route path="/dashboard" element={<Navigate to="/app" replace />} />
              <Route path="*" element={<NotFoundPage />} />
            </Routes>
          </BrowserRouter>
        </ToastProvider>
      </SiteProvider>
    </AuthProvider>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
