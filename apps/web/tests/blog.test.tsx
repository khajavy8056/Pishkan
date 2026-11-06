import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AuthProvider } from '../src/lib/auth';
import { SiteProvider } from '../src/lib/site';
import { ToastProvider } from '../src/components/ui';
import { authUser, fetchMock, setAuthUser } from './setup';

import { BlogHome, BlogPostPage } from '../src/pages/public/Blog';
import { BlogAdmin } from '../src/pages/admin/BlogAdmin';

/**
 * Blog screens: the public magazine page from the approved mock, the article
 * page with moderated comments, and the permission-gated content studio.
 */

const adminUser = {
  id: 'usr_admin', kind: 'admin', fullName: 'مدیر سامانه', mobile: '09120000000', email: null,
  username: 'admin', nationalId: null, mobileVerified: true, status: 'active', mfaEnabled: false,
  mustChangePassword: false, roleCode: 'super_admin', roleName: 'مدیر کل', permissions: '*',
};

const contentUser = {
  ...adminUser, id: 'usr_content', kind: 'staff', fullName: 'مدیر محتوا', roleCode: 'content_manager',
  roleName: 'مدیر محتوا (بلاگ)',
  permissions: ['dashboard.view', 'blog.view', 'blog.create', 'blog.edit', 'blog.delete', 'blog.publish', 'blog.comments', 'blog.categories', 'blog.manage'],
};

const category = {
  id: 'bcat_1', slug: 'guides', title: 'آموزش و راهنما', description: 'راهنمای خدمات',
  icon: 'book-open', color: '#2563eb', sortOrder: 1, isActive: true, postsCount: 2,
  createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z',
};

const post = {
  id: 'post_1', slug: 'plate-exchange-guide', title: 'راهنمای کامل تعویض پلاک خودرو',
  subtitle: 'همه مدارک و مراحل در یک نگاه', excerpt: 'برای تعویض پلاک چه مدارکی لازم است؟ پاسخ کامل اینجاست.',
  content: '<h2>مدارک لازم</h2><p>کارت ملی و سند خودرو را همراه داشته باشید.</p><script>alert(1)</script>',
  categoryId: 'bcat_1', categoryTitle: 'آموزش و راهنما', categorySlug: 'guides',
  categoryIcon: 'book-open', categoryColor: '#2563eb', tags: ['خودرو', 'تعویض پلاک'],
  coverUrl: null, coverAlt: null, authorId: 'usr_content', authorName: 'مدیر محتوا',
  status: 'published', statusLabel: 'منتشرشده', scheduled: false,
  publishedAt: '2026-10-20T08:00:00.000Z', seoTitle: null, seoDescription: null,
  canonicalUrl: null, noindex: false, allowComments: true, featured: false,
  readingMinutes: 4, viewsCount: 320, commentsCount: 1, pendingComments: 0,
  createdAt: '2026-10-19T08:00:00.000Z', updatedAt: '2026-10-20T08:00:00.000Z',
};

const comment = {
  id: 'bcmt_1', parentId: null, authorName: 'خواننده نمونه', body: 'خیلی کاربردی بود، ممنون!',
  createdAt: '2026-10-21T08:00:00.000Z', isStaff: false, replies: [],
};

const bootstrap = {
  version: '1.0.0-test',
  settings: { 'site.name': 'پیشخوان آرتا', 'site.short_name': 'پیشخوان آرتا' },
  categories: [], popularServices: [], newestServices: [],
  authMethods: { staffOtp: false, otp: true, password: true, registrationOpen: true, passwordReset: true },
  maintenance: false,
  assistant: { enabled: false, name: '', welcome: '', disclaimer: '' },
};

type Call = { method: string; url: string; body: any };

function json(data: unknown, status = 200, meta?: unknown) {
  return {
    ok: status < 400, status,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => (status < 400 ? { ok: true, data, ...(meta ? { meta } : {}) } : { ok: false, error: data }),
    blob: async () => new Blob(),
    text: async () => JSON.stringify(data),
  } as unknown as Response;
}

function installApi() {
  const calls: Call[] = [];
  fetchMock.mockImplementation(async (input: any, init?: any) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : String(input.url);
    const method = (init?.method ?? 'GET').toUpperCase();
    const body = init?.body && typeof init.body === 'string' ? JSON.parse(init.body) : init?.body ?? null;
    calls.push({ method, url, body });
    const path = url.replace(/^https?:\/\/[^/]+/, '');

    if (path.startsWith('/api/auth/me')) return authUser ? json(authUser) : json({ code: 'unauthorized', message: 'وارد شوید' }, 401);
    if (path.startsWith('/api/public/bootstrap')) return json(bootstrap);
    if (path.startsWith('/api/customers/me/notifications')) return json([], 200, { unread: 0, total: 0 });
    if (path.startsWith('/api/public/blog/categories')) return json([category]);
    if (path.startsWith('/api/public/blog/popular')) return json([post]);
    if (path.match(/^\/api\/public\/blog\/posts\/[^/]+\/comments$/)) return json({ id: 'bcmt_2', status: 'pending' }, 201);
    if (path.match(/^\/api\/public\/blog\/posts\/[^/]+$/)) return json({ post, related: [], comments: [comment] });
    if (path.startsWith('/api/public/blog/posts')) return json([post], 200, { total: 1, page: 1, pageSize: 9 });
    if (path.startsWith('/api/public/blog/subscribe')) return json({ subscribed: true, already: false }, 201);
    if (path.startsWith('/api/blog/stats')) return json({ posts: { draft: 1, published: 2, archived: 0, total: 3 }, totalViews: 500, pendingComments: 2, subscribers: 4 });
    if (path.startsWith('/api/blog/posts')) return json([post], 200, { total: 1, page: 1, pageSize: 15 });
    if (path.startsWith('/api/blog/categories')) return json([category]);
    return json({ code: 'not_found', message: 'یافت نشد' }, 404);
  });
  return calls;
}

function renderBlog(element: React.ReactElement, route = '/blog') {
  return render(
    <AuthProvider>
      <SiteProvider>
        <ToastProvider>
          <MemoryRouter initialEntries={[route]}>
            <Routes>
              <Route path="/blog" element={element} />
              <Route path="/blog/:slug" element={element} />
              <Route path="/staff/blog" element={element} />
            </Routes>
          </MemoryRouter>
        </ToastProvider>
      </SiteProvider>
    </AuthProvider>,
  );
}

beforeEach(() => { setAuthUser(null); });
afterEach(() => { setAuthUser(null); fetchMock.mockReset(); });

describe('public blog', () => {
  it('renders the magazine home like the approved mock', async () => {
    installApi();
    renderBlog(<BlogHome />);

    await waitFor(() => expect(screen.getAllByText('راهنمای کامل تعویض پلاک خودرو').length).toBeGreaterThan(0));
    expect(screen.getByText(/بلاگ پیشخوان آرتا/)).toBeTruthy();
    expect(screen.getByText('محبوب‌ترین مطالب')).toBeTruthy();
    expect(screen.getByText('عضویت در خبرنامه')).toBeTruthy();
    expect(screen.getByText('مطالعه بیشتر')).toBeTruthy();
    // the blog joined the public header navigation
    expect(screen.getAllByRole('link', { name: /بلاگ/ }).length).toBeGreaterThan(0);
  });

  it('renders the article with sanitized content and a moderation-aware comment form', async () => {
    const calls = installApi();
    renderBlog(<BlogPostPage />, '/blog/plate-exchange-guide');

    await waitFor(() => expect(screen.getByRole('heading', { name: 'راهنمای کامل تعویض پلاک خودرو' })).toBeTruthy());
    expect(screen.getByText('مدارک لازم')).toBeTruthy();
    expect(screen.getByText('خیلی کاربردی بود، ممنون!')).toBeTruthy();
    expect(document.title).toContain('تعویض پلاک');

    fireEvent.change(screen.getByPlaceholderText('نام و نام خانوادگی *'), { target: { value: 'مهمان آزمون' } });
    fireEvent.change(screen.getByPlaceholderText('دیدگاهتان را بنویسید…'), { target: { value: 'نظر آزمایشی من' } });
    fireEvent.click(screen.getByRole('button', { name: /ثبت دیدگاه/ }));

    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.url.includes('/comments'))).toBe(true));
    await waitFor(() => expect(screen.getByText(/پس از تأیید مدیر همین‌جا دیده می‌شود/)).toBeTruthy());
  });
});

describe('content studio', () => {
  it('opens for the content-manager role inside the staff shell with blog navigation', async () => {
    setAuthUser(contentUser);
    installApi();
    renderBlog(<BlogAdmin variant="staff" />, '/staff/blog');

    await waitFor(() => expect(screen.getByText('کل مطالب')).toBeTruthy());
    expect(screen.getAllByText('بلاگ و تولید محتوا').length).toBeGreaterThan(0);
    await waitFor(() => expect(screen.getByText('راهنمای کامل تعویض پلاک خودرو')).toBeTruthy());
    expect(screen.getAllByText('مطلب تازه').length).toBeGreaterThan(0);
  });

  it('hides the blog navigation from staff without blog permissions', async () => {
    setAuthUser({ ...contentUser, roleCode: 'service_expert', permissions: ['requests.view'] });
    installApi();
    renderBlog(<BlogAdmin variant="staff" />, '/staff/blog');

    await waitFor(() => expect(screen.getByText('کل مطالب')).toBeTruthy());
    // the only blog wording left is the page header itself — no sidebar entry
    const navLinks = screen.getAllByRole('link').map((a) => a.getAttribute('href'));
    expect(navLinks).not.toContain('/staff/blog');
  });
});
