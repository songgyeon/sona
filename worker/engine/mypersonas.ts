/* 내 페르소나 — 플레이하는 사람이 여러 개 만들어 두고, 필름마다 하나를 골라 들어간다(entry.ts의 chooseAs).
   이름, 사진, 소개. 이 기기(방문자)에 묶인다.
   입장권에 적은 내 이름이 있고 페르소나가 하나도 없으면, 그 이름으로 첫 페르소나를 만든다. */

import { RULES } from '../../shared/rules';
import type { MyPersona } from '../../shared/types';
import { newId } from '../db';
import { type Ctx, Fail } from './ctx';
import { image, text } from './films';
import { myName } from './me';

interface Row {
  id: string;
  name: string;
  line: string;
  face: string;
}

/** 화면에서 온 것을 읽는다 */
function read(input: unknown): Omit<MyPersona, 'id'> {
  const o = (input && typeof input === 'object' ? input : {}) as { name?: unknown; line?: unknown; face?: unknown };
  return {
    name: text(o.name, 20, '페르소나의 이름', true),
    line: text(o.line, RULES.limits.persona, '페르소나 소개'),
    face: image(o.face, '페르소나'),
  };
}

/** 내 페르소나들. 먼저 만든 것부터 */
export async function listPersonas(ctx: Ctx): Promise<MyPersona[]> {
  let rows = await ctx.db.all<Row>('SELECT id, name, line, face FROM mypersonas WHERE visitor = ? ORDER BY created_at, rowid', ctx.visitor);
  if (rows.length === 0) {
    // 입장권에 적은 이름으로 첫 페르소나를 만든다
    const name = await myName(ctx.db, ctx.visitor);
    if (name) {
      const now = ctx.now();
      await ctx.db.run('INSERT INTO mypersonas (id, visitor, name, line, face, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)', newId(), ctx.visitor, name, '', '', now, now);
      rows = await ctx.db.all<Row>('SELECT id, name, line, face FROM mypersonas WHERE visitor = ? ORDER BY created_at, rowid', ctx.visitor);
    }
  }
  return rows;
}

export async function addPersona(ctx: Ctx, input: unknown): Promise<MyPersona[]> {
  const p = read(input);
  const have = await listPersonas(ctx);
  if (have.length >= RULES.personas.max) throw new Fail(409, 'personas_full', `페르소나는 ${RULES.personas.max}개까지 만들 수 있어요.`);
  const now = ctx.now();
  await ctx.db.run('INSERT INTO mypersonas (id, visitor, name, line, face, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)', newId(), ctx.visitor, p.name, p.line, p.face, now, now);
  return listPersonas(ctx);
}

export async function editPersona(ctx: Ctx, id: string, input: unknown): Promise<MyPersona[]> {
  const p = read(input);
  const row = await ctx.db.first<{ id: string }>('SELECT id FROM mypersonas WHERE id = ? AND visitor = ?', id, ctx.visitor);
  if (!row) throw new Fail(404, 'persona_missing', '페르소나를 찾을 수 없어요.');
  await ctx.db.run('UPDATE mypersonas SET name = ?, line = ?, face = ?, updated_at = ? WHERE id = ?', p.name, p.line, p.face, ctx.now(), id);
  return listPersonas(ctx);
}

export async function dropPersona(ctx: Ctx, id: string): Promise<MyPersona[]> {
  await ctx.db.run('DELETE FROM mypersonas WHERE id = ? AND visitor = ?', id, ctx.visitor);
  return listPersonas(ctx);
}

/** 내 페르소나 하나 */
export async function getPersona(ctx: Ctx, id: string): Promise<MyPersona | null> {
  return ctx.db.first<Row>('SELECT id, name, line, face FROM mypersonas WHERE id = ? AND visitor = ?', id, ctx.visitor);
}
