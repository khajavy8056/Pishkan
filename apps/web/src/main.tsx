import { AutomationInbox } from './pages/shared/Automation';
import { CompensationPage } from './pages/shared/Compensation';
import { EligibleQueue } from './pages/staff/Queue';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth, homeFor } from './lib/auth';
import { SiteProvider } from './lib/site';
import { ToastProvider } from './components/ui';
import { ThemeProvider } from './lib/theme';
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
import { CustomerDocuments } from './pages/customer/Documents';
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
const staffOnly = (node: ReactNode,permission?:string) => <RequireRole kinds={['staff', 'admin']} permission={permission}>{node}</RequireRole>;
const financial = (node:ReactNode,permission:string)=><RequireRole kinds={['staff','admin']} permission={permission} office>{node}</RequireRole>;
const adminOnly = (node: ReactNode,permission?:string) => <RequireRole kinds={['admin']} permission={permission}>{node}</RequireRole>;

function PanelEntry() {
  const { user, loading } = useAuth();
  if (loading) return <div className="grid min-h-dvh place-items-center text-sm text-navy-500">در حال بررسی دسترسی…</div>;
  return <Navigate to={homeFor(user)} replace />;
}

function ScrollToTop() {
  const { pathname } = useLocation();
  // Reset scroll position on navigation (RTL pages can otherwise keep the old offset).
  if (typeof window !== 'undefined') window.scrollTo({ top: 0 });
  void pathname;
  return null;
}

function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <SiteProvider>
        <ToastProvider>
          <BrowserRouter>
            <ScrollToTop />
            <Routes>
              {/* public */}
              <Route path="/" element={<HomePage />} />
              <Route path="/panel" element={<PanelEntry />} />
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
              <Route path="/app/documents" element={customer(<CustomerDocuments />)} />
              <Route path="/app/messages" element={customer(<CustomerMessages />)} />
              <Route path="/app/profile" element={customer(<CustomerProfile />)} />

              {/* staff */}
              <Route path="/staff" element={staffOnly(<StaffWorkbench />)} />
              <Route path="/staff/requests" element={staffOnly(<StaffRequests />,'requests.view')} />
              <Route path="/staff/requests/:id" element={staffOnly(<RequestDetail />,'requests.view')} />
              <Route path="/staff/documents" element={staffOnly(<StaffDocuments />,'documents.view')} />
              <Route path="/staff/customers" element={staffOnly(<StaffCustomers />,'customers.view')} />
              <Route path="/staff/custom-services" element={staffOnly(<StaffCustomService />,'services.create')} />
              <Route path="/staff/messages" element={staffOnly(<MessageCenter variant="staff" />)} />
              <Route path="/staff/shifts" element={staffOnly(<StaffShifts />)} />
              <Route path="/staff/queue" element={staffOnly(<EligibleQueue />,'requests.edit')} />
              <Route path="/staff/accounting" element={financial(<AdminFinance />,'invoices.view')} />
              <Route path="/staff/reports" element={financial(<AdminReports />,'reports.view')} />
              <Route path="/staff/payroll" element={financial(<CompensationPage admin />,'payments.approve')} />
              <Route path="/staff/automation" element={staffOnly(<AutomationInbox />,'requests.view')} />
              <Route path="/admin/automation" element={adminOnly(<AutomationInbox variant="admin" />,'requests.view')} />
              <Route path="/staff/finance" element={staffOnly(<StaffFinance />)} />
              <Route path="/staff/performance" element={staffOnly(<StaffPerformance />)} />

              {/* admin */}
              <Route path="/admin" element={adminOnly(<AdminDashboard />)} />
              <Route path="/admin/requests" element={adminOnly(<StaffRequests variant="admin" />)} />
              <Route path="/admin/requests/:id" element={adminOnly(<RequestDetail variant="admin" />)} />
              <Route path="/admin/services" element={adminOnly(<AdminServices />,'services.view')} />
              <Route path="/admin/services/:id" element={adminOnly(<AdminServiceEditor />,'services.edit')} />
              <Route path="/admin/customers" element={adminOnly(<AdminCustomers />,'customers.view')} />
              <Route path="/admin/staff" element={adminOnly(<AdminStaff />,'staff.view')} />
              <Route path="/admin/shifts" element={adminOnly(<AdminShifts />,'shifts.view')} />
              <Route path="/admin/messages" element={adminOnly(<MessageCenter variant="admin" />)} />
              <Route path="/admin/payroll" element={adminOnly(<CompensationPage admin />)} />
              <Route path="/admin/finance" element={adminOnly(<AdminFinance />,'invoices.view')} />
              <Route path="/admin/reports" element={adminOnly(<AdminReports />,'reports.view')} />
              <Route path="/admin/settings" element={adminOnly(<SettingsCenter />,'settings.view')} />
              <Route path="/admin/system" element={adminOnly(<AdminSystem />,'system.view')} />
              <Route path="/admin/audit" element={adminOnly(<AdminAudit />,'audit.view')} />

              {/* legacy/aliases */}
              <Route path="/dashboard" element={<Navigate to="/app" replace />} />
              <Route path="*" element={<NotFoundPage />} />
            </Routes>
          </BrowserRouter>
        </ToastProvider>
        </SiteProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
