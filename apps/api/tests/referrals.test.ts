import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { adminSession, app, newCustomer } from './helpers.js';
import { one, run } from '../src/db/index.js';
import { updateSettings } from '../src/modules/settings/service.js';

let server: Awaited<ReturnType<typeof app>>;
let admin: any;
const randomMobile = () => `0936${Math.floor(1000000 + Math.random() * 8999999)}`;
const password = 'Customer#12345';
async function makeCampaign(params: Record<string, unknown> = {}) {
  const response = await request(server).post('/api/referrals/admin').set('Cookie',admin.cookie).send({title:'دعوت دوستان',threshold:2,rewardAmount:250000,maxRewards:5,isActive:true,...params}).expect(201);
  return response.body.data;
}
async function link(campaignId: string, session:any) {
  const response = await request(server).post(`/api/referrals/mine/${campaignId}/link`).set('Cookie',session.cookie).expect(200);
  return response.body.data.token as string;
}
async function verifyMobile(session:any) {
  const sent = await request(server).post('/api/auth/mobile/verify/request').set('Cookie',session.cookie).send({confirm:true}).expect(200);
  expect(sent.body.data.debugCode).toBeTruthy();
  await request(server).post('/api/auth/mobile/verify/confirm').set('Cookie',session.cookie).send({code:sent.body.data.debugCode}).expect(200);
}
async function passwordSignup(code: string) {
  const mobile = randomMobile();
  const reg = await request(server).post('/api/auth/register').send({mobile,password,fullName:'کاربر جدید',referralCode:code}).expect(201);
  const cookie = reg.headers['set-cookie'] as unknown as string[];
  return {mobile,session:{cookie}};
}
describe('referral campaigns', () => {
  beforeAll(async () => { server=await app(); admin=await adminSession(); await updateSettings({'wallet.enabled':true,'auth.customer_auto_register_otp':true,'auth.customer_require_mobile_verification':false}, {id:'system',name:'test'}, {confirmCritical:true}); });
  it('counts only newly created accounts with verified mobiles and credits once, even on retries', async () => {
    const inviter=await newCustomer('دعوت کننده'); await run('UPDATE users SET mobile_verified=1 WHERE id=?',[inviter.id]);
    const campaign=await makeCampaign();
    const code=await link(campaign.id,inviter.session);
    expect(await link(campaign.id,inviter.session)).toBe(code);
    const a=await passwordSignup(code), b=await passwordSignup(code);
    let mine=await request(server).get('/api/referrals/mine').set('Cookie',inviter.session.cookie).expect(200);
    expect(mine.body.data.find((x:any)=>x.id===campaign.id).qualified).toBe(0);
    await verifyMobile(a.session);
    mine=await request(server).get('/api/referrals/mine').set('Cookie',inviter.session.cookie).expect(200);
    expect(mine.body.data.find((x:any)=>x.id===campaign.id).qualified).toBe(1);
    expect(Number((await one<any>('SELECT COUNT(*) AS n FROM referral_rewards WHERE campaign_id=?',[campaign.id]))!.n)).toBe(0);
    await verifyMobile(b.session);
    const results=await Promise.all([1,2,3].map(()=>request(server).post(`/api/referrals/admin/${campaign.id}/retry`).set('Cookie',admin.cookie).send({inviterId:inviter.id})));
    expect(results.every(r=>r.status===200)).toBe(true);
    const wallet=await request(server).get('/api/wallet/my').set('Cookie',inviter.session.cookie).expect(200);
    expect(wallet.body.data.balance).toBe(250000);
    expect(Number((await one<any>('SELECT COUNT(*) AS n FROM referral_rewards WHERE campaign_id=?',[campaign.id]))!.n)).toBe(1);
    expect(Number((await one<any>("SELECT COUNT(*) AS n FROM wallet_transactions WHERE customer_id=? AND type='gift'",[inviter.id]))!.n)).toBe(1);
  });
  it('attributes OTP auto-registration but never attaches an existing account or itself', async () => {
    const inviter=await newCustomer(); await run('UPDATE users SET mobile_verified=1 WHERE id=?',[inviter.id]);
    const campaign=await makeCampaign({threshold:1}); const code=await link(campaign.id,inviter.session);
    const mobile=randomMobile();
    const sent=await request(server).post('/api/auth/otp/request').send({mobile,kind:'customer'}).expect(200);
    await request(server).post('/api/auth/otp/verify').send({mobile,code:sent.body.data.debugCode,kind:'customer',referralCode:code}).expect(200);
    expect(Number((await one<any>('SELECT COUNT(*) AS n FROM referral_rewards WHERE campaign_id=?',[campaign.id]))!.n)).toBe(1);
    const sentExisting=await request(server).post('/api/auth/otp/request').send({mobile:inviter.mobile,kind:'customer'}).expect(200);
    await request(server).post('/api/auth/otp/verify').send({mobile:inviter.mobile,code:sentExisting.body.data.debugCode,kind:'customer',referralCode:code}).expect(200);
    expect(Number((await one<any>('SELECT COUNT(*) AS n FROM referral_attributions WHERE invitee_id=?',[inviter.id]))!.n)).toBe(0);
  });
  it('enforces campaign capacity and rejects invalid referral without creating an account', async () => {
    const inviter=await newCustomer(); await run('UPDATE users SET mobile_verified=1 WHERE id=?',[inviter.id]);
    const campaign=await makeCampaign({threshold:1,maxRewards:1}); const code=await link(campaign.id,inviter.session);
    const mobile=randomMobile();
    await request(server).post('/api/auth/register').send({mobile,password,fullName:'آزمون نامعتبر',referralCode:'invalid_token_12345'}).expect(400);
    expect(await one('SELECT id FROM users WHERE mobile=?',[mobile])).toBeNull();
    const a=await passwordSignup(code); await verifyMobile(a.session);
    await request(server).post('/api/auth/register').send({mobile:randomMobile(),password,fullName:'کاربر ظرفیت',referralCode:code}).expect(400);
    await request(server).post('/api/referrals/admin').set('Cookie',inviter.session.cookie).send({title:'x'}).expect(403);
  });
  it('keeps verification successful when wallet is frozen and allows an idempotent administrator retry', async () => {
    const inviter=await newCustomer(); await run('UPDATE users SET mobile_verified=1 WHERE id=?',[inviter.id]);
    const c=await makeCampaign({threshold:1}); const code=await link(c.id,inviter.session);
    await request(server).get('/api/wallet/my').set('Cookie',inviter.session.cookie).expect(200);
    await run("UPDATE wallets SET status='frozen' WHERE customer_id=?",[inviter.id]);
    const invitee=await passwordSignup(code);
    await verifyMobile(invitee.session);
    expect(Number((await one<any>('SELECT COUNT(*) AS n FROM referral_rewards WHERE campaign_id=?',[c.id]))!.n)).toBe(0);
    const status=await request(server).get(`/api/referrals/admin/${c.id}/progress`).set('Cookie',admin.cookie).expect(200);
    expect(Number(status.body.data.find((x:any)=>x.inviterId===inviter.id).qualified)).toBe(1);
    await run("UPDATE wallets SET status='active' WHERE customer_id=?",[inviter.id]);
    const retry=await request(server).post(`/api/referrals/admin/${c.id}/retry`).set('Cookie',admin.cookie).send({inviterId:inviter.id}).expect(200);
    expect(retry.body.data.paid).toBe(true);
    const again=await request(server).post(`/api/referrals/admin/${c.id}/retry`).set('Cookie',admin.cookie).send({inviterId:inviter.id}).expect(200);
    expect(again.body.data.reason).toBe('already_paid');
    expect(Number((await one<any>('SELECT balance FROM wallets WHERE customer_id=?',[inviter.id]))!.balance)).toBe(250000);
  });
  it('does not spend a valid OTP on an invalid referral before an account exists', async () => {
    const mobile=randomMobile();
    const sent=await request(server).post('/api/auth/otp/request').send({mobile,kind:'customer'}).expect(200);
    await request(server).post('/api/auth/otp/verify').send({mobile,code:sent.body.data.debugCode,kind:'customer',referralCode:'invalid_token_12345'}).expect(400);
    const withoutReferral=await request(server).post('/api/auth/otp/verify').send({mobile,code:sent.body.data.debugCode,kind:'customer'}).expect(200);
    expect(withoutReferral.body.data.isNewUser).toBe(true);
  });
  it('caps rewards across two simultaneous qualifying inviters', async () => {
    const a=await newCustomer(), b=await newCustomer();
    await run('UPDATE users SET mobile_verified=1 WHERE id=? OR id=?',[a.id,b.id]);
    const c=await makeCampaign({threshold:1,maxRewards:1});
    const ia=await passwordSignup(await link(c.id,a.session));
    const ib=await passwordSignup(await link(c.id,b.session));
    await Promise.all([verifyMobile(ia.session),verifyMobile(ib.session)]);
    expect(Number((await one<any>('SELECT COUNT(*) AS n FROM referral_rewards WHERE campaign_id=?',[c.id]))!.n)).toBe(1);
    expect(Number((await one<any>('SELECT paid_count AS n FROM referral_campaigns WHERE id=?',[c.id]))!.n)).toBe(1);
  });

});
