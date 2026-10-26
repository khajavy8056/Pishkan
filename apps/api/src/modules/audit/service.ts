import { q, run, one, nowIso, jsonStringify, jsonParse } from '../../db/index.js';
import { id } from '../../lib/crypto.js';

export interface AuditInput {
  actorId?: string | null;
  actorName?: string | null;
  action: string;
  entityType?: string;
  entityId?: string;
  before?: unknown;
  after?: unknown;
  ip?: string;
}

/** Sensitive records for every privileged action. Never throws into the request path. */
export async function writeAudit(input: AuditInput): Promise<void> {
  try {
    await run(
      `INSERT INTO audit_logs (id, actor_id, actor_name, action, entity_type, entity_id, before_data, after_data, ip, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id('aud'),
        input.actorId ?? null,
        input.actorName ?? null,
        input.action,
        input.entityType ?? null,
        input.entityId ?? null,
        input.before === undefined ? null : jsonStringify(input.before),
        input.after === undefined ? null : jsonStringify(input.after),
        input.ip ?? null,
        nowIso(),
      ],
    );
  } catch (err) {
    console.error('[audit] failed to persist audit entry', err);
  }
}

export async function listAudit(params: {
  page: number; pageSize: number; action?: string; entityType?: string; actorId?: string;
}) {
  const where: string[] = [];
  const args: any[] = [];
  if (params.action) { where.push('action LIKE ?'); args.push(`%${params.action}%`); }
  if (params.entityType) { where.push('entity_type = ?'); args.push(params.entityType); }
  if (params.actorId) { where.push('actor_id = ?'); args.push(params.actorId); }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = await one<{ c: number }>(`SELECT COUNT(*) AS c FROM audit_logs ${clause}`, args);
  const rows = await q(
    `SELECT * FROM audit_logs ${clause} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    [...args, params.pageSize, (params.page - 1) * params.pageSize],
  );
  return {
    items: rows.map((r) => ({
      id: r.id,
      actorId: r.actor_id,
      actorName: r.actor_name,
      action: r.action,
      entityType: r.entity_type,
      entityId: r.entity_id,
      before: jsonParse<any>(r.before_data, null),
      after: jsonParse<any>(r.after_data, null),
      ip: r.ip,
      createdAt: r.created_at,
    })),
    total: Number(total?.c ?? 0),
  };
}

export async function pruneAudit(days: number): Promise<number> {
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
  const res = await run('DELETE FROM audit_logs WHERE created_at < ?', [cutoff]);
  return res.changes;
}
