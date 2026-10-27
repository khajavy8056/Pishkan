/** Opt-in real Chromium smoke test against a disposable local API + built web app.
 * Run from repository root: SMOKE_AUTH_FILE=.data/ui-preview-auth.json npm run test:browser --workspace apps/web
 * Screenshots are local-only under .data/ui-smoke. Never run fixture creation against production.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import chromium from '@sparticuz/chromium';
import {chromium as playwright} from 'playwright-core';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
const base=process.env.SMOKE_BASE_URL??'http://127.0.0.1:3002';
assert(['127.0.0.1','localhost'].includes(new URL(base).hostname),'Use a disposable local server, never production');
assert(process.env.SMOKE_AUTH_FILE,'Set SMOKE_AUTH_FILE to a local ignored JSON file containing username/password');
const credentials=JSON.parse(await fs.readFile(path.resolve(root,process.env.SMOKE_AUTH_FILE),'utf8'));
const out=path.join(root,'.data/ui-smoke');await fs.mkdir(out,{recursive:true});
const browser=await playwright.launch({executablePath:process.env.CHROMIUM_PATH??await chromium.executablePath(),args:chromium.args,headless:true});
const context=await browser.newContext({viewport:{width:1440,height:1024}});
const page=await context.newPage();const errors=[];const unauthorized=[];page.on('response',r=>{if(r.status()===401)unauthorized.push(r.url())});
page.on('pageerror',error=>errors.push(error.message));page.on('console',msg=>{if(msg.type()==='error')console.error(msg.text())});
const screenshot=async(name)=>{await page.evaluate(()=>document.fonts.ready);await page.screenshot({path:path.join(out,`${name}.png`),fullPage:true})};
async function login(username,password){
 await page.goto(`${base}/login?account=staff`);
 await page.getByLabel('نام کاربری، موبایل یا ایمیل').fill(username);
 await page.getByLabel('رمز عبور',{exact:false}).first().fill(password);
 await page.getByRole('button',{name:'ورود',exact:true}).click();
 await page.waitForURL(/\/(admin|staff)(\/accounting)?$/);
}
async function api(method,url,body){const r=await context.request.fetch(`${base}${url}`,{method,data:body});assert(r.ok(),`${method} ${url}: ${r.status()}`);return(await r.json()).data}
try{
 await page.goto(base);await page.getByRole('heading',{name:'ورود به سامانه',exact:true}).waitFor();await screenshot('01-home-desktop');
 await login(credentials.username,credentials.password);
 await page.getByRole('heading',{name:'داشبورد مدیریت',exact:true}).waitFor();await screenshot('02-admin-desktop');
 const stamp=crypto.randomBytes(4).toString('hex');
 const password=`Smoke#${crypto.randomBytes(16).toString('hex')}`;
 const managerPassword=`Manager#${crypto.randomBytes(16).toString('hex')}`;
 const identities={};
 for(const role of ['operator','accountant','manager']){
  const username=`smoke_${role}_${stamp}`;
  await api('POST','/api/staff',{fullName:role==='operator'?'کارمند آزمون مرورگر':role==='accountant'?'حسابدار آزمون مرورگر':'سرپرست آزمون مرورگر',mobile:`09${crypto.randomInt(100000000,999999999)}`,username,password:role==='manager'?managerPassword:password,roleCode:role});identities[role]=username;
 }
 await context.clearCookies();await login(identities.manager,managerPassword);
 await page.getByRole('heading',{name:'داشبورد مدیریت',exact:true}).waitFor();
 await api('POST','/api/catalog/services',{title:`خدمت مدیر ${stamp}`,baseFee:250000,form:[]});
 await api('POST','/api/staff',{fullName:'کارمند ایجادشده توسط مدیر',mobile:`09${crypto.randomInt(100000000,999999999)}`,username:`manager_created_${stamp}`,password,roleCode:'operator'});
 await page.goto(`${base}/admin/settings`);await page.getByRole('heading',{name:'دسترسی به این بخش مجاز نیست',exact:true}).waitFor();await screenshot('03-manager-role-restrictions');
 await context.clearCookies();await login(identities.accountant,password);
 assert(page.url().endsWith('/staff/accounting'));await page.getByRole('heading',{name:'حسابداری',exact:true}).waitFor();await screenshot('04-accountant-desktop');
 await page.goto(`${base}/staff/payroll`);await page.getByRole('heading',{name:'حقوق و سهم کارکنان',exact:true}).waitFor();
 await page.goto(`${base}/admin/settings`);await page.waitForURL('**/staff/accounting');
 await context.clearCookies();await login(identities.operator,password);
 assert(page.url().endsWith('/staff'));await page.getByRole('heading',{name:/میز کار/}).waitFor();await screenshot('05-worker-desktop');
 await page.goto(`${base}/staff/accounting`);await page.getByRole('heading',{name:'دسترسی به این بخش مجاز نیست',exact:true}).waitFor();
 await page.setViewportSize({width:390,height:844});await page.goto(`${base}/staff`);await page.getByRole('heading',{name:/میز کار/}).waitFor();await screenshot('06-worker-mobile');
 assert(await page.locator('nav.mobile-dock').isVisible(),'mobile navigation visible');
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),'no horizontal page overflow');
 await context.clearCookies();await page.goto(base);await screenshot('07-home-mobile');
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),'home does not overflow');
 assert.deepEqual(errors,[],'no browser JavaScript errors');
 console.log('PASS: real Chromium desktop/mobile; shared login; admin/manager/accountant/operator panels; manager creation permissions; payroll; access denial; overflow; no JS errors.');
 console.log('Screenshots: .data/ui-smoke/ (local only).');if(unauthorized.length)console.log('Unauthenticated background probes after logout/role change:',[...new Set(unauthorized.map(u=>new URL(u).pathname))]);
}catch(error){await screenshot('failure');console.error('Browser errors:',errors);console.error('Page:',await page.locator('body').innerText());throw error}finally{await browser.close()}
