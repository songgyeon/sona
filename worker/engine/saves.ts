/* 장면 저장 — 그때의 삶을 통째로 남겨 두고, 거기서 다시 산다.
   저장한 장면은 저마다 그때의 모습을 다 들고 있다. 그래서 어느 장면으로 돌아가도 다른 장면은 그대로다.
   돌아가면 그 뒤의 이야기는 지워진다. 대신 돌아가기 직전의 장면을 「돌아가기 전」 자리에 저절로 남긴다(삶마다 한 자리). */

import { RULES } from '../../shared/rules';
import type { PlayView, SaveView } from '../../shared/types';
import { newId, q, type Stmt } from '../db';
import { type Ctx, Fail } from './ctx';
import { lastTurn, loadPlay, viewOf } from './store';

/** 삶에 딸린 표들. 저장하고 되돌릴 때 이 표들의 줄을 통째로 옮긴다 */
const TABLES = ['turns', 'messages', 'events', 'posts', 'asides'] as const;
/** 삶 줄에서 저장하는 칸 */
const PLAY_COLS = ['film', 'elapsed', 'ended', 'days', 'place', 'pose'] as const;

type Row = Record<string, unknown>;
interface Snapshot {
  play: Row;
  rows: Record<string, Row[]>;
}

/** 지금 삶의 모습을 통째로 읽는다. 줄은 들어간 차례 그대로다 */
async function snapshot(ctx: Ctx, playId: string): Promise<Snapshot> {
  const play = (await ctx.db.first<Row>(`SELECT ${PLAY_COLS.join(', ')} FROM plays WHERE id = ?`, playId))!;
  const rows: Record<string, Row[]> = {};
  for (const t of TABLES) rows[t] = await ctx.db.all<Row>(`SELECT * FROM ${t} WHERE play_id = ? ORDER BY rowid`, playId);
  return { play, rows };
}

/** 저장해 둔 모습으로 되돌리는 문장들. 줄마다 넣지 않고 표마다 한 번에 넣는다(json_each) —
    줄마다 넣으면 한 번에 부를 수 있는 수를 넘는다 */
function restore(playId: string, snap: Snapshot): Stmt[] {
  const out: Stmt[] = [];
  for (const t of TABLES) {
    out.push(q(`DELETE FROM ${t} WHERE play_id = ?`, playId));
    const list = snap.rows[t] ?? [];
    if (list.length === 0) continue;
    const cols = Object.keys(list[0]!);
    const pick = cols.map((c) => `json_extract(value, '$.${c}')`).join(', ');
    out.push(q(`INSERT INTO ${t} (${cols.join(', ')}) SELECT ${pick} FROM json_each(?)`, JSON.stringify(list)));
  }
  out.push(q(`UPDATE plays SET ${PLAY_COLS.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`, ...PLAY_COLS.map((c) => snap.play[c] ?? null), playId));
  return out;
}

/** 저장 한 자리를 적는 문장. 목록에 보일 것(때, 곳, 마지막 말)을 함께 적는다 */
function saveStmt(ctx: Ctx, playId: string, snap: Snapshot, auto: boolean): Stmt {
  const said = (snap.rows.messages ?? []).filter((m) => m.kind !== 'aside');
  const last = said[said.length - 1];
  const line = last ? String(last.text ?? '').split('\n')[0]!.slice(0, 80) : '';
  return q(
    'INSERT INTO saves (id, play_id, at, place, line, auto, snapshot, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    newId(),
    playId,
    Number(snap.play.elapsed ?? 0),
    String(snap.play.place ?? ''),
    line,
    auto ? 1 : 0,
    JSON.stringify(snap),
    ctx.now(),
  );
}

/** 저장한 장면들. 최근에 저장한 것부터 */
export async function listSaves(ctx: Ctx, playId: string): Promise<SaveView[]> {
  await loadPlay(ctx, playId);
  const rows = await ctx.db.all<{ id: string; at: number; place: string; line: string; auto: number; created_at: number }>(
    'SELECT id, at, place, line, auto, created_at FROM saves WHERE play_id = ? ORDER BY created_at DESC, rowid DESC',
    playId,
  );
  return rows.map((r) => ({ id: r.id, at: r.at, place: r.place, line: r.line, auto: r.auto === 1, savedAt: r.created_at }));
}

/** 지금 장면을 저장한다. 대사를 다 받은 뒤에만 */
export async function makeSave(ctx: Ctx, playId: string): Promise<SaveView[]> {
  await loadPlay(ctx, playId);
  const last = await lastTurn(ctx.db, playId);
  if (last && last.status !== 'done') throw new Fail(409, 'stuck', '대사를 다 받은 뒤에 저장할 수 있어요.');
  const count = await ctx.db.first<{ n: number }>('SELECT COUNT(*) AS n FROM saves WHERE play_id = ? AND auto = 0', playId);
  if ((count?.n ?? 0) >= RULES.saves.max) throw new Fail(409, 'saves_full', `장면은 ${RULES.saves.max}개까지 저장할 수 있어요. 하나를 지우고 저장해 주세요.`);
  await ctx.db.batch([saveStmt(ctx, playId, await snapshot(ctx, playId), false)]);
  return listSaves(ctx, playId);
}

/** 저장한 장면으로 돌아간다. 지금 장면은 「돌아가기 전」 자리에 남긴다 */
export async function loadSave(ctx: Ctx, playId: string, saveId: string): Promise<PlayView> {
  await loadPlay(ctx, playId);
  const row = await ctx.db.first<{ snapshot: string }>('SELECT snapshot FROM saves WHERE id = ? AND play_id = ?', saveId, playId);
  if (!row) throw new Fail(404, 'save_missing', '저장한 장면을 찾을 수 없어요.');
  const then = JSON.parse(row.snapshot) as Snapshot;
  const now = await snapshot(ctx, playId);
  await ctx.db.batch([q('DELETE FROM saves WHERE play_id = ? AND auto = 1', playId), saveStmt(ctx, playId, now, true), ...restore(playId, then)]);
  return viewOf(ctx, playId);
}

/** 저장한 장면을 지운다 */
export async function dropSave(ctx: Ctx, playId: string, saveId: string): Promise<SaveView[]> {
  await loadPlay(ctx, playId);
  await ctx.db.run('DELETE FROM saves WHERE id = ? AND play_id = ?', saveId, playId);
  return listSaves(ctx, playId);
}
