import { describe, expect, it } from 'vitest';
import { AUTOFILL_HINT_KEY, claimAutofillHint } from '../src/lib/autofillHint';

/**
 * Whether the «از پروفایل پر کنید» hint is allowed to appear.
 *
 * These four cases are the whole agreement with the office, and each one has a
 * way to go wrong that a reviewer would not notice:
 *  * showing twice is the nag they told us not to build;
 *  * showing on an empty profile is a promise the button cannot keep;
 *  * burning the flag on a form with nothing to fill would deny the hint to the
 *    same person forever, even after they complete their profile;
 *  * throwing on a browser with storage disabled would take the form down with it.
 */
describe('autofill hint gate', () => {
  const store = () => {
    const data = new Map<string, string>();
    return {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => { data.set(key, value); },
      data,
    };
  };

  it('appears once and never again, whether or not it was used', () => {
    const storage = store();
    expect(claimAutofillHint(3, storage)).toBe(true);
    // Ignoring it is an answer. The button it points at stays available either way.
    expect(claimAutofillHint(3, storage)).toBe(false);
    expect(storage.data.get(AUTOFILL_HINT_KEY), 'recorded, so a reload does not bring it back').toBeTruthy();
  });

  it('stays quiet when there is nothing to fill — and keeps the hint for later', () => {
    const storage = store();
    expect(claimAutofillHint(0, storage)).toBe(false);
    expect(storage.data.size, 'an empty form must not burn the one allowed showing').toBe(0);
    // …so after the profile gains a value, the hint is still owed to them.
    expect(claimAutofillHint(2, storage)).toBe(true);
  });

  it('gives up silently when storage is unavailable', () => {
    const hostile = {
      getItem: () => { throw new Error('SecurityError: storage disabled'); },
      setItem: () => { throw new Error('QuotaExceededError'); },
    };
    expect(() => claimAutofillHint(4, hostile)).not.toThrow();
    expect(claimAutofillHint(4, hostile)).toBe(false);
    expect(claimAutofillHint(4, null)).toBe(false);
  });
});
