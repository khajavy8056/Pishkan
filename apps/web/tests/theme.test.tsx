import { afterEach, beforeEach, expect, it } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../src/lib/auth';
import { SiteProvider } from '../src/lib/site';
import { ToastProvider } from '../src/components/ui';
import { AppShell } from '../src/components/shell';
import {
  THEME_STORAGE_KEY, ThemeProvider, ThemeSegmented, ThemeToggle, setThemeMode, toggleTheme, useTheme,
} from '../src/lib/theme';
import { setAuthUser, setSystemPreference } from './setup';

function Harness({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <AuthProvider>
        <SiteProvider>
          <ToastProvider>
            <MemoryRouter>{children}</MemoryRouter>
          </ToastProvider>
        </SiteProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}

function ModeProbe() {
  const { mode, resolved } = useTheme();
  return <output data-testid="probe">{`${mode}/${resolved}`}</output>;
}

beforeEach(() => {
  window.localStorage.clear();
  setThemeMode('system');
  setSystemPreference(false);
});

afterEach(() => {
  document.documentElement.classList.remove('dark');
});

it('starts in light mode and switches to dark on the compact toggle', async () => {
  setAuthUser({ id: 'u1', kind: 'customer', roleCode: 'customer', fullName: 'مشتری تست', permissions: [] });
  render(<Harness><AppShell variant="customer"><div>محتوا</div></AppShell></Harness>);

  expect(document.documentElement.classList.contains('dark')).toBe(false);

  fireEvent.click(screen.getAllByRole('button', { name: /تغییر به حالت/ })[0]!);

  await waitFor(() => expect(document.documentElement.classList.contains('dark')).toBe(true));
  expect(document.documentElement.dataset.theme).toBe('dark');
  expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
  // The document keeps its content and stays usable after switching.
  expect(screen.getByText('محتوا')).toBeTruthy();
});

it('persists the explicit choice and clears it when the user returns to "system"', () => {
  setThemeMode('dark');
  expect(document.documentElement.classList.contains('dark')).toBe(true);
  expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');

  setThemeMode('system');
  expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
  expect(document.documentElement.classList.contains('dark')).toBe(false);
});

it('follows the operating-system preference while "system" is selected', async () => {
  render(<Harness><ModeProbe /><ThemeSegmented /></Harness>);
  expect(screen.getByTestId('probe').textContent).toBe('system/light');

  act(() => setSystemPreference(true));
  await waitFor(() => expect(screen.getByTestId('probe').textContent).toBe('system/dark'));
  expect(document.documentElement.classList.contains('dark')).toBe(true);

  // Choosing a concrete mode stops following the OS.
  fireEvent.click(screen.getByRole('button', { name: 'روشن' }));
  expect(document.documentElement.classList.contains('dark')).toBe(false);
  act(() => setSystemPreference(false));
  act(() => setSystemPreference(true));
  expect(screen.getByTestId('probe').textContent).toBe('light/light');
});

it('exposes a three-way control with an accessible pressed state', () => {
  render(<Harness><ThemeSegmented /><ThemeToggle /></Harness>);
  const group = screen.getByRole('group', { name: 'حالت نمایش' });
  expect(group).toBeTruthy();
  expect(screen.getByRole('button', { name: 'تیره' }).getAttribute('aria-pressed')).toBe('false');
  fireEvent.click(screen.getByRole('button', { name: 'تیره' }));
  expect(screen.getByRole('button', { name: 'تیره' }).getAttribute('aria-pressed')).toBe('true');
  expect(toggleTheme()).toBe('light');
});
