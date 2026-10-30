import { describe, expect, it } from 'vitest';
import { parseDbDriver } from '../src/env.js';

describe('database driver configuration', () => {
  it('accepts only known drivers and prohibits SQLite in production', () => {
    expect(parseDbDriver('postgres', 'production')).toBe('postgres');
    expect(parseDbDriver('sqlite', 'test')).toBe('sqlite');
    expect(() => parseDbDriver('postgress', 'production')).toThrow(/Invalid DB_DRIVER/);
    expect(() => parseDbDriver('sqlite', 'production')).toThrow(/production requires PostgreSQL/);
  });
});
