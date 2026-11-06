import { one, q, run, nowIso, tx } from '../../db/index.js';
import { id, randomToken } from '../../lib/crypto.js';
import { badRequest, conflict, forbidden, notFound } from '../../http/errors.js';
import { ensureWallet, moveMoney } from '../wallet/service.js';
import { getBool } from '../settings/service.js';
import { writeAudit } from '../audit/service.js';

type Campaign = { id: string; title: string; threshold: number; reward_amount: number; max_rewards: number; paid_count: number; starts_at: string | null; expires_at: string | null; is_active: number };
function active(c: Campaign) { const now = nowIso(); return Boolean(c.is_active) && (!c.starts_at || c.starts_at <= now) && (!c.expires_at || c.expires_at >= now) && Number(c.paid_count) < Number(c.max_rewards); }
function campaignDto(c: Campaign) { return { id: c.id, title: c.title, threshold: Number(c.threshold), rewardAmount: Number(c.reward_amount), maxRewards: Number(c.max_rewards), paidCount: Number(c.paid_count), startsAt: c.starts_at, expiresAt: c.expires_at, isActive: Boolean(c.is_active), accepting: active(c) }; }

export async function listCampaigns() { return (await q<Campaign>('SELECT * FROM referral_campaigns ORDER BY created_at DESC')).map(campaignDto); }
export async function createCampaign(input: { title: string; threshold: number; rewardAmount: number; maxRewards: number; startsAt?: string | null; expiresAt?: string | null; isActive?: boolean }) {
  if (input.startsAt && input.expiresAt && input.startsAt > input.expiresAt) throw badRequest('تاریخ پایان باید بعد از تاریخ شروع باشد.');
  const ts = nowIso(), campaignId = id('rcp');
  await run(`INSERT INTO referral_campaigns(id,title,threshold,reward_amount,max_rewards,starts_at,expires_at,is_active,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?)`, [campaignId,input.title,input.threshold,input.rewardAmount,input.maxRewards,input.startsAt ?? null,input.expiresAt ?? null,input.isActive ? 1 : 0,ts,ts]);
  return campaignDto((await one<Campaign>('SELECT * FROM referral_campaigns WHERE id=?',[campaignId]))!);
}
export async function setCampaignActive(campaignId: string, enabled: boolean) {
  const result = await run('UPDATE referral_campaigns SET is_active=?,updated_at=? WHERE id=?', [enabled ? 1 : 0,nowIso(),campaignId]);
  if (!result.changes) throw notFound('کمپین یافت نشد.');
  return campaignDto((await one<Campaign>('SELECT * FROM referral_campaigns WHERE id=?',[campaignId]))!);
}
export async function myCampaigns(userId: string) {
  const rows = await q<Campaign & { qualified: number; rewarded: number; token: string | null }>(`SELECT c.*,
    (SELECT COUNT(*) FROM referral_attributions a WHERE a.campaign_id=c.id AND a.inviter_id=? AND a.qualified_at IS NOT NULL) AS qualified,
    (SELECT COUNT(*) FROM referral_rewards r WHERE r.campaign_id=c.id AND r.inviter_id=?) AS rewarded,
    (SELECT token FROM referral_links l WHERE l.campaign_id=c.id AND l.inviter_id=?) AS token
    FROM referral_campaigns c WHERE c.is_active=1 OR EXISTS (SELECT 1 FROM referral_links l WHERE l.campaign_id=c.id AND l.inviter_id=?) ORDER BY c.created_at DESC`,[userId,userId,userId,userId]);
  return rows.map(c => ({...campaignDto(c), qualified: Number(c.qualified), rewarded: Boolean(c.rewarded), token: c.token}));
}
export async function issueLink(campaignId: string, userId: string) {
  return tx(async () => {
    const c = await one<Campaign>('SELECT * FROM referral_campaigns WHERE id=?',[campaignId]);
    if (!c || !active(c)) throw badRequest('کمپین اکنون فعال نیست یا ظرفیت آن تکمیل شده است.');
    const user = await one<any>("SELECT * FROM users WHERE id=? AND kind='customer'",[userId]);
    if (!user || !user.mobile_verified || user.status !== 'active') throw forbidden('برای دعوت، حساب فعال و شماره موبایل تأییدشده لازم است.');
    await run('INSERT INTO referral_links(id,campaign_id,inviter_id,token,created_at) VALUES(?,?,?,?,?) ON CONFLICT(campaign_id,inviter_id) DO NOTHING', [id('rfl'),campaignId,userId,randomToken(18),nowIso()]);
    const link = await one<{ token: string }>('SELECT token FROM referral_links WHERE campaign_id=? AND inviter_id=?',[campaignId,userId]);
    return { token: link!.token };
  });
}
/** Only called as part of creating a NEW customer, in the same transaction. */
export async function validateReferral(token: string, mobile: string) {
  const link = await one<any>(`SELECT l.campaign_id,l.inviter_id,u.mobile,u.mobile_verified,u.status,c.* FROM referral_links l
    JOIN users u ON u.id=l.inviter_id JOIN referral_campaigns c ON c.id=l.campaign_id WHERE l.token=?`, [token]);
  if (!link || !active(link) || !link.mobile_verified || link.status !== 'active') throw badRequest('لینک دعوت معتبر نیست یا کمپین فعال نیست.');
  if (link.mobile === mobile) throw badRequest('دعوت خود مجاز نیست.');
  return link;
}
export async function recordAttribution(token: string | undefined, inviteeId: string, mobile: string) {
  if (!token) return;
  const link = await validateReferral(token, mobile);
  if (link.inviter_id === inviteeId) throw badRequest('دعوت خود مجاز نیست.');
  await run('INSERT INTO referral_attributions(id,campaign_id,inviter_id,invitee_id,created_at) VALUES(?,?,?,?,?)', [id('rfa'),link.campaign_id,link.inviter_id,inviteeId,nowIso()]);
}
/** Mark verification durably first. Payout is separately retryable and must
 * never turn successful phone verification into a failed registration. */
export async function qualifyInvitation(inviteeId: string) {
  const row = await tx(async () => {
    const user = await one<any>("SELECT mobile_verified FROM users WHERE id=? AND kind='customer'",[inviteeId]);
    if (!user?.mobile_verified) return null;
    await run('UPDATE referral_attributions SET qualified_at=? WHERE invitee_id=? AND qualified_at IS NULL',[nowIso(),inviteeId]);
    return one<{campaign_id:string;inviter_id:string}>('SELECT campaign_id,inviter_id FROM referral_attributions WHERE invitee_id=? AND qualified_at IS NOT NULL',[inviteeId]);
  });
  if (row) await payReward(row.campaign_id,row.inviter_id);
}
export async function payReward(campaignId: string, inviterId: string) {
  return tx(async () => {
    // Serializes all reward attempts for a campaign including its budget.
    await run('UPDATE referral_campaigns SET paid_count=paid_count WHERE id=?',[campaignId]);
    const c = await one<Campaign>('SELECT * FROM referral_campaigns WHERE id=?',[campaignId]);
    if (!c) throw notFound('کمپین یافت نشد.');
    if (await one('SELECT id FROM referral_rewards WHERE campaign_id=? AND inviter_id=?',[campaignId,inviterId])) return { paid: false, reason: 'already_paid' };
    const total = await one<{n:number}>('SELECT COUNT(*) AS n FROM referral_attributions WHERE campaign_id=? AND inviter_id=? AND qualified_at IS NOT NULL',[campaignId,inviterId]);
    if (Number(total?.n ?? 0) < Number(c.threshold)) return {paid:false,reason:'threshold'};
    // Pausing or expiry stops NEW attributions, not earned payouts. A capped
    // campaign keeps the pending claim visible for administrative review.
    if (Number(c.paid_count) >= Number(c.max_rewards)) return {paid:false,reason:'budget'};
    if (!(await getBool('wallet.enabled'))) throw conflict('کیف پول غیرفعال است.');
    const wallet = await ensureWallet(inviterId);
    await run('UPDATE wallets SET balance=balance WHERE id=?',[wallet.id]);
    const moved = await moveMoney({customerId:inviterId, amount:Number(c.reward_amount), direction:'credit',type:'gift',source:'system',idempotencyKey:`referral:${campaignId}:${inviterId}`,reason:'پاداش دعوت دوستان',description:`پاداش کمپین ${c.title}`});
    if (!moved.applied) throw conflict('تراکنش پاداش موجود است اما ثبت کمپین آن یافت نشد؛ بررسی مالی لازم است.');
    await run('INSERT INTO referral_rewards(id,campaign_id,inviter_id,amount,wallet_transaction_id,created_at) VALUES(?,?,?,?,?,?)',[id('rfr'),campaignId,inviterId,c.reward_amount,moved.transaction.id,nowIso()]);
    await run('UPDATE referral_campaigns SET paid_count=paid_count+1,updated_at=? WHERE id=?',[nowIso(),campaignId]);
    await writeAudit({actorId:inviterId,actorName:'system',action:'referral.reward',entityType:'referral_campaign',entityId:campaignId,after:{inviterId,amount:c.reward_amount,transactionId:moved.transaction.id}});
    return {paid:true,reason:'paid'};
  });
}
export async function campaignProgress(campaignId:string, page:number, pageSize:number) {
  const total = await one<{n:number}>('SELECT COUNT(*) AS n FROM referral_links WHERE campaign_id=?',[campaignId]);
  const items = await q<any>(`SELECT l.inviter_id AS "inviterId", u.full_name AS "inviterName", u.mobile AS "inviterMobile",
    (SELECT COUNT(*) FROM referral_attributions a WHERE a.campaign_id=l.campaign_id AND a.inviter_id=l.inviter_id AND a.qualified_at IS NOT NULL) AS qualified,
    (SELECT COUNT(*) FROM referral_rewards r WHERE r.campaign_id=l.campaign_id AND r.inviter_id=l.inviter_id) AS rewarded
    FROM referral_links l JOIN users u ON u.id=l.inviter_id WHERE l.campaign_id=? ORDER BY l.created_at DESC LIMIT ? OFFSET ?`,[campaignId,pageSize,(page-1)*pageSize]);
  return {items,total:Number(total?.n ?? 0)};
}
