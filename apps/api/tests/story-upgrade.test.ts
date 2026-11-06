import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { app } from './helpers.js';
import { one, run } from '../src/db/index.js';
import { seedDefaultStories } from '../src/modules/mobile/service.js';

const sql = readFileSync(join(process.cwd(), 'migrations', '033_extra_starter_stories.sql'), 'utf8');
function database() {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE app_stories (id TEXT PRIMARY KEY, group_title TEXT, title TEXT, caption TEXT, media_type TEXT, media_url TEXT,
    duration_seconds INTEGER, sort_order INTEGER, status TEXT, created_by TEXT, created_at TEXT, updated_at TEXT);
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT, group_name TEXT, is_secret INTEGER, updated_at TEXT);`);
  return db;
}
describe('starter story upgrades', () => {
  it('adds tips once only where system stories are still present, preserving custom content', () => {
    const db = database();
    try {
      db.exec("INSERT INTO settings VALUES ('existing','yes','site',0,'2020'); INSERT INTO app_stories (id,title,created_by) VALUES ('office','custom','admin'),('starter','old','system');");
      db.exec(sql);
      expect(db.prepare('SELECT COUNT(*) AS n FROM app_stories').get()?.n).toBe(5);
      expect(db.prepare("SELECT title FROM app_stories WHERE id='office'").get()?.title).toBe('custom');
      expect(db.prepare("SELECT media_type FROM app_stories WHERE id='story_starter_motion_033'").get()?.media_type).toBe('video');
      expect(db.prepare("SELECT value FROM settings WHERE key='internal.starter_stories_initialized'").get()?.value).toBe('true');
    } finally { db.close(); }
  });
  it('leaves an existing office without system stories untouched', () => {
    const db = database();
    try {
      db.exec("INSERT INTO settings VALUES ('existing','yes','site',0,'2020'); INSERT INTO app_stories (id,title,created_by) VALUES ('office','custom','admin');");
      db.exec(sql);
      expect(db.prepare('SELECT COUNT(*) AS n FROM app_stories').get()?.n).toBe(1);
      expect(db.prepare("SELECT value FROM settings WHERE key='internal.starter_stories_initialized'").get()?.value).toBe('true');
    } finally { db.close(); }
  });
  it('seeds a fresh office once and never recreates stories intentionally removed later', async () => {
    await app();
    expect(await seedDefaultStories()).toBe(7);
    expect(Number((await one<{ n: number }>('SELECT COUNT(*) AS n FROM app_stories'))?.n)).toBe(7);
    await run('DELETE FROM app_stories');
    expect(await seedDefaultStories()).toBe(0);
    expect(Number((await one<{ n: number }>('SELECT COUNT(*) AS n FROM app_stories'))?.n)).toBe(0);
  });
});
