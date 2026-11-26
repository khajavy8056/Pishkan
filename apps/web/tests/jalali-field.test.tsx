import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SiteProvider } from '../src/lib/site';
import { JalaliDateField } from '../src/components/JalaliDateField';
import { fetchMock } from './setup';

/**
 * The date field the office asked for: «both the value and the calendar that
 * opens must be Shamsi». These assert the whole loop — the value shown, the grid
 * that opens, the ISO string that leaves the component — because a picker that
 * *looks* Persian while emitting the wrong day is exactly the failure mode that
 * shipping `locale: fa` on a Gregorian calendar would have produced.
 */

const FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const toFa = (value: string) => value.replace(/\d/g, (d) => FA_DIGITS[Number(d)]);
const toEn = (value: string) => value.replace(/[۰-۹]/g, (d) => String(FA_DIGITS.indexOf(d)));

function renderField(props: Partial<React.ComponentProps<typeof JalaliDateField>> = {}, settings: Record<string, string> = {}) {
  fetchMock.mockImplementation(async (input: RequestInfo) => {
    const path = String(input).replace(/^https?:\/\/[^/]+/, '');
    if (path.startsWith('/api/public/bootstrap')) {
      return {
        ok: true, status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({
          ok: true,
          data: {
            version: '1.0.0-test',
            settings: { 'site.name': 'تک پیشخوان', ...settings },
            categories: [], popularServices: [], newestServices: [],
            authMethods: { otp: true, password: true }, maintenance: false,
          },
        }),
      } as unknown as Response;
    }
    return {
      ok: false, status: 404, headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ ok: false, error: 'not_found' }),
    } as unknown as Response;
  });
  const onChange = vi.fn();
  const view = render(
    <SiteProvider>
      <MemoryRouter initialEntries={['/']}>
        <JalaliDateField label="تاریخ سررسید" value={null} onChange={onChange} {...props} />
      </MemoryRouter>
    </SiteProvider>,
  );
  return { ...view, onChange };
}

/** The numbered cells of the open month (nav/clear/today buttons have labels). */
function dayButtons(dialog: HTMLElement) {
  return within(dialog)
    .getAllByRole('button')
    .filter((button) => /^[۰-۹]{1,2}$/.test(button.textContent ?? ''));
}

function clickDay(dialog: HTMLElement, day: number) {
  const button = dayButtons(dialog).find((cell) => toEn(cell.textContent ?? '') === String(day));
  if (!button) throw new Error(`روز ${day} در تقویم پیدا نشد`);
  fireEvent.click(button);
}

beforeEach(() => { fetchMock.mockReset(); });
afterEach(() => { fetchMock.mockReset(); });

async function openPicker() {
  fireEvent.click(screen.getByRole('button', { name: 'باز کردن تقویم شمسی' }));
  return screen.findByTestId('jalali-calendar') as Promise<HTMLElement>;
}

describe('jalali date field', () => {
  it('shows the stored ISO date as a Persian one', () => {
    const { onChange } = renderField({ value: '2025-11-22' });
    const input = screen.getByLabelText('تاریخ سررسید') as HTMLInputElement;
    expect(input.value).toBe(toFa('1404/09/01'));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('opens a Shamsi month, not a Gregorian one', async () => {
    renderField({ value: '2025-11-22' });
    const dialog = await openPicker();
    // The header names the Jalali month of the stored date: 22 November 2025 is
    // Azar 1 of 1404, and Azar is a 30-day month. A Gregorian grid would show
    // 31 cells for a November view, so this fails loudly on any regression.
    expect(within(dialog).getByText(toFa('آذر 1404'))).toBeTruthy();
    expect(dayButtons(dialog).length).toBe(30);
  });

  it('emits the ISO day the person clicked', async () => {
    const { onChange } = renderField({ value: '2025-11-22' });
    const dialog = await openPicker();
    clickDay(dialog, 12);
    // Azar 12 of 1404 = 3 December 2025.
    await waitFor(() => expect(onChange).toHaveBeenCalledWith('2025-12-03'));
  });

  it('parses a typed Persian date and refuses to invent one', () => {
    const { onChange } = renderField();
    const input = screen.getByLabelText('تاریخ سررسید') as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: toFa('1404/09/01') } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenCalledWith('2025-11-22');
    expect(screen.queryByRole('alert')).toBeNull();

    // A 31st of a 30-day month is rejected in Persian, not rolled into Azar.
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: toFa('1404/08/31') } });
    fireEvent.blur(input);
    expect(screen.getByRole('alert').textContent).toContain('تاریخ شمسی معتبر نیست');
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('clears to empty, which is what the filters need', () => {
    const { onChange } = renderField({ value: '2025-11-22' });
    fireEvent.click(screen.getByRole('button', { name: 'پاک کردن تاریخ' }));
    expect(onChange).toHaveBeenCalledWith('');
  });

  it('steps a month at a time and keeps min in force', async () => {
    const { onChange } = renderField({ value: '2025-11-22', min: '2025-11-20' });
    const dialog = await openPicker();
    fireEvent.click(within(dialog).getByRole('button', { name: 'ماه قبل' }));
    expect(within(dialog).getByText(toFa('آبان 1404'))).toBeTruthy();
    // 20 November 2025 is Aban 29, so Aban 1..28 are out of range.
    expect(dayButtons(dialog).filter((cell) => cell.disabled).length).toBe(28);
    clickDay(dialog, 30);
    await waitFor(() => expect(onChange).toHaveBeenCalledWith('2025-11-21'));
  });

  it('falls back to the native field when the office chose Gregorian', async () => {
    renderField({ value: '2025-11-22' }, { 'site.calendar': 'gregorian' });
    await waitFor(() => expect(screen.getByLabelText('تاریخ سررسید').getAttribute('type')).toBe('date'));
    expect(screen.queryByRole('button', { name: 'باز کردن تقویم شمسی' })).toBeNull();
  });
});
