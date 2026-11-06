import { one, q, run, nowIso, jsonParse, jsonStringify } from '../../db/index.js';
import { id } from '../../lib/crypto.js';
import { badRequest, conflict, forbidden, notFound } from '../../http/errors.js';
import { writeAudit } from '../audit/service.js';

/**
 * Blog / content-management service.
 *
 * WordPress-style articles owned by an author, with categories, tags, an SEO
 * field set, scheduled publishing (a future `published_at` stays hidden),
 * moderated comments and a newsletter list. Access control lives in the
 * routes (`blog.*` permissions); this module only enforces authorship scope:
 * without `blog.manage` an author sees and edits only their own posts.
 */

export const POST_STATUSES = ['draft', 'published', 'archived'] as const;
export type PostStatus = (typeof POST_STATUSES)[number];
export const STATUS_LABELS: Record<PostStatus, string> = {
  draft: 'پیش‌نویس',
  published: 'منتشرشده',
  archived: 'بایگانی',
};
export const COMMENT_STATUSES = ['pending', 'approved', 'rejected', 'spam'] as const;
export const COMMENT_LABELS: Record<string, string> = {
  pending: 'در انتظار بررسی',
  approved: 'تأییدشده',
  rejected: 'ردشده',
  spam: 'هرزنامه',
};

interface Actor { id: string; name: string }

/* ------------------------------------------------------------------ utils */

/** Persian-friendly slug: keeps Persian letters, latin and digits. */
export function slugifyFa(input: string): string {
  return String(input ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\u200c\u200d]/g, '-')
    // Letters/digits only (any script): the Arabic block range \u0600-\u06FF
    // also carries punctuation (، ؛ ؟) which must never survive into a URL.
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 120) || 'post';
}

async function uniqueSlug(table: 'blog_posts' | 'blog_categories', base: string, excludeId?: string): Promise<string> {
  let candidate = base;
  let n = 1;
  for (;;) {
    const row = await one<any>(`SELECT id FROM ${table} WHERE slug = ?`, [candidate]);
    if (!row || row.id === excludeId) return candidate;
    n += 1;
    candidate = `${base}-${n}`.slice(0, 130);
  }
}

export function stripTags(html: string): string {
  return String(html ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

export function readingMinutes(html: string): number {
  const words = stripTags(html).split(' ').filter(Boolean).length;
  return Math.max(1, Math.ceil(words / 180));
}

export function excerptFrom(html: string, max = 240): string {
  const text = stripTags(html);
  return text.length > max ? `${text.slice(0, max).trim()}…` : text;
}

/**
 * Conservative server-side clean-up of editor HTML. The web client renders
 * through a strict allow-list sanitizer as well; this layer makes even raw
 * API writes safe (no script/style/frames/forms, no event handlers, no
 * javascript: URLs, no inline style).
 */
export function sanitizeBlogHtml(html: string): string {
  let out = String(html ?? '');
  out = out.replace(/<(script|style|iframe|object|embed|form|button|input|select|textarea|link|meta|base|title|noscript)[\s\S]*?<\/\1\s*>/gi, '');
  out = out.replace(/<(script|style|iframe|object|embed|form|button|input|select|textarea|link|meta|base)[^>]*\/?>/gi, '');
  out = out.replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  out = out.replace(/\sstyle\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  out = out.replace(/(href|src)\s*=\s*("|')\s*(javascript:|data:text|vbscript:)[^"']*\2/gi, '$1="#"');
  return out.slice(0, 400_000);
}

function tagsOf(row: any): string[] {
  const tags = jsonParse<unknown>(row.tags, []);
  return Array.isArray(tags) ? tags.filter((t): t is string => typeof t === 'string' && t.trim() !== '').slice(0, 30) : [];
}

function isScheduled(row: any): boolean {
  return row.status === 'published' && row.published_at !== null && row.published_at > nowIso();
}

function categoryDto(row: any) {
  return {
    id: row.id, slug: row.slug, title: row.title, description: row.description,
    icon: row.icon, color: row.color, sortOrder: Number(row.sort_order ?? 0),
    isActive: Boolean(row.is_active),
    postsCount: row.posts_count !== undefined ? Number(row.posts_count) : undefined,
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function postDto(row: any, opts: { admin?: boolean } = {}) {
  const scheduled = isScheduled(row);
  const base = {
    id: row.id, slug: row.slug, title: row.title, subtitle: row.subtitle,
    excerpt: row.excerpt || excerptFrom(row.content ?? ''),
    categoryId: row.category_id, categoryTitle: row.category_title ?? null, categorySlug: row.category_slug ?? null,
    categoryIcon: row.category_icon ?? null, categoryColor: row.category_color ?? null,
    tags: tagsOf(row),
    coverUrl: row.cover_url, coverAlt: row.cover_alt,
    authorName: row.author_name ?? null,
    status: row.status as PostStatus,
    statusLabel: scheduled ? 'زمان‌بندی‌شده' : (STATUS_LABELS[row.status as PostStatus] ?? row.status),
    scheduled,
    publishedAt: row.published_at,
    seoTitle: row.seo_title, seoDescription: row.seo_description,
    canonicalUrl: row.canonical_url, noindex: Boolean(row.noindex),
    allowComments: Boolean(row.allow_comments), featured: Boolean(row.featured),
    readingMinutes: Number(row.reading_minutes ?? 1),
    viewsCount: Number(row.views_count ?? 0),
    commentsCount: row.comments_count !== undefined ? Number(row.comments_count) : 0,
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
  return opts.admin
    ? { ...base, content: row.content ?? '', authorId: row.author_id, pendingComments: row.pending_comments !== undefined ? Number(row.pending_comments) : 0 }
    : base;
}

/* ------------------------------------------------------------- categories */

export async function listCategories(opts: { publicOnly?: boolean } = {}) {
  const countFilter = opts.publicOnly
    ? "AND p.status = 'published' AND (p.published_at IS NULL OR p.published_at <= ?)"
    : '';
  const rows = await q<any>(
    `SELECT c.*,
            (SELECT COUNT(*) FROM blog_posts p WHERE p.category_id = c.id ${countFilter}) AS posts_count
     FROM blog_categories c
     ${opts.publicOnly ? 'WHERE c.is_active = 1' : ''}
     ORDER BY c.sort_order ASC, c.title ASC`,
    opts.publicOnly ? [nowIso()] : [],
  );
  return rows.map(categoryDto);
}

export interface CategoryInput {
  title: string; slug?: string; description?: string; icon?: string; color?: string;
  sortOrder?: number; isActive?: boolean;
}

export async function createCategory(input: CategoryInput, actor: Actor) {
  const slug = await uniqueSlug('blog_categories', slugifyFa(input.slug || input.title));
  const ts = nowIso();
  const categoryId = id('bcat');
  await run(
    `INSERT INTO blog_categories (id, slug, title, description, icon, color, sort_order, is_active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [categoryId, slug, input.title, input.description ?? null, input.icon ?? null, input.color ?? null,
      input.sortOrder ?? 0, input.isActive === false ? 0 : 1, ts, ts],
  );
  await writeAudit({ actorId: actor.id, actorName: actor.name, action: 'blog.category.create', entityType: 'blog_category', entityId: categoryId, after: { slug, title: input.title } });
  return categoryDto((await one<any>('SELECT * FROM blog_categories WHERE id = ?', [categoryId]))!);
}

export async function updateCategory(categoryId: string, input: CategoryInput, actor: Actor) {
  const existing = await one<any>('SELECT * FROM blog_categories WHERE id = ?', [categoryId]);
  if (!existing) throw notFound('دسته‌بندی یافت نشد.');
  const slug = input.slug ? await uniqueSlug('blog_categories', slugifyFa(input.slug), categoryId) : existing.slug;
  await run(
    `UPDATE blog_categories SET slug = ?, title = ?, description = ?, icon = ?, color = ?, sort_order = ?, is_active = ?, updated_at = ? WHERE id = ?`,
    [slug, input.title, input.description ?? null, input.icon ?? null, input.color ?? null,
      input.sortOrder ?? Number(existing.sort_order ?? 0), input.isActive === false ? 0 : 1, nowIso(), categoryId],
  );
  await writeAudit({ actorId: actor.id, actorName: actor.name, action: 'blog.category.update', entityType: 'blog_category', entityId: categoryId, after: { slug, title: input.title } });
  return categoryDto((await one<any>('SELECT * FROM blog_categories WHERE id = ?', [categoryId]))!);
}

export async function deleteCategory(categoryId: string, actor: Actor) {
  const existing = await one<any>('SELECT * FROM blog_categories WHERE id = ?', [categoryId]);
  if (!existing) throw notFound('دسته‌بندی یافت نشد.');
  await run('DELETE FROM blog_categories WHERE id = ?', [categoryId]); // posts keep living with category NULL
  await writeAudit({ actorId: actor.id, actorName: actor.name, action: 'blog.category.delete', entityType: 'blog_category', entityId: categoryId, before: { slug: existing.slug } });
  return { deleted: true };
}

/* ------------------------------------------------------------------ posts */

export interface PostInput {
  title: string;
  subtitle?: string | null;
  slug?: string;
  excerpt?: string | null;
  content: string;
  categoryId?: string | null;
  tags?: string[];
  coverUrl?: string | null;
  coverAlt?: string | null;
  status?: PostStatus;
  publishedAt?: string | null;
  seoTitle?: string | null;
  seoDescription?: string | null;
  canonicalUrl?: string | null;
  noindex?: boolean;
  allowComments?: boolean;
  featured?: boolean;
}

const POST_SELECT = `
  SELECT p.*, c.title AS category_title, c.slug AS category_slug, c.icon AS category_icon, c.color AS category_color,
         u.full_name AS author_name,
         (SELECT COUNT(*) FROM blog_comments cm WHERE cm.post_id = p.id AND cm.status = 'approved') AS comments_count,
         (SELECT COUNT(*) FROM blog_comments cm WHERE cm.post_id = p.id AND cm.status = 'pending') AS pending_comments
  FROM blog_posts p
  LEFT JOIN blog_categories c ON c.id = p.category_id
  JOIN users u ON u.id = p.author_id`;

async function getPostRow(postId: string) {
  return one<any>(`${POST_SELECT} WHERE p.id = ?`, [postId]);
}

function assertScope(row: any, viewerId: string, canManage: boolean) {
  if (!canManage && row.author_id !== viewerId) {
    throw forbidden('این مطلب متعلق به نویسندهٔ دیگری است؛ برای ویرایش آن مجوز سردبیری لازم است.');
  }
}

export async function createPost(input: PostInput, author: Actor, canPublish: boolean) {
  const status: PostStatus = input.status === 'published' && canPublish ? 'published'
    : input.status === 'archived' ? 'archived' : 'draft';
  const content = sanitizeBlogHtml(input.content);
  const slug = await uniqueSlug('blog_posts', slugifyFa(input.slug || input.title));
  const ts = nowIso();
  const publishedAt = status === 'published' ? (input.publishedAt ?? ts) : (input.publishedAt ?? null);
  const postId = id('post');
  await run(
    `INSERT INTO blog_posts (id, slug, title, subtitle, excerpt, content, category_id, tags, cover_url, cover_alt,
       author_id, status, published_at, seo_title, seo_description, canonical_url, noindex, allow_comments,
       featured, reading_minutes, views_count, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
    [postId, slug, input.title, input.subtitle ?? null, input.excerpt?.trim() || excerptFrom(content), content,
      input.categoryId ?? null, jsonStringify((input.tags ?? []).map((t) => t.trim()).filter(Boolean).slice(0, 30)),
      input.coverUrl ?? null, input.coverAlt ?? null, author.id, status, publishedAt,
      input.seoTitle ?? null, input.seoDescription ?? null, input.canonicalUrl ?? null,
      input.noindex ? 1 : 0, input.allowComments === false ? 0 : 1, input.featured ? 1 : 0,
      readingMinutes(content), ts, ts],
  );
  await writeAudit({ actorId: author.id, actorName: author.name, action: 'blog.post.create', entityType: 'blog_post', entityId: postId, after: { slug, status, title: input.title } });
  return postDto((await getPostRow(postId))!, { admin: true });
}

export async function updatePost(postId: string, input: PostInput, actor: Actor, opts: { canManage: boolean; canPublish: boolean }) {
  const existing = await getPostRow(postId);
  if (!existing) throw notFound('مطلب یافت نشد.');
  assertScope(existing, actor.id, opts.canManage);

  let status = existing.status as PostStatus;
  let publishedAt: string | null = existing.published_at;
  if (input.status && input.status !== existing.status) {
    if (input.status === 'published' && !opts.canPublish) throw forbidden('برای انتشار مطلب مجوز «انتشار» لازم است.');
    status = input.status;
    if (status === 'published') publishedAt = input.publishedAt ?? publishedAt ?? nowIso();
  } else if (input.publishedAt !== undefined) {
    publishedAt = input.publishedAt;
  }
  const content = sanitizeBlogHtml(input.content);
  const slug = input.slug ? await uniqueSlug('blog_posts', slugifyFa(input.slug), postId) : existing.slug;
  await run(
    `UPDATE blog_posts SET slug = ?, title = ?, subtitle = ?, excerpt = ?, content = ?, category_id = ?, tags = ?,
       cover_url = ?, cover_alt = ?, status = ?, published_at = ?, seo_title = ?, seo_description = ?,
       canonical_url = ?, noindex = ?, allow_comments = ?, featured = ?, reading_minutes = ?, updated_at = ?
     WHERE id = ?`,
    [slug, input.title, input.subtitle ?? null, input.excerpt?.trim() || excerptFrom(content), content,
      input.categoryId ?? null, jsonStringify((input.tags ?? []).map((t) => t.trim()).filter(Boolean).slice(0, 30)),
      input.coverUrl ?? null, input.coverAlt ?? null, status, publishedAt,
      input.seoTitle ?? null, input.seoDescription ?? null, input.canonicalUrl ?? null,
      input.noindex ? 1 : 0, input.allowComments === false ? 0 : 1, input.featured ? 1 : 0,
      readingMinutes(content), nowIso(), postId],
  );
  await writeAudit({
    actorId: actor.id, actorName: actor.name,
    action: status !== existing.status ? `blog.post.${status === 'published' ? 'publish' : 'status'}` : 'blog.post.update',
    entityType: 'blog_post', entityId: postId, after: { slug, status, title: input.title },
  });
  return postDto((await getPostRow(postId))!, { admin: true });
}

export async function deletePost(postId: string, actor: Actor, canManage: boolean) {
  const existing = await getPostRow(postId);
  if (!existing) throw notFound('مطلب یافت نشد.');
  assertScope(existing, actor.id, canManage);
  await run('DELETE FROM blog_posts WHERE id = ?', [postId]); // comments cascade
  await writeAudit({ actorId: actor.id, actorName: actor.name, action: 'blog.post.delete', entityType: 'blog_post', entityId: postId, before: { slug: existing.slug, title: existing.title } });
  return { deleted: true };
}

export async function listAdminPosts(params: {
  viewerId: string; canManage: boolean; status?: string; q?: string; categoryId?: string; page?: number; pageSize?: number;
}) {
  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, params.pageSize ?? 20));
  const where: string[] = [];
  const args: any[] = [];
  if (!params.canManage) { where.push('p.author_id = ?'); args.push(params.viewerId); }
  if (params.status && (POST_STATUSES as readonly string[]).includes(params.status)) { where.push('p.status = ?'); args.push(params.status); }
  if (params.categoryId) { where.push('p.category_id = ?'); args.push(params.categoryId); }
  if (params.q?.trim()) {
    where.push('(p.title LIKE ? OR p.subtitle LIKE ? OR p.slug LIKE ?)');
    const like = `%${params.q.trim()}%`;
    args.push(like, like, like);
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = Number((await one<{ c: number }>(`SELECT COUNT(*) AS c FROM blog_posts p ${clause}`, args))?.c ?? 0);
  const rows = await q<any>(`${POST_SELECT} ${clause} ORDER BY p.updated_at DESC LIMIT ? OFFSET ?`, [...args, pageSize, (page - 1) * pageSize]);
  return { items: rows.map((r) => postDto(r, { admin: true })), total, page, pageSize };
}

export async function getAdminPost(postId: string, viewerId: string, canManage: boolean) {
  const row = await getPostRow(postId);
  if (!row) throw notFound('مطلب یافت نشد.');
  assertScope(row, viewerId, canManage);
  return postDto(row, { admin: true });
}

const PUBLIC_WHERE = "p.status = 'published' AND (p.published_at IS NULL OR p.published_at <= ?)";

export async function listPublicPosts(params: {
  categorySlug?: string; tag?: string; q?: string; page?: number; pageSize?: number; sort?: 'new' | 'popular';
}) {
  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(50, Math.max(1, params.pageSize ?? 9));
  const where: string[] = [PUBLIC_WHERE];
  const args: any[] = [nowIso()];
  if (params.categorySlug) { where.push('c.slug = ?'); args.push(params.categorySlug); }
  if (params.tag) { where.push('p.tags LIKE ?'); args.push(`%"${params.tag.replace(/[%_"]/g, '')}"%`); }
  if (params.q?.trim()) {
    where.push('(p.title LIKE ? OR p.subtitle LIKE ? OR p.excerpt LIKE ?)');
    const like = `%${params.q.trim()}%`;
    args.push(like, like, like);
  }
  const clause = `WHERE ${where.join(' AND ')}`;
  const total = Number((await one<{ c: number }>(
    `SELECT COUNT(*) AS c FROM blog_posts p LEFT JOIN blog_categories c ON c.id = p.category_id ${clause}`, args,
  ))?.c ?? 0);
  const order = params.sort === 'popular' ? 'p.views_count DESC, p.published_at DESC' : "COALESCE(p.published_at, p.created_at) DESC";
  const rows = await q<any>(`${POST_SELECT} ${clause} ORDER BY ${order} LIMIT ? OFFSET ?`, [...args, pageSize, (page - 1) * pageSize]);
  return { items: rows.map((r) => postDto(r)), total, page, pageSize };
}

export async function popularPosts(limit = 5) {
  const rows = await q<any>(
    `${POST_SELECT} WHERE ${PUBLIC_WHERE} ORDER BY p.views_count DESC, COALESCE(p.published_at, p.created_at) DESC LIMIT ?`,
    [nowIso(), Math.min(20, Math.max(1, limit))],
  );
  return rows.map((r) => postDto(r));
}

function commentDto(row: any, admin = false) {
  const base = {
    id: row.id, postId: row.post_id, parentId: row.parent_id,
    authorName: row.author_name, body: row.body, createdAt: row.created_at,
    isStaff: Boolean(row.author_user_id) && row.author_kind !== 'customer' && row.author_kind !== null && row.author_kind !== undefined,
  };
  return admin
    ? {
      ...base, status: row.status, statusLabel: COMMENT_LABELS[row.status] ?? row.status,
      authorEmail: row.author_email, authorUserId: row.author_user_id,
      postTitle: row.post_title ?? null, postSlug: row.post_slug ?? null,
      reviewedBy: row.reviewed_by, reviewedAt: row.reviewed_at,
    }
    : base;
}

/** Approved comments as a two-level tree (replies sit under their root). */
function commentTree(rows: any[]) {
  const byId = new Map<string, any>();
  const roots: any[] = [];
  for (const row of rows) byId.set(row.id, { ...commentDto(row), replies: [] as any[] });
  for (const row of rows) {
    const node = byId.get(row.id);
    let parentId: string | null = row.parent_id;
    // lift deep replies to their root so the public UI stays two levels
    const seen = new Set<string>();
    while (parentId && byId.get(parentId)?.parentId && !seen.has(parentId)) {
      seen.add(parentId);
      parentId = byId.get(parentId).parentId;
    }
    if (parentId && byId.has(parentId) && parentId !== row.id) byId.get(parentId).replies.push(node);
    else roots.push(node);
  }
  return roots;
}

export async function getPublicPost(slug: string) {
  const row = await one<any>(`${POST_SELECT} WHERE p.slug = ? AND ${PUBLIC_WHERE}`, [slug, nowIso()]);
  if (!row) throw notFound('این مطلب یافت نشد یا هنوز منتشر نشده است.');
  await run('UPDATE blog_posts SET views_count = views_count + 1 WHERE id = ?', [row.id]);
  const post = postDto(row);
  post.viewsCount += 1;
  (post as any).content = row.content ?? '';

  const related = row.category_id
    ? await q<any>(`${POST_SELECT} WHERE ${PUBLIC_WHERE} AND p.category_id = ? AND p.id <> ? ORDER BY COALESCE(p.published_at, p.created_at) DESC LIMIT 3`, [nowIso(), row.category_id, row.id])
    : [];
  const comments = await q<any>(
    `SELECT cm.*, u.kind AS author_kind FROM blog_comments cm LEFT JOIN users u ON u.id = cm.author_user_id
     WHERE cm.post_id = ? AND cm.status = 'approved' ORDER BY cm.created_at ASC`,
    [row.id],
  );
  return { post, related: related.map((r) => postDto(r)), comments: commentTree(comments) };
}

/* --------------------------------------------------------------- comments */

export async function createComment(slug: string, input: { name?: string; email?: string; body: string; parentId?: string }, user?: { id: string; fullName: string } | null) {
  const post = await one<any>(
    "SELECT id, allow_comments FROM blog_posts WHERE slug = ? AND status = 'published' AND (published_at IS NULL OR published_at <= ?)",
    [slug, nowIso()],
  );
  if (!post) throw notFound('این مطلب یافت نشد یا هنوز منتشر نشده است.');
  if (!post.allow_comments) throw forbidden('ثبت نظر برای این مطلب بسته است.');
  const body = String(input.body ?? '').trim();
  if (body.length < 3) throw badRequest('متن نظر خیلی کوتاه است.');
  const name = (user?.fullName || input.name || '').trim();
  if (!name) throw badRequest('برای ثبت نظر، نام شما لازم است (یا وارد حساب شوید).');
  let parentId: string | null = null;
  if (input.parentId) {
    const parent = await one<any>('SELECT id FROM blog_comments WHERE id = ? AND post_id = ? AND status = ?', [input.parentId, post.id, 'approved']);
    if (!parent) throw badRequest('نظر والد یافت نشد.');
    parentId = parent.id;
  }
  const commentId = id('bcmt');
  await run(
    `INSERT INTO blog_comments (id, post_id, parent_id, author_user_id, author_name, author_email, body, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
    [commentId, post.id, parentId, user?.id ?? null, name.slice(0, 80), input.email?.trim() || null, body.slice(0, 4000), nowIso()],
  );
  return { id: commentId, status: 'pending', message: 'نظر شما ثبت شد و پس از بررسی و تأیید مدیر نمایش داده می‌شود.' };
}

export async function listAdminComments(params: { status?: string; postId?: string; page?: number; pageSize?: number }) {
  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, params.pageSize ?? 25));
  const where: string[] = [];
  const args: any[] = [];
  if (params.status && (COMMENT_STATUSES as readonly string[]).includes(params.status)) { where.push('cm.status = ?'); args.push(params.status); }
  if (params.postId) { where.push('cm.post_id = ?'); args.push(params.postId); }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = Number((await one<{ c: number }>(`SELECT COUNT(*) AS c FROM blog_comments cm ${clause}`, args))?.c ?? 0);
  const rows = await q<any>(
    `SELECT cm.*, p.title AS post_title, p.slug AS post_slug, u.kind AS author_kind
     FROM blog_comments cm JOIN blog_posts p ON p.id = cm.post_id LEFT JOIN users u ON u.id = cm.author_user_id
     ${clause} ORDER BY CASE cm.status WHEN 'pending' THEN 0 ELSE 1 END, cm.created_at DESC LIMIT ? OFFSET ?`,
    [...args, pageSize, (page - 1) * pageSize],
  );
  return { items: rows.map((r) => commentDto(r, true)), total, page, pageSize };
}

export async function decideComment(commentId: string, status: string, actor: Actor) {
  if (!(COMMENT_STATUSES as readonly string[]).includes(status)) throw badRequest('وضعیت نظر معتبر نیست.');
  const existing = await one<any>('SELECT * FROM blog_comments WHERE id = ?', [commentId]);
  if (!existing) throw notFound('نظر یافت نشد.');
  await run('UPDATE blog_comments SET status = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ?', [status, actor.id, nowIso(), commentId]);
  await writeAudit({ actorId: actor.id, actorName: actor.name, action: 'blog.comment.decision', entityType: 'blog_comment', entityId: commentId, after: { status } });
  return { id: commentId, status };
}

export async function deleteComment(commentId: string, actor: Actor) {
  const existing = await one<any>('SELECT * FROM blog_comments WHERE id = ?', [commentId]);
  if (!existing) throw notFound('نظر یافت نشد.');
  await run('DELETE FROM blog_comments WHERE id = ?', [commentId]);
  await writeAudit({ actorId: actor.id, actorName: actor.name, action: 'blog.comment.delete', entityType: 'blog_comment', entityId: commentId, before: { body: existing.body?.slice?.(0, 120) } });
  return { deleted: true };
}

/* ------------------------------------------------------------- newsletter */

export async function subscribe(emailRaw: string) {
  const email = String(emailRaw ?? '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw badRequest('ایمیل معتبر وارد کنید.');
  const existing = await one<any>('SELECT id, is_active FROM blog_subscribers WHERE email = ?', [email]);
  if (existing) {
    if (!existing.is_active) await run('UPDATE blog_subscribers SET is_active = 1 WHERE id = ?', [existing.id]);
    return { subscribed: true, already: true };
  }
  await run('INSERT INTO blog_subscribers (id, email, is_active, created_at) VALUES (?, ?, 1, ?)', [id('bsub'), email, nowIso()]);
  return { subscribed: true, already: false };
}

export async function listSubscribers(params: { page?: number; pageSize?: number } = {}) {
  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(200, Math.max(1, params.pageSize ?? 50));
  const total = Number((await one<{ c: number }>('SELECT COUNT(*) AS c FROM blog_subscribers'))?.c ?? 0);
  const rows = await q<any>('SELECT * FROM blog_subscribers ORDER BY created_at DESC LIMIT ? OFFSET ?', [pageSize, (page - 1) * pageSize]);
  return {
    items: rows.map((r) => ({ id: r.id, email: r.email, isActive: Boolean(r.is_active), createdAt: r.created_at })),
    total, page, pageSize,
  };
}

export async function setSubscriberActive(subscriberId: string, active: boolean) {
  const existing = await one<any>('SELECT id FROM blog_subscribers WHERE id = ?', [subscriberId]);
  if (!existing) throw notFound('مشترک یافت نشد.');
  await run('UPDATE blog_subscribers SET is_active = ? WHERE id = ?', [active ? 1 : 0, subscriberId]);
  return { id: subscriberId, isActive: active };
}

/* --------------------------------------------------------------- stats/seo */

export async function blogStats(viewerId: string, canManage: boolean) {
  const scope = canManage ? '' : 'WHERE author_id = ?';
  const scopeArgs = canManage ? [] : [viewerId];
  const byStatus = await q<any>(`SELECT status, COUNT(*) AS c FROM blog_posts ${scope} GROUP BY status`, scopeArgs);
  const views = await one<any>(`SELECT COALESCE(SUM(views_count), 0) AS t FROM blog_posts ${scope}`, scopeArgs);
  const pending = canManage
    ? await one<any>("SELECT COUNT(*) AS c FROM blog_comments WHERE status = 'pending'")
    : await one<any>(
      "SELECT COUNT(*) AS c FROM blog_comments cm JOIN blog_posts p ON p.id = cm.post_id WHERE cm.status = 'pending' AND p.author_id = ?",
      [viewerId],
    );
  const subscribers = await one<any>('SELECT COUNT(*) AS c FROM blog_subscribers WHERE is_active = 1');
  const counts: Record<string, number> = { draft: 0, published: 0, archived: 0 };
  for (const row of byStatus) counts[row.status] = Number(row.c);
  return {
    posts: { ...counts, total: counts.draft + counts.published + counts.archived },
    totalViews: Number(views?.t ?? 0),
    pendingComments: Number(pending?.c ?? 0),
    subscribers: Number(subscribers?.c ?? 0),
  };
}

/** Published, indexable posts for sitemap.xml. */
export async function sitemapPosts() {
  return q<{ slug: string; updated_at: string }>(
    `SELECT slug, updated_at FROM blog_posts WHERE status = 'published'
     AND (published_at IS NULL OR published_at <= ?) AND noindex = 0 ORDER BY updated_at DESC`,
    [nowIso()],
  );
}

/** True when a stored file is referenced by any blog post (cover or content). */
export async function mediaReferencedByBlog(fileId: string): Promise<boolean> {
  const needle = `%${fileId}%`;
  const row = await one<any>(
    'SELECT id FROM blog_posts WHERE cover_url LIKE ? OR content LIKE ? LIMIT 1',
    [needle, needle],
  );
  return Boolean(row);
}
