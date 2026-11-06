import { Router } from 'express';
import fs from 'node:fs';
import { z } from 'zod';
import { asyncRoute, rateLimit, requireAuth, requirePermission } from '../http/middleware.js';
import { badRequest, forbidden, notFound } from '../http/errors.js';
import { created, ok } from '../http/respond.js';
import { param } from '../http/params.js';
import { hasPermission } from '../lib/permissions.js';
import { getFile, resolveStoragePath } from '../modules/media/service.js';
import {
  blogStats, createCategory, createComment, createPost, decideComment, deleteCategory, deleteComment,
  deletePost, getAdminPost, getPublicPost, listAdminComments, listAdminPosts, listCategories,
  listPublicPosts, listSubscribers, mediaReferencedByBlog, popularPosts, setSubscriberActive,
  sitemapPosts, subscribe, updateCategory, updatePost,
} from '../modules/blog/service.js';

/**
 * Blog HTTP surface.
 *
 *  - `publicBlogRouter` (/api/public/blog): published articles, categories,
 *    popular list, moderated comment submission, newsletter signup and the
 *    public media gateway for uploaded cover/inline images.
 *  - `blogRouter` (/api/blog): the WordPress-like studio. Every route is
 *    gated by a `blog.*` permission, so the section belongs to the super
 *    admin, the seeded content-manager role, or any role the admin grants
 *    these permissions to (a percentage employee included).
 *  - `blogSeoRouter`: /sitemap.xml + /robots.txt at the site root.
 */

const pageParams = (req: any) => ({
  page: Math.max(1, Number.parseInt(String(req.query.page ?? '1'), 10) || 1),
  pageSize: Math.min(100, Math.max(1, Number.parseInt(String(req.query.pageSize ?? '20'), 10) || 20)),
});

const actorOf = (req: any) => ({ id: req.auth!.user.id, name: req.auth!.user.fullName });
const canManage = (req: any) => hasPermission(req.auth!.permissions, 'blog.manage');
const canPublish = (req: any) => hasPermission(req.auth!.permissions, 'blog.publish');

/* ------------------------------------------------------------------ public */

export const publicBlogRouter = Router();

publicBlogRouter.get('/categories', asyncRoute(async (_req, res) => {
  ok(res, await listCategories({ publicOnly: true }));
}));

publicBlogRouter.get('/posts', asyncRoute(async (req, res) => {
  const { page, pageSize } = pageParams(req);
  const result = await listPublicPosts({
    categorySlug: typeof req.query.category === 'string' ? req.query.category : undefined,
    tag: typeof req.query.tag === 'string' ? req.query.tag : undefined,
    q: typeof req.query.q === 'string' ? req.query.q : undefined,
    sort: req.query.sort === 'popular' ? 'popular' : 'new',
    page, pageSize,
  });
  ok(res, result.items, { total: result.total, page: result.page, pageSize: result.pageSize });
}));

publicBlogRouter.get('/popular', asyncRoute(async (req, res) => {
  ok(res, await popularPosts(Number.parseInt(String(req.query.limit ?? '5'), 10) || 5));
}));

publicBlogRouter.get('/posts/:slug', asyncRoute(async (req, res) => {
  ok(res, await getPublicPost(param(req, 'slug')));
}));

publicBlogRouter.post(
  '/posts/:slug/comments',
  rateLimit({ windowMs: 60_000, max: 6, message: 'تعداد نظرات در یک دقیقه زیاد است؛ کمی صبر کنید.' }),
  asyncRoute(async (req, res) => {
    const body = z.object({
      name: z.string().trim().max(80).optional(),
      email: z.string().trim().email().max(160).optional().or(z.literal('')),
      body: z.string().trim().min(3).max(4000),
      parentId: z.string().max(80).optional(),
    }).parse(req.body);
    const user = req.auth?.user ? { id: req.auth.user.id, fullName: req.auth.user.fullName } : null;
    created(res, await createComment(param(req, 'slug'), { ...body, email: body.email || undefined }, user));
  }),
);

publicBlogRouter.post(
  '/subscribe',
  rateLimit({ windowMs: 60_000, max: 10, message: 'درخواست زیاد است؛ کمی صبر کنید.' }),
  asyncRoute(async (req, res) => {
    const body = z.object({ email: z.string().trim().email().max(160) }).parse(req.body);
    created(res, await subscribe(body.email));
  }),
);

/**
 * Public gateway for uploaded blog media. Stored files are private by
 * default in this system; a file becomes reachable here only once a blog
 * post references it (cover or inline image), mirroring public WP media.
 */
publicBlogRouter.get('/media/:fileId', asyncRoute(async (req, res) => {
  const fileId = param(req, 'fileId');
  const file = await getFile(fileId);
  if (!file) throw notFound('فایل یافت نشد.');
  if (!file.is_public && !(await mediaReferencedByBlog(fileId))) throw forbidden('این فایل عمومی نیست.');
  if (!/^image\//.test(file.mime ?? '')) throw forbidden('فقط تصویر از این درگاه منتشر می‌شود.');
  const absolute = resolveStoragePath(file.storage_key);
  if (!fs.existsSync(absolute)) throw notFound('فایل روی سرور موجود نیست.');
  res.setHeader('content-type', file.mime || 'application/octet-stream');
  res.setHeader('cache-control', 'public, max-age=86400');
  res.setHeader('x-content-type-options', 'nosniff');
  if (file.sha256) res.setHeader('etag', `"${String(file.sha256).slice(0, 32)}-blog"`);
  fs.createReadStream(absolute).on('error', () => { if (!res.headersSent) res.status(500).end(); }).pipe(res);
}));

/* ------------------------------------------------------------------ studio */

export const blogRouter = Router();
blogRouter.use(requireAuth);

const postSchema = z.object({
  title: z.string().trim().min(3).max(300),
  subtitle: z.string().trim().max(400).nullable().optional(),
  slug: z.string().trim().max(160).optional(),
  excerpt: z.string().trim().max(600).nullable().optional(),
  content: z.string().max(400_000).default(''),
  categoryId: z.string().max(80).nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(60)).max(30).default([]),
  coverUrl: z.string().trim().max(1000).nullable().optional(),
  coverAlt: z.string().trim().max(200).nullable().optional(),
  status: z.enum(['draft', 'published', 'archived']).optional(),
  publishedAt: z.string().max(40).nullable().optional(),
  seoTitle: z.string().trim().max(300).nullable().optional(),
  seoDescription: z.string().trim().max(400).nullable().optional(),
  canonicalUrl: z.string().trim().max(1000).nullable().optional(),
  noindex: z.boolean().optional(),
  allowComments: z.boolean().optional(),
  featured: z.boolean().optional(),
});

blogRouter.get('/stats', requirePermission('blog.view'), asyncRoute(async (req, res) => {
  ok(res, await blogStats(req.auth!.user.id, canManage(req)));
}));

blogRouter.get('/posts', requirePermission('blog.view'), asyncRoute(async (req, res) => {
  const { page, pageSize } = pageParams(req);
  const result = await listAdminPosts({
    viewerId: req.auth!.user.id, canManage: canManage(req),
    status: typeof req.query.status === 'string' ? req.query.status : undefined,
    q: typeof req.query.q === 'string' ? req.query.q : undefined,
    categoryId: typeof req.query.categoryId === 'string' ? req.query.categoryId : undefined,
    page, pageSize,
  });
  ok(res, result.items, { total: result.total, page: result.page, pageSize: result.pageSize });
}));

blogRouter.post('/posts', requirePermission('blog.create'), asyncRoute(async (req, res) => {
  const body = postSchema.parse(req.body);
  if (body.status === 'published' && !canPublish(req)) throw forbidden('برای انتشار مطلب مجوز «انتشار» لازم است.');
  created(res, await createPost(body as any, actorOf(req), canPublish(req)));
}));

blogRouter.get('/posts/:id', requirePermission('blog.view'), asyncRoute(async (req, res) => {
  ok(res, await getAdminPost(param(req, 'id'), req.auth!.user.id, canManage(req)));
}));

blogRouter.patch('/posts/:id', requirePermission('blog.edit'), asyncRoute(async (req, res) => {
  const body = postSchema.parse(req.body);
  ok(res, await updatePost(param(req, 'id'), body as any, actorOf(req), { canManage: canManage(req), canPublish: canPublish(req) }));
}));

blogRouter.delete('/posts/:id', requirePermission('blog.delete'), asyncRoute(async (req, res) => {
  ok(res, await deletePost(param(req, 'id'), actorOf(req), canManage(req)));
}));

blogRouter.post('/posts/:id/publish', requirePermission('blog.publish'), asyncRoute(async (req, res) => {
  const post = await getAdminPost(param(req, 'id'), req.auth!.user.id, canManage(req));
  ok(res, await updatePost(post.id, { ...post, status: 'published' } as any, actorOf(req), { canManage: canManage(req), canPublish: true }));
}));

blogRouter.post('/posts/:id/unpublish', requirePermission('blog.publish'), asyncRoute(async (req, res) => {
  const post = await getAdminPost(param(req, 'id'), req.auth!.user.id, canManage(req));
  ok(res, await updatePost(post.id, { ...post, status: 'draft' } as any, actorOf(req), { canManage: canManage(req), canPublish: true }));
}));

/* categories */

const categorySchema = z.object({
  title: z.string().trim().min(2).max(120),
  slug: z.string().trim().max(140).optional(),
  description: z.string().trim().max(600).optional(),
  icon: z.string().trim().max(60).optional(),
  color: z.string().trim().max(30).optional(),
  sortOrder: z.number().int().min(-1000).max(1000).optional(),
  isActive: z.boolean().optional(),
});

blogRouter.get('/categories', requirePermission('blog.view'), asyncRoute(async (_req, res) => {
  ok(res, await listCategories());
}));

blogRouter.post('/categories', requirePermission('blog.categories'), asyncRoute(async (req, res) => {
  created(res, await createCategory(categorySchema.parse(req.body), actorOf(req)));
}));

blogRouter.patch('/categories/:id', requirePermission('blog.categories'), asyncRoute(async (req, res) => {
  ok(res, await updateCategory(param(req, 'id'), categorySchema.parse(req.body), actorOf(req)));
}));

blogRouter.delete('/categories/:id', requirePermission('blog.categories'), asyncRoute(async (req, res) => {
  ok(res, await deleteCategory(param(req, 'id'), actorOf(req)));
}));

/* comments */

blogRouter.get('/comments', requirePermission('blog.comments'), asyncRoute(async (req, res) => {
  const { page, pageSize } = pageParams(req);
  const result = await listAdminComments({
    status: typeof req.query.status === 'string' ? req.query.status : undefined,
    postId: typeof req.query.postId === 'string' ? req.query.postId : undefined,
    page, pageSize,
  });
  ok(res, result.items, { total: result.total, page: result.page, pageSize: result.pageSize });
}));

blogRouter.post('/comments/:id/decision', requirePermission('blog.comments'), asyncRoute(async (req, res) => {
  const body = z.object({ status: z.enum(['approved', 'rejected', 'spam', 'pending']) }).parse(req.body);
  ok(res, await decideComment(param(req, 'id'), body.status, actorOf(req)));
}));

blogRouter.delete('/comments/:id', requirePermission('blog.comments'), asyncRoute(async (req, res) => {
  ok(res, await deleteComment(param(req, 'id'), actorOf(req)));
}));

/* subscribers */

blogRouter.get('/subscribers', requirePermission('blog.manage'), asyncRoute(async (req, res) => {
  const { page, pageSize } = pageParams(req);
  const result = await listSubscribers({ page, pageSize });
  ok(res, result.items, { total: result.total, page: result.page, pageSize: result.pageSize });
}));

blogRouter.patch('/subscribers/:id', requirePermission('blog.manage'), asyncRoute(async (req, res) => {
  const body = z.object({ isActive: z.boolean() }).parse(req.body);
  ok(res, await setSubscriberActive(param(req, 'id'), body.isActive));
}));

/* --------------------------------------------------------------------- seo */

const xmlEscape = (value: string) => value
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&apos;');

export const blogSeoRouter = Router();

blogSeoRouter.get('/sitemap.xml', asyncRoute(async (req, res) => {
  const base = `${req.protocol}://${req.get('host') ?? ''}`;
  const staticPaths = ['/', '/services', '/blog', '/status', '/legal'];
  const posts = await sitemapPosts();
  const urls = [
    ...staticPaths.map((p) => `  <url><loc>${xmlEscape(`${base}${p}`)}</loc></url>`),
    ...posts.map((p) => `  <url><loc>${xmlEscape(`${base}/blog/${encodeURIComponent(p.slug)}`)}</loc><lastmod>${xmlEscape(String(p.updated_at).slice(0, 10))}</lastmod></url>`),
  ];
  res.setHeader('content-type', 'application/xml; charset=utf-8');
  res.setHeader('cache-control', 'public, max-age=3600');
  res.send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`);
}));

blogSeoRouter.get('/robots.txt', asyncRoute(async (req, res) => {
  const base = `${req.protocol}://${req.get('host') ?? ''}`;
  res.setHeader('content-type', 'text/plain; charset=utf-8');
  res.setHeader('cache-control', 'public, max-age=3600');
  res.send(`User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /app/\nDisallow: /admin/\nDisallow: /staff/\nDisallow: /login\nDisallow: /login-admin\n\nSitemap: ${base}/sitemap.xml\n`);
}));
