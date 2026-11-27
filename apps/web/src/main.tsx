import { StrictMode, lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth, homeFor } from './lib/auth';
import { SiteProvider } from './lib/site';
import { ToastProvider } from './components/ui';
import { ThemeProvider } from './lib/theme';
import { RequireRole } from './components/shell';
import { ScrollTopButton } from './components/ScrollTopButton';
import type { ReactNode } from 'react';

import { HomePage } from './pages/public/Home';
import { ServiceDetailPage, ServicesPage } from './pages/public/Services';
import {
  LegalPage, LoginPage, NotFoundPage, RegisterPage, ResetPasswordPage, StaffLoginPage, StatusPage, VerifyEmailPage,
} from './pages/public/Auth';
import { AssistantPage } from './pages/public/Assistant';
import { BlogHome, BlogPostPage } from './pages/public/Blog';


/*
 * Code splitting.
 *
 * Every page used to be imported statically, so a visitor who only wanted the
 * landing page downloaded the whole product — admin panels, the staff
 * workbench, the message centre — roughly 950 KB of page source, none of which
 * they can even open without signing in. The public pages stay eager (they are
 * one click from the landing page and are part of the first impression), and
 * the authenticated app behind /app, /staff and /admin loads on demand.
 *
 * `lazy` needs a default export, and these modules export named ones, so each
 * is a one-line re-map. Keeping the static `import type`-free shape means a
 * typo fails at build time rather than silently at runtime.
 */
const lazyPage = <T extends Record<string, any>>(loader: () => Promise<T>, name: keyof T) =>
  lazy(() => loader().then((module) => ({ default: module[name] as React.ComponentType<any> })));

const CustomerDashboard = lazyPage(() => import('./pages/customer/CustomerPages'), 'CustomerDashboard');
const CustomerInvoices = lazyPage(() => import('./pages/customer/CustomerPages'), 'CustomerInvoices');
const CustomerMessages = lazyPage(() => import('./pages/customer/CustomerPages'), 'CustomerMessages');
const CustomerOffers = lazyPage(() => import('./pages/customer/CustomerPages'), 'CustomerOffers');
const CustomerProfile = lazyPage(() => import('./pages/customer/CustomerPages'), 'CustomerProfile');
const CustomerRequestDetail = lazyPage(() => import('./pages/customer/CustomerPages'), 'CustomerRequestDetail');
const CustomerRequests = lazyPage(() => import('./pages/customer/CustomerPages'), 'CustomerRequests');
const CustomerServices = lazyPage(() => import('./pages/customer/ServicesPane'), 'CustomerServices');
const CustomerWallet = lazyPage(() => import('./pages/customer/Wallet'), 'CustomerWallet');
const CustomerDocuments = lazyPage(() => import('./pages/customer/Documents'), 'CustomerDocuments');
const CustomerReferrals = lazyPage(() => import('./pages/customer/Referrals'), 'CustomerReferrals');
const InviteLanding = lazyPage(() => import('./pages/customer/Referrals'), 'InviteLanding');
const CustomerSupportPage = lazyPage(() => import('./pages/support/Support'), 'CustomerSupportPage');

const RequestDetail = lazyPage(() => import('./pages/staff/StaffPages'), 'RequestDetail');
const StaffCustomers = lazyPage(() => import('./pages/staff/StaffPages'), 'StaffCustomers');
const StaffCustomService = lazyPage(() => import('./pages/staff/StaffPages'), 'StaffCustomService');
const StaffDocuments = lazyPage(() => import('./pages/staff/StaffPages'), 'StaffDocuments');
const StaffPerformance = lazyPage(() => import('./pages/staff/StaffPages'), 'StaffPerformance');
const StaffRequests = lazyPage(() => import('./pages/staff/StaffPages'), 'StaffRequests');
const StaffShifts = lazyPage(() => import('./pages/staff/StaffPages'), 'StaffShifts');
const StaffAccount = lazyPage(() => import('./pages/staff/Account'), 'StaffAccount');
const StaffWorkbench = lazyPage(() => import('./pages/staff/Workbench'), 'StaffWorkbench');
const StaffEarnings = lazyPage(() => import('./pages/staff/Earnings'), 'StaffEarnings');
const EligibleQueue = lazyPage(() => import('./pages/staff/Queue'), 'EligibleQueue');
const StaffSupportPage = lazyPage(() => import('./pages/support/Support'), 'StaffSupportPage');
const MessageCenter = lazyPage(() => import('./pages/shared/MessageCenter'), 'MessageCenter');
const AutomationInbox = lazyPage(() => import('./pages/shared/Automation'), 'AutomationInbox');

const AdminDashboard = lazyPage(() => import('./pages/admin/AdminDashboard'), 'AdminDashboard');
const AdminPayroll = lazyPage(() => import('./pages/admin/PayrollAdmin'), 'AdminPayroll');
const BlogAdmin = lazyPage(() => import('./pages/admin/BlogAdmin'), 'BlogAdmin');
const BlogEditor = lazyPage(() => import('./pages/admin/BlogAdmin'), 'BlogEditor');
const AdminServiceEditor = lazyPage(() => import('./pages/admin/CatalogAdmin'), 'AdminServiceEditor');
const AdminServices = lazyPage(() => import('./pages/admin/CatalogAdmin'), 'AdminServices');
const AdminCustomers = lazyPage(() => import('./pages/admin/PeopleAdmin'), 'AdminCustomers');
const AdminStaff = lazyPage(() => import('./pages/admin/PeopleAdmin'), 'AdminStaff');
const AdminFinance = lazyPage(() => import('./pages/admin/FinanceAdmin'), 'AdminFinance');
const AdminReports = lazyPage(() => import('./pages/admin/FinanceAdmin'), 'AdminReports');
const AdminAudit = lazyPage(() => import('./pages/admin/Operations'), 'AdminAudit');
const AdminShifts = lazyPage(() => import('./pages/admin/Operations'), 'AdminShifts');
const AdminSystem = lazyPage(() => import('./pages/admin/Operations'), 'AdminSystem');
const SettingsCenter = lazyPage(() => import('./pages/admin/SettingsCenter'), 'SettingsCenter');
const AdminWallet = lazyPage(() => import('./pages/admin/WalletAdmin'), 'AdminWallet');
const AdminMonitoring = lazyPage(() => import('./pages/admin/Monitoring'), 'AdminMonitoring');
const AdminGuard = lazyPage(() => import('./pages/admin/Guard'), 'AdminGuard');
const AdminReferrals = lazyPage(() => import('./pages/admin/Referrals'), 'AdminReferrals');
const AdminDiscountsPage = lazyPage(() => import('./pages/admin/Discounts'), 'AdminDiscountsPage');
const AdminAndroidApp = lazyPage(() => import('./pages/admin/AndroidApp'), 'AdminAndroidApp');
const AdminSystemUpdate = lazyPage(() => import('./pages/admin/SystemUpdate'), 'AdminSystemUpdate');
const AdminSupportPage = lazyPage(() => import('./pages/support/Support'), 'AdminSupportPage');

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

/**
 * Shown only while a lazily-imported panel is fetched. The public pages are
 * eager, so a visitor never sees this on the landing page — it appears on the
 * first navigation into the signed-in app, on a slow connection, instead of a
 * blank screen.
 */
function RouteFallback() {
  return (
    <div className="grid min-h-[60vh] place-items-center px-4" role="status" aria-live="polite">
      <div className="w-full max-w-sm space-y-3">
        <div className="mx-auto size-10 animate-spin rounded-full border-[3px] border-line border-t-brand-600" />
        <p className="text-center text-sm text-navy-500">در حال بارگذاری…</p>
      </div>
    </div>
  );
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
            <ScrollTopButton />
            <Suspense fallback={<RouteFallback />}>
            <Routes>
              {/* public */}
              <Route path="/" element={<HomePage />} />
              <Route path="/panel" element={<PanelEntry />} />
              <Route path="/services" element={<ServicesPage />} />
              <Route path="/services/:slug" element={<ServiceDetailPage />} />
              <Route path="/blog" element={<BlogHome />} />
              <Route path="/blog/:slug" element={<BlogPostPage />} />
              <Route path="/assistant" element={<AssistantPage />} />
              <Route path="/status" element={<StatusPage />} />
              <Route path="/legal" element={<LegalPage />} />
              <Route path="/login" element={<LoginPage />} />
              {/* Staff/admin door — intentionally not linked from any public page. */}
              <Route path="/login-admin" element={<StaffLoginPage />} />
              <Route path="/register" element={<RegisterPage />} />
              <Route path="/invite/:token" element={<InviteLanding />} />
              <Route path="/reset-password" element={<ResetPasswordPage />} />
              <Route path="/verify-email" element={<VerifyEmailPage />} />

              {/* customer */}
              <Route path="/app" element={customer(<CustomerDashboard />)} />
              <Route path="/app/services" element={customer(<CustomerServices />)} />
              <Route path="/app/services/:slug" element={customer(<ServiceDetailPage variant="app" />)} />
              <Route path="/app/requests" element={customer(<CustomerRequests />)} />
              <Route path="/app/requests/:id" element={customer(<CustomerRequestDetail />)} />
              <Route path="/app/invoices" element={customer(<CustomerInvoices />)} />
              <Route path="/app/wallet" element={customer(<CustomerWallet />)} />
              <Route path="/app/offers" element={customer(<CustomerOffers />)} />
              <Route path="/app/documents" element={customer(<CustomerDocuments />)} />
              <Route path="/app/messages" element={customer(<CustomerMessages />)} />
              {/* A message notice links to the conversation itself, so the
                  router has to be able to open it directly. */}
              <Route path="/app/messages/:threadId" element={customer(<CustomerMessages />)} />
              <Route path="/app/support" element={customer(<CustomerSupportPage />)} />
              <Route path="/app/profile" element={customer(<CustomerProfile />)} />
              <Route path="/app/referrals" element={customer(<CustomerReferrals />)} />

              {/* staff */}
              <Route path="/staff" element={staffOnly(<StaffWorkbench />)} />
              <Route path="/staff/requests" element={staffOnly(<StaffRequests />,'requests.view')} />
              <Route path="/staff/requests/:id" element={staffOnly(<RequestDetail />,'requests.view')} />
              <Route path="/staff/documents" element={staffOnly(<StaffDocuments />,'documents.view')} />
              <Route path="/staff/customers" element={staffOnly(<StaffCustomers />,'customers.view')} />
              <Route path="/staff/custom-services" element={staffOnly(<StaffCustomService />,'services.create')} />
              <Route path="/staff/messages" element={staffOnly(<MessageCenter variant="staff" />)} />
              <Route path="/staff/messages/:threadId" element={staffOnly(<MessageCenter variant="staff" />)} />
              <Route path="/staff/support" element={staffOnly(<StaffSupportPage />,'support.view')} />
              <Route path="/staff/discounts" element={financial(<AdminDiscountsPage variant="staff" />,'discounts.view')} />
              <Route path="/staff/referrals" element={financial(<AdminReferrals variant="staff" />,'discounts.view')} />
              <Route path="/staff/shifts" element={staffOnly(<StaffShifts />)} />
              <Route path="/staff/account" element={staffOnly(<StaffAccount />)} />
              <Route path="/staff/queue" element={staffOnly(<EligibleQueue />,'requests.edit')} />
              <Route path="/staff/accounting" element={financial(<AdminFinance />,'invoices.view')} />
              <Route path="/staff/reports" element={financial(<AdminReports />,'reports.view')} />
              <Route path="/staff/payroll" element={financial(<AdminPayroll />,'payroll.view')} />
              <Route path="/staff/automation" element={staffOnly(<AutomationInbox />,'requests.view')} />
              <Route path="/admin/automation" element={adminOnly(<AutomationInbox variant="admin" />,'requests.view')} />
              <Route path="/staff/finance" element={staffOnly(<StaffEarnings />)} />
              <Route path="/staff/performance" element={staffOnly(<StaffPerformance />)} />
              <Route path="/staff/blog" element={staffOnly(<BlogAdmin variant="staff" />,'blog.view')} />
              <Route path="/staff/blog/new" element={staffOnly(<BlogEditor variant="staff" />,'blog.create')} />
              <Route path="/staff/blog/:id/edit" element={staffOnly(<BlogEditor variant="staff" />,'blog.edit')} />

              {/* admin */}
              <Route path="/admin" element={adminOnly(<AdminDashboard />)} />
              <Route path="/admin/requests" element={adminOnly(<StaffRequests variant="admin" />)} />
              <Route path="/admin/requests/:id" element={adminOnly(<RequestDetail variant="admin" />)} />
              <Route path="/admin/services" element={adminOnly(<AdminServices />,'services.view')} />
              <Route path="/admin/blog" element={adminOnly(<BlogAdmin variant="admin" />,'blog.view')} />
              <Route path="/admin/blog/new" element={adminOnly(<BlogEditor variant="admin" />,'blog.create')} />
              <Route path="/admin/blog/:id/edit" element={adminOnly(<BlogEditor variant="admin" />,'blog.edit')} />
              <Route path="/admin/services/:id" element={adminOnly(<AdminServiceEditor />,'services.edit')} />
              <Route path="/admin/customers" element={adminOnly(<AdminCustomers />,'customers.view')} />
              <Route path="/admin/staff" element={adminOnly(<AdminStaff />,'staff.view')} />
              <Route path="/admin/shifts" element={adminOnly(<AdminShifts />,'shifts.view')} />
              <Route path="/admin/messages" element={adminOnly(<MessageCenter variant="admin" />)} />
              <Route path="/admin/messages/:threadId" element={adminOnly(<MessageCenter variant="admin" />)} />
              <Route path="/admin/support" element={adminOnly(<AdminSupportPage />,'support.view')} />
              <Route path="/admin/discounts" element={adminOnly(<AdminDiscountsPage />,'discounts.view')} />
              <Route path="/admin/referrals" element={adminOnly(<AdminReferrals />,'discounts.view')} />
              <Route path="/admin/payroll" element={adminOnly(<AdminPayroll />,'payroll.view')} />
              <Route path="/admin/finance" element={adminOnly(<AdminFinance />,'invoices.view')} />
              <Route path="/admin/reports" element={adminOnly(<AdminReports />,'reports.view')} />
              <Route path="/admin/wallet" element={adminOnly(<AdminWallet />,'wallet.view')} />
              <Route path="/admin/monitoring" element={adminOnly(<AdminMonitoring />,'monitoring.view')} />
              <Route path="/admin/guard" element={adminOnly(<AdminGuard />,'guard.view')} />
              <Route path="/admin/android-app" element={adminOnly(<AdminAndroidApp />,'app.manage')} />
              <Route path="/admin/update" element={adminOnly(<AdminSystemUpdate />,'system.view')} />
              <Route path="/admin/settings" element={adminOnly(<SettingsCenter />,'settings.view')} />
              <Route path="/admin/system" element={adminOnly(<AdminSystem />,'system.view')} />
              <Route path="/admin/audit" element={adminOnly(<AdminAudit />,'audit.view')} />

              {/* legacy/aliases */}
              <Route path="/dashboard" element={<Navigate to="/app" replace />} />
              <Route path="*" element={<NotFoundPage />} />
            </Routes>
            </Suspense>
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
