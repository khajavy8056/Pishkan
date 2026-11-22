import { Router } from 'express';
import { z } from 'zod';
import { asyncRoute, requireAuth, requirePermission } from '../http/middleware.js';
import { forbidden } from '../http/errors.js';
import { created, ok, pagination } from '../http/respond.js';
import { param } from '../http/params.js';
import { officeScope } from '../lib/scope.js';
import { writeAudit } from '../modules/audit/service.js';
import { campaignProgress, createCampaign, issueLink, listCampaigns, myCampaigns, payReward, setCampaignActive } from '../modules/referrals/service.js';
import { run, nowIso } from '../db/index.js';

export const referralsRouter = Router();
referralsRouter.use(requireAuth);
const customer = (req:any) => { if (req.auth.user.kind !== 'customer') throw forbidden('این بخش مخصوص مشتریان است.'); };
const office = (req:any) => { if (!officeScope(req.auth)) throw forbidden('این عملیات نیازمند دسترسی دفتر است.'); };
referralsRouter.get('/mine', asyncRoute(async(req,res) => { customer(req); ok(res,await myCampaigns(req.auth!.user.id)); }));
referralsRouter.post('/mine/:id/link', asyncRoute(async(req,res) => { customer(req); ok(res,await issueLink(param(req,'id'),req.auth!.user.id)); }));
referralsRouter.get('/admin', requirePermission('discounts.view'), requirePermission('wallet.view'), asyncRoute(async(req,res) => { office(req); ok(res,await listCampaigns()); }));
referralsRouter.post('/admin', requirePermission('discounts.create'), requirePermission('wallet.credit'), asyncRoute(async(req,res) => {
  office(req);
  const body = z.object({title:z.string().trim().min(3).max(120),threshold:z.number().int().min(1).max(10000),rewardAmount:z.number().int().min(1).max(100000000),maxRewards:z.number().int().min(1).max(1000000),startsAt:z.string().datetime().nullable().optional(),expiresAt:z.string().datetime().nullable().optional(),isActive:z.boolean().optional()}).parse(req.body);
  const c = await createCampaign(body);
  await writeAudit({actorId:req.auth!.user.id,actorName:req.auth!.user.fullName,action:'referral.campaign.create',entityType:'referral_campaign',entityId:c.id,after:body,ip:req.ip});
  created(res,c);
}));
referralsRouter.patch('/admin/:id', requirePermission('discounts.edit'), requirePermission('wallet.credit'), asyncRoute(async(req,res) => {
  office(req); const body=z.object({isActive:z.boolean()}).strict().parse(req.body);
  const c=await setCampaignActive(param(req,'id'),body.isActive);
  await writeAudit({actorId:req.auth!.user.id,actorName:req.auth!.user.fullName,action:'referral.campaign.toggle',entityType:'referral_campaign',entityId:c.id,after:body,ip:req.ip}); ok(res,c);
}));
referralsRouter.get('/admin/:id/progress', requirePermission('discounts.view'),requirePermission('wallet.view'),asyncRoute(async(req,res) => { office(req); const {page,pageSize}=pagination(req,{pageSize:50}); const result=await campaignProgress(param(req,'id'),page,pageSize); ok(res,result.items,{total:result.total,page,pageSize}); }));
referralsRouter.post('/admin/:id/retry', requirePermission('discounts.edit'),requirePermission('wallet.credit'),asyncRoute(async(req,res) => {
  office(req); const body=z.object({inviterId:z.string().min(3).max(80)}).parse(req.body);
  await run(`UPDATE referral_attributions SET qualified_at=? WHERE campaign_id=? AND inviter_id=? AND qualified_at IS NULL AND EXISTS (SELECT 1 FROM users u WHERE u.id=referral_attributions.invitee_id AND u.mobile_verified=1 AND u.kind='customer')`,[nowIso(),param(req,'id'),body.inviterId]);
  const result=await payReward(param(req,'id'),body.inviterId);
  await writeAudit({actorId:req.auth!.user.id,actorName:req.auth!.user.fullName,action:'referral.reward.retry',entityType:'referral_campaign',entityId:param(req,'id'),after:{inviterId:body.inviterId,...result},ip:req.ip}); ok(res,result);
}));
