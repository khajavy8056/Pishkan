-- Add starter tips once to installations still using system starter stories.
-- An office which removed all of them is left alone; edits and deletions are
-- never undone at startup. Fresh databases receive these from the seed script.
INSERT INTO app_stories (id, group_title, title, caption, media_type, media_url, duration_seconds, sort_order, status, created_by, created_at, updated_at)
SELECT 'story_starter_motion_033', 'خدمات جدید', 'آشنایی با خدمات پیشخوان', 'خدمت مورد نظرتان را از دسته‌بندی‌ها پیدا کنید و جزئیات آن را ببینید.', 'video', '/app-stories/story-services-motion.mp4', 7, 5, 'published', 'system', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
WHERE EXISTS (SELECT 1 FROM app_stories WHERE created_by = 'system');
INSERT INTO app_stories (id, group_title, title, caption, media_type, media_url, duration_seconds, sort_order, status, created_by, created_at, updated_at)
SELECT 'story_starter_photo_033', 'راهنما', 'عکس واضح از مدارک', 'در نور کافی، بدون لرزش و از نزدیک عکس بگیرید. مدارک پس از ارسال به بررسی کارشناس نیاز دارند.', 'image', '/app-stories/story-documents.jpg', 7, 6, 'published', 'system', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
WHERE EXISTS (SELECT 1 FROM app_stories WHERE created_by = 'system');
INSERT INTO app_stories (id, group_title, title, caption, media_type, media_url, duration_seconds, sort_order, status, created_by, created_at, updated_at)
SELECT 'story_starter_delivery_033', 'راهنما', 'فایل تحویلی و پیام‌ها', 'در جزئیات درخواست، پیام کارشناس و فایل تحویلی را ببینید و فایل را در گوشی ذخیره کنید.', 'image', '/app-stories/story-tracking.jpg', 7, 7, 'published', 'system', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
WHERE EXISTS (SELECT 1 FROM app_stories WHERE created_by = 'system');
-- Existing installations have settings already. Mark their starter stories as
-- initialized even if the office intentionally deleted every story.
INSERT INTO settings (key, value, group_name, is_secret, updated_at)
SELECT 'internal.starter_stories_initialized', 'true', 'internal', 0, CURRENT_TIMESTAMP
WHERE EXISTS (SELECT 1 FROM settings) AND NOT EXISTS (SELECT 1 FROM settings WHERE key = 'internal.starter_stories_initialized');
