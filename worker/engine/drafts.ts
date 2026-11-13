/* 임시저장을 서버에도 둔다. 원본은 기기의 저장소이고, 서버는 사람(방문자)마다 한 벌을 맞춰 둔다 —
   다른 기기에서 이어 하기로 같은 사람이 되면 어느 기기에서든 보인다(src/drafts.ts의 syncDrafts).
   같은 자리는 나중에 남긴 쪽이 이긴다. 지운 것은 지운 표시(dropped)로 남겨 다른 기기에서도 지운다.
   서버는 임시저장을 읽지 않고 맡아 두기만 한다. */

import { DRAFT_ID, type DraftItem } from '../../shared/draft';
import { RULES } from '../../shared/rules';
import { q, type Stmt } from '../db';
import { type Ctx, Fail } from './ctx';

export async function listDrafts(ctx: Ctx): Promise<DraftItem[]> {
  const rows = await ctx.db.all<{ id: string; raw: string; saved_at: number; dropped: number }>(
    'SELECT id, raw, saved_at, dropped FROM drafts WHERE visitor = ?',
    ctx.visitor,
  );
  return rows.map((r) => ({ id: r.id, raw: r.raw, savedAt: r.saved_at, dropped: r.dropped === 1 }));
}

/** 기기에서 바뀐 자리들을 받는다. 서버에 있는 것보다 먼저 남긴 것은 버린다 */
export async function putDrafts(ctx: Ctx, input: unknown): Promise<{ ok: true }> {
  const bad = () => new Fail(400, 'bad_drafts', '임시저장을 맞추지 못했어요.');
  const list = input && typeof input === 'object' ? (input as { items?: unknown }).items : undefined;
  if (!Array.isArray(list) || list.length > RULES.drafts.batch) throw bad();
  const stmts: Stmt[] = [];
  for (const it of list) {
    if (!it || typeof it !== 'object') throw bad();
    const { id, raw, savedAt, dropped } = it as Record<string, unknown>;
    if (typeof id !== 'string' || !DRAFT_ID.test(id) || typeof savedAt !== 'number' || !Number.isFinite(savedAt) || savedAt <= 0) throw bad();
    const gone = dropped === true;
    const body = gone || typeof raw !== 'string' ? '' : raw;
    if (!gone) {
      if (body.length > RULES.drafts.size) throw new Fail(413, 'draft_big', '임시저장이 너무 커서 맞추지 못했어요.');
      let ok = false;
      try {
        const o = JSON.parse(body) as { draft?: unknown } | null;
        ok = !!o && typeof o === 'object' && !!o.draft && typeof o.draft === 'object';
      } catch {
        ok = false;
      }
      if (!ok) throw bad();
    }
    stmts.push(
      q(
        `INSERT INTO drafts (visitor, id, raw, saved_at, dropped) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(visitor, id) DO UPDATE SET raw = excluded.raw, saved_at = excluded.saved_at, dropped = excluded.dropped
         WHERE excluded.saved_at >= drafts.saved_at`,
        ctx.visitor,
        id,
        body,
        Math.round(savedAt),
        gone ? 1 : 0,
      ),
    );
  }
  await ctx.db.batch(stmts);
  return { ok: true };
}
