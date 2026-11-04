-- 029: story body text (1.4.0)
-- Full-screen stories in the customer app show a short body/caption under the
-- title, like the approved design ("اکنون می‌توانید ... را به صورت غیرحضوری
-- ثبت کنید"). Managed from the same «اپ اندروید» admin section.

ALTER TABLE app_stories ADD COLUMN caption TEXT;
