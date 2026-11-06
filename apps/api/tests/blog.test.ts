import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { adminSession, app, createStaff } from './helpers.js';

/**
 * Blog / content studio end-to-end: the seeded content-manager role writes
 * and publishes, readers only see published posts, comments go through
 * moderation, and authorship scope is enforced server-side. Nothing here is
 * stubbed — every assertion reads real API responses over the seeded app.
 */

let server: Awaited<ReturnType<typeof app>>;
let admin: any;
let editor: any; // content_manager (all blog permissions)
let author: any; // custom role: blog author without publish/manage
let plain: any; // service_expert without any blog permission
let categoryId: string;

const cookieOf = (session: any) => session.cookie;

beforeAll(async () => {
  server = await app();
  admin = await adminSession();

  editor = await createStaff('content_manager', { username: 'blog_editor_test', password: 'Expert#12345', fullName: 'مدیر محتوای آزمون' });
  plain = await createStaff('service_expert', { username: 'blog_plain_test', password: 'Expert#12345', fullName: 'کارشناس معمولی آزمون' });

  // A composed author role: write/edit own posts, never publish or moderate.
  const role = await request(server).post('/api/staff/meta/roles').set('Cookie', admin.cookie).send({
    code: 'blog_author_test', name: 'نویسنده بلاگ آزمون',
    permissions: ['dashboard.view', 'blog.view', 'blog.create', 'blog.edit', 'blog.delete'],
  });
  expect([201, 409]).toContain(role.status);
  author = await createStaff('blog_author_test', { username: 'blog_author_user', password: 'Expert#12345', fullName: 'نویسنده آزمون' });

  const cat = await request(server).post('/api/blog/categories').set('Cookie', editor.cookie)
    .send({ title: 'آموزش و راهنما', slug: 'guides', color: '#2563eb', icon: 'book-open' });
  expect(cat.status).toBe(201);
  categoryId = cat.body.data.id;
});

async function createPostAs(session: any, overrides: Record<string, unknown> = {}) {
  const res = await request(server).post('/api/blog/posts').set('Cookie', cookieOf(session)).send({
    title: 'راهنمای کامل تعویض پلاک خودرو',
    subtitle: 'همه مدارک و مراحل',
    content: '<h2>مدارک لازم</h2><p>کارت ملی و سند خودرو را همراه داشته باشید.</p>',
    categoryId,
    tags: ['خودرو', 'تعویض پلاک'],
    ...overrides,
  });
  return res;
}

describe('blog publishing flow', () => {
  it('keeps drafts invisible and publishes with an automatic Persian slug', async () => {
    const created = await createPostAs(editor);
    expect(created.status).toBe(201);
    const post = created.body.data;
    expect(post.status).toBe('draft');
    expect(post.slug).toContain('تعویض-پلاک');
    expect(post.readingMinutes).toBeGreaterThanOrEqual(1);

    const publicList = await request(server).get('/api/public/blog/posts').expect(200);
    expect(publicList.body.data.some((p: any) => p.id === post.id)).toBe(false);
    expect((await request(server).get(`/api/public/blog/posts/${encodeURIComponent(post.slug)}`)).status).toBe(404);

    await request(server).post(`/api/blog/posts/${post.id}/publish`).set('Cookie', editor.cookie).expect(200);

    const after = await request(server).get('/api/public/blog/posts').expect(200);
    expect(after.body.data.some((p: any) => p.id === post.id)).toBe(true);

    const firstRead = await request(server).get(`/api/public/blog/posts/${encodeURIComponent(post.slug)}`).expect(200);
    expect(firstRead.body.data.post.title).toContain('تعویض پلاک');
    expect(firstRead.body.data.post.content).toContain('مدارک لازم');
    const secondRead = await request(server).get(`/api/public/blog/posts/${encodeURIComponent(post.slug)}`).expect(200);
    expect(secondRead.body.data.post.viewsCount).toBeGreaterThan(firstRead.body.data.post.viewsCount);

    // durable handle for the following tests
    (globalThis as any).__blogPost = post;
  });

  it('makes slugs unique and hides scheduled posts until their moment', async () => {
    const future = new Date(Date.now() + 2 * 86_400_000).toISOString();
    const created = await createPostAs(editor, { status: 'published', publishedAt: future });
    expect(created.status).toBe(201);
    expect(created.body.data.slug).toMatch(/-2$/);
    expect(created.body.data.statusLabel).toBe('زمان‌بندی‌شده');

    const publicList = await request(server).get('/api/public/blog/posts').expect(200);
    expect(publicList.body.data.some((p: any) => p.id === created.body.data.id)).toBe(false);
  });

  it('strips scriptable markup server-side', async () => {
    const created = await request(server).post('/api/blog/posts').set('Cookie', editor.cookie).send({
      title: 'مطلب آزمایشی پاک‌سازی',
      content: '<p onclick="steal()">متن سالم</p><script>alert(1)</script><iframe src="https://evil.example"></iframe>',
    });
    expect(created.status).toBe(201);
    expect(created.body.data.content).not.toContain('<script');
    expect(created.body.data.content).not.toContain('onclick');
    expect(created.body.data.content).not.toContain('iframe');
    expect(created.body.data.content).toContain('متن سالم');
  });
});

describe('blog comments moderation', () => {
  it('holds guest comments until a moderator approves, then nests replies', async () => {
    const post = (globalThis as any).__blogPost;
    const slug = encodeURIComponent(post.slug);

    const submitted = await request(server).post(`/api/public/blog/posts/${slug}/comments`)
      .send({ name: 'خواننده مهمان', body: 'مطلب خیلی کاربردی بود، ممنون!' });
    expect(submitted.status).toBe(201);
    expect(submitted.body.data.status).toBe('pending');

    const before = await request(server).get(`/api/public/blog/posts/${slug}`).expect(200);
    expect(before.body.data.comments).toHaveLength(0);

    const inbox = await request(server).get('/api/blog/comments?status=pending').set('Cookie', editor.cookie).expect(200);
    const mine = inbox.body.data.find((c: any) => c.id === submitted.body.data.id);
    expect(mine).toBeTruthy();

    await request(server).post(`/api/blog/comments/${mine.id}/decision`).set('Cookie', editor.cookie)
      .send({ status: 'approved' }).expect(200);

    const reply = await request(server).post(`/api/public/blog/posts/${slug}/comments`)
      .send({ name: 'پاسخ‌دهنده', body: 'موافقم، برای من هم همین‌طور بود.', parentId: mine.id });
    expect(reply.status).toBe(201);
    await request(server).post(`/api/blog/comments/${reply.body.data.id}/decision`).set('Cookie', editor.cookie)
      .send({ status: 'approved' }).expect(200);

    const after = await request(server).get(`/api/public/blog/posts/${slug}`).expect(200);
    expect(after.body.data.comments).toHaveLength(1);
    expect(after.body.data.comments[0].replies).toHaveLength(1);
    expect(after.body.data.post.commentsCount).toBe(2);
  });
});

describe('blog permissions and authorship scope', () => {
  it('locks the studio away from ordinary staff and keeps the content manager inside the blog only', async () => {
    expect((await request(server).get('/api/blog/posts').set('Cookie', plain.cookie)).status).toBe(403);
    expect((await request(server).post('/api/blog/posts').set('Cookie', plain.cookie)
      .send({ title: 'نباید ساخته شود', content: '<p>x</p>' })).status).toBe(403);
    expect((await request(server).get('/api/blog/comments').set('Cookie', plain.cookie)).status).toBe(403);

    // the dedicated content manager cannot wander into staff management
    expect((await request(server).get('/api/staff').set('Cookie', editor.cookie)).status).toBe(403);
    // but fully owns the blog (stats endpoint included)
    const stats = await request(server).get('/api/blog/stats').set('Cookie', editor.cookie).expect(200);
    expect(stats.body.data.posts.total).toBeGreaterThanOrEqual(3);
  });

  it('lets a granted author write drafts but never publish or touch others posts', async () => {
    const editorPost = (globalThis as any).__blogPost;

    const own = await createPostAs(author, { title: 'یادداشت نویسنده مهمان' });
    expect(own.status).toBe(201);

    // no publish grant: direct publish at creation and the publish endpoint both refuse
    expect((await createPostAs(author, { title: 'تلاش انتشار مستقیم', status: 'published' })).status).toBe(403);
    expect((await request(server).post(`/api/blog/posts/${own.body.data.id}/publish`).set('Cookie', author.cookie)).status).toBe(403);

    // list is scoped to own posts
    const list = await request(server).get('/api/blog/posts').set('Cookie', author.cookie).expect(200);
    expect(list.body.data.some((p: any) => p.id === own.body.data.id)).toBe(true);
    expect(list.body.data.some((p: any) => p.id === editorPost.id)).toBe(false);

    // editing the editor's post is refused; the editor (blog.manage) can edit the author's
    expect((await request(server).patch(`/api/blog/posts/${editorPost.id}`).set('Cookie', author.cookie)
      .send({ title: 'دست‌کاری', content: '<p>x</p>' })).status).toBe(403);
    const managed = await request(server).patch(`/api/blog/posts/${own.body.data.id}`).set('Cookie', editor.cookie)
      .send({ title: 'یادداشت نویسنده مهمان (ویرایش سردبیر)', content: '<p>متن ویراسته</p>', status: 'published' });
    expect(managed.status).toBe(200);
    expect(managed.body.data.status).toBe('published');
  });
});

describe('blog SEO surface and newsletter', () => {
  it('lists published articles in sitemap.xml and points robots.txt at it', async () => {
    const sitemap = await request(server).get('/sitemap.xml').expect(200);
    expect(sitemap.text).toContain('<urlset');
    expect(sitemap.text).toContain('/blog/');
    const robots = await request(server).get('/robots.txt').expect(200);
    expect(robots.text).toContain('Sitemap:');
    expect(robots.text).toContain('/sitemap.xml');
  });

  it('subscribes an email once and rejects invalid addresses', async () => {
    const first = await request(server).post('/api/public/blog/subscribe').send({ email: 'Reader@Test.ir ' });
    expect(first.status).toBe(201);
    expect(first.body.data.already).toBe(false);
    const second = await request(server).post('/api/public/blog/subscribe').send({ email: 'reader@test.ir' });
    expect(second.body.data.already).toBe(true);
    expect((await request(server).post('/api/public/blog/subscribe').send({ email: 'not-an-email' })).status).toBe(400);

    const list = await request(server).get('/api/blog/subscribers').set('Cookie', editor.cookie).expect(200);
    expect(list.body.data.some((s: any) => s.email === 'reader@test.ir')).toBe(true);
    // subscribers stay editor-only (blog.manage)
    expect((await request(server).get('/api/blog/subscribers').set('Cookie', author.cookie)).status).toBe(403);
  });
});
