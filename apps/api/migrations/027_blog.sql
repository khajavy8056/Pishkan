-- 027: blog / content management (1.4.0)
-- WordPress-style articles with categories, tags, SEO fields, moderated
-- comments and a newsletter list. Access is permission-based (blog.*):
-- the seeded «مدیر محتوا» role owns this section, and any other role can be
-- granted the same permissions from the role editor.
CREATE TABLE IF NOT EXISTS blog_categories (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT,
  icon TEXT,
  color TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS blog_posts (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  subtitle TEXT,
  excerpt TEXT,
  content TEXT NOT NULL DEFAULT '',
  category_id TEXT REFERENCES blog_categories(id) ON DELETE SET NULL,
  tags TEXT NOT NULL DEFAULT '[]',
  cover_url TEXT,
  cover_alt TEXT,
  author_id TEXT NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'draft',          -- draft | published | archived
  published_at TEXT,                              -- future value = scheduled
  seo_title TEXT,
  seo_description TEXT,
  canonical_url TEXT,
  noindex INTEGER NOT NULL DEFAULT 0,
  allow_comments INTEGER NOT NULL DEFAULT 1,
  featured INTEGER NOT NULL DEFAULT 0,
  reading_minutes INTEGER NOT NULL DEFAULT 1,
  views_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_blog_posts_public ON blog_posts(status, published_at);
CREATE INDEX IF NOT EXISTS ix_blog_posts_author ON blog_posts(author_id, status);
CREATE INDEX IF NOT EXISTS ix_blog_posts_category ON blog_posts(category_id);

CREATE TABLE IF NOT EXISTS blog_comments (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL REFERENCES blog_posts(id) ON DELETE CASCADE,
  parent_id TEXT REFERENCES blog_comments(id) ON DELETE CASCADE,
  author_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  author_name TEXT NOT NULL,
  author_email TEXT,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',        -- pending | approved | rejected | spam
  reviewed_by TEXT,
  reviewed_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_blog_comments_post ON blog_comments(post_id, status, created_at);
CREATE INDEX IF NOT EXISTS ix_blog_comments_status ON blog_comments(status, created_at);

CREATE TABLE IF NOT EXISTS blog_subscribers (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
