/** Read-only mobile-browser test against a built app served by a disposable LAN API.
 * SMOKE_LAN_URL=http://192.168.x.x:2981 npm run test:lan-browser --workspace apps/web
 * Use a non-loopback IP: localhost is treated as a secure context and masks this bug.
 */
import assert from 'node:assert/strict';
import chromium from '@sparticuz/chromium';
import { chromium as playwright, devices } from 'playwright-core';

const base = process.env.SMOKE_LAN_URL;
assert(base, 'Set SMOKE_LAN_URL to the disposable server non-loopback HTTP address');
const url = new URL(base);
assert(url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname), 'Use a non-loopback HTTP URL');
const browser = await playwright.launch({
  executablePath: process.env.CHROMIUM_PATH ?? await chromium.executablePath(),
  // The package defaults disable browser security, which would hide CSP bugs.
  args: chromium.args.filter((arg) => !arg.includes('disable-web-security') && !arg.includes('allow-running-insecure-content')),
  headless: true,
});
try {
  const context = await browser.newContext({ ...devices['Pixel 7'] });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('requestfailed', (request) => {
    if (new URL(request.url()).origin === url.origin || request.url().startsWith(`https://${url.host}/`)) {
      errors.push(`${request.url()}: ${request.failure()?.errorText}`);
    }
  });
  page.on('console', (message) => {
    if (message.type() === 'error' && /content security policy|refused to (load|execute)/i.test(message.text())) errors.push(message.text());
  });
  const response = await page.goto(base, { waitUntil: 'networkidle' });
  assert(response?.ok(), 'landing response is successful');
  assert.equal(await page.evaluate(() => window.isSecureContext), false, 'test must use an insecure LAN origin');
  await page.getByText('ثبت درخواست خدمت').first().waitFor();
  await page.getByRole('heading', { name: 'دسته‌بندی خدمات' }).waitFor();
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'landing does not overflow');
  await page.goto(new URL('/login', base).href, { waitUntil: 'networkidle' });
  await page.getByLabel('نام کاربری، موبایل یا ایمیل').waitFor();
  await page.goto(new URL('/register', base).href, { waitUntil: 'networkidle' });
  assert((await page.locator('#root').innerText()).length > 100, 'registration page is rendered');
  assert.deepEqual(errors, [], 'no JavaScript, same-origin resource or CSP failures');
  console.log('PASS: mobile Chromium loads LAN HTTP landing, login and registration with CSP enabled.');
} finally {
  await browser.close();
}
