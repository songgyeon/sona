/* 내 이름. 처음 들어올 때 입장권에 적는다.
   필름마다 이 이름으로 들어갈 수 있다(entry.ts의 chooseAs). 이 기기(방문자)에 묶인다. */

import { RULES } from '../../shared/rules';
import type { Db } from '../db';
import { type Ctx, Fail } from './ctx';

/** 이 방문자의 이름. 정하지 않았으면 빈 글자 */
export async function myName(db: Db, visitor: string): Promise<string> {
  const row = await db.first<{ name: string }>('SELECT name FROM visitors WHERE id = ?', visitor);
  return row?.name ?? '';
}

export async function getMe(ctx: Ctx): Promise<{ name: string }> {
  return { name: await myName(ctx.db, ctx.visitor) };
}

/** 이름을 정하거나 바꾼다. 앞뒤 빈칸을 걷고, 가운데 빈칸은 하나로 줄인다 */
export async function setMe(ctx: Ctx, input: unknown): Promise<{ name: string }> {
  const raw = input && typeof input === 'object' ? (input as { name?: unknown }).name : undefined;
  const name = typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim() : '';
  if (!name) throw new Fail(400, 'empty_name', '이름을 입력해 주세요.');
  if ([...name].length > RULES.limits.myName) throw new Fail(400, 'long_name', `이름은 ${RULES.limits.myName}자까지 쓸 수 있어요.`);
  const now = ctx.now();
  await ctx.db.run(
    'INSERT INTO visitors (id, name, created_at, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name, updated_at = excluded.updated_at',
    ctx.visitor,
    name,
    now,
    now,
  );
  return { name };
}
