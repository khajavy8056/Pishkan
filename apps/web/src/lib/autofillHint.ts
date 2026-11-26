/**
 * The one-time «شما می‌توانید این فرم را از پروفایل خود پر کنید» hint.
 *
 * The autofill button has been in the checkout for a long time and is still
 * discovered by almost nobody, so the shortcut is pointed out the first time a
 * person touches the form. This file holds the only part of that which is worth
 * testing: *whether* the hint may appear.
 *
 * The rules the office asked for, in order of how easy they are to break:
 *  1. It never repeats. The flag is written the moment the hint is claimed, not
 *     when it is used — a hint someone ignored has still done its job (they now
 *     know the button exists), and coming back on the next form is what turns a
 *     tip into a nag.
 *  2. It never appears when there is nothing to fill. Note the flag is *not*
 *     written in that case: a person whose profile happens to be empty today
 *     should still get the hint on the day it is not.
 *  3. It survives a storage that is unavailable (private mode, disabled
 *     cookies) by staying silent — a broken `localStorage` must never cost
 *     someone their form.
 */
export const AUTOFILL_HINT_KEY = 'pishkan:autofill-hint:v1';

type HintStorage = { getItem(key: string): string | null; setItem(key: string, value: string): void };

const currentStorage = (): HintStorage | null => {
  try {
    return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null;
  } catch {
    return null;
  }
};

/**
 * Claim the single allowed showing. `true` means "render it"; it returns true at
 * most once per browser.
 */
export function claimAutofillHint(matchCount: number, storage = currentStorage()): boolean {
  if (matchCount <= 0 || !storage) return false;
  try {
    if (storage.getItem(AUTOFILL_HINT_KEY)) return false;
    storage.setItem(AUTOFILL_HINT_KEY, new Date().toISOString());
  } catch {
    return false;
  }
  return true;
}
