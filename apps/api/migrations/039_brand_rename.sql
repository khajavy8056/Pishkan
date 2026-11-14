-- 039: carry the brand rename to installations that already exist.
--
-- Changing the default in `definitions.ts` only affects a fresh install: the
-- settings table already holds a row for every key, so an office that has been
-- running for a year would keep showing the old name in the header, the page
-- titles, the SMS templates and the splash of the customer app. The brief is
-- explicit that no trace of the old name may remain in the UI, so the stored
-- values have to move too.
--
-- The guard is the important part. Only rows that still hold exactly the old
-- brand string are touched — an office that renamed itself to something of its
-- own keeps its name, and re-running this by hand cannot damage it. Matching is
-- done with LIKE patterns so the two historical spellings (with and without the
-- «پیشخوان» prefix) are both covered.
--
-- app_stories is left alone: it is an archive table and is not rendered.

UPDATE settings SET value = 'تک پیشخوان'
 WHERE key IN ('site.name', 'site.short_name', 'office.name')
   AND (value = 'پیشخوان آرتا' OR value = 'آرتا' OR value = 'پیشخوان');

-- Notification bodies the office wrote by hand can mention the old name; the
-- ones the system generates take their text from the settings above.
UPDATE app_banners SET title = REPLACE(title, 'پیشخوان آرتا', 'تک پیشخوان')
 WHERE title LIKE '%پیشخوان آرتا%';
UPDATE app_banners SET subtitle = REPLACE(subtitle, 'پیشخوان آرتا', 'تک پیشخوان')
 WHERE subtitle LIKE '%پیشخوان آرتا%';
