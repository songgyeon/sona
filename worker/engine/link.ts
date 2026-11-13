/* 다른 기기에서 이어 하기. 쓰던 기기에서 코드를 받고(makeLink), 새 기기에서 넣으면(claimLink) 같은 방문자가 된다.
   코드는 RULES.link.minutes분 안에 한 번만 쓴다. 저장소에는 코드의 해시만 둔다.
   코드를 넣은 기기에서 쓰던 것(필름, 삶, 페르소나, 이름, 올린 그림과 소리, 서버에 맞춰 둔 임시저장)은 코드를 받은 쪽으로 합친다.
   코드를 받은 기기의 임시저장은 코드와 함께도 실어 나른다 — 서버는 싸 온 그대로 건네기만 한다. */

import { RULES } from '../../shared/rules';
import { q, type Stmt } from '../db';
import { type Ctx, Fail } from './ctx';

/** 헷갈리는 글자(0과 O, 1과 I와 L)는 뺀다 */
const ABC = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** 사람이 친 코드를 같은 모양으로: 대문자, 글자와 숫자만 */
export const normCode = (s: string): string => s.toUpperCase().replace(/[^A-Z0-9]/g, '');

async function hashOf(code: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`sona-link:${code}`)));
  return Array.from(d, (b) => b.toString(16).padStart(2, '0')).join('');
}

function newCode(): string {
  const out: string[] = [];
  const r = new Uint8Array(1);
  while (out.length < RULES.link.length) {
    crypto.getRandomValues(r);
    // 고르게 뽑으려고 31의 배수 밖의 값은 버린다
    if (r[0]! < 248) out.push(ABC[r[0]! % ABC.length]!);
  }
  return out.join('');
}

/** 코드를 받는다. 이 기기의 임시저장을 함께 맡겨 두면 코드를 넣은 기기로 건너간다 */
export async function makeLink(ctx: Ctx, input: unknown): Promise<{ code: string; expiresAt: number }> {
  const raw = input && typeof input === 'object' ? (input as { drafts?: unknown }).drafts : undefined;
  const drafts = typeof raw === 'string' ? raw : '';
  if (drafts.length > RULES.link.drafts) throw new Fail(413, 'drafts_big', '임시저장이 너무 커서 옮길 수 없어요.');
  const now = ctx.now();
  const code = newCode();
  const expiresAt = now + RULES.link.minutes * 60_000;
  await ctx.db.batch([
    // 지난 코드는 치운다
    q('DELETE FROM links WHERE expires_at < ?', now),
    q('INSERT INTO links (code_hash, visitor, drafts, created_at, expires_at, used_at) VALUES (?, ?, ?, ?, ?, NULL)', await hashOf(code), ctx.visitor, drafts, now, expiresAt),
  ]);
  return { code, expiresAt };
}

/** 코드를 넣는다. 이 기기는 코드를 받은 기기와 같은 방문자가 되고, 이 기기에서 쓰던 것은 그쪽으로 합친다 */
export async function claimLink(ctx: Ctx, input: unknown): Promise<{ visitor: string; name: string; drafts: string }> {
  const raw = input && typeof input === 'object' ? (input as { code?: unknown }).code : undefined;
  const code = typeof raw === 'string' ? normCode(raw) : '';
  const bad = () => new Fail(400, 'bad_code', '코드가 맞지 않거나 시간이 지났어요.');
  if (code.length !== RULES.link.length) throw bad();
  const hash = await hashOf(code);
  const now = ctx.now();
  const row = await ctx.db.first<{ visitor: string; drafts: string; expires_at: number; used_at: number | null }>(
    'SELECT visitor, drafts, expires_at, used_at FROM links WHERE code_hash = ?',
    hash,
  );
  if (!row || row.used_at !== null || row.expires_at < now) throw bad();

  const to = row.visitor;
  const stmts: Stmt[] = [q('UPDATE links SET used_at = ? WHERE code_hash = ? AND used_at IS NULL', now, hash)];
  if (to !== ctx.visitor) stmts.push(...(await mergeInto(ctx, ctx.visitor, to, now)));
  await ctx.db.batch(stmts);

  const name = (await ctx.db.first<{ name: string }>('SELECT name FROM visitors WHERE id = ?', to))?.name ?? '';
  return { visitor: to, name, drafts: row.drafts };
}

interface PersonaRow {
  id: string;
  name: string;
  line: string;
  face: string;
}

/** from의 것을 to로 옮기는 문장들. 한 번에 돌린다 */
async function mergeInto(ctx: Ctx, from: string, to: string, now: number): Promise<Stmt[]> {
  const out: Stmt[] = [];

  // 내 페르소나: 이름·소개·사진이 똑같은 것은 한 사람이다. to의 것을 남기고, from의 자리들이 그것을 가리키게 한다
  const mine = await ctx.db.all<PersonaRow>('SELECT id, name, line, face FROM mypersonas WHERE visitor = ?', from);
  const theirs = await ctx.db.all<PersonaRow>('SELECT id, name, line, face FROM mypersonas WHERE visitor = ?', to);
  for (const p of mine) {
    const same = theirs.find((t) => t.name === p.name && t.line === p.line && t.face === p.face);
    if (!same) continue;
    out.push(q('UPDATE personas SET persona_id = ? WHERE visitor = ? AND persona_id = ?', same.id, from, p.id));
    out.push(q('DELETE FROM mypersonas WHERE id = ?', p.id));
  }
  out.push(q('UPDATE mypersonas SET visitor = ? WHERE visitor = ?', to, from));

  // 필름마다 고른 사람: 같은 필름에 둘 다 있으면 to의 것을 둔다
  out.push(q('DELETE FROM personas WHERE visitor = ? AND film_id IN (SELECT film_id FROM personas WHERE visitor = ?)', from, to));
  out.push(q('UPDATE personas SET visitor = ? WHERE visitor = ?', to, from));

  // 서버에 맞춰 둔 임시저장. 같은 자리가 둘 다 있으면 받은 쪽 것을 둔다
  out.push(q('DELETE FROM drafts WHERE visitor = ? AND id IN (SELECT id FROM drafts WHERE visitor = ?)', from, to));
  out.push(q('UPDATE drafts SET visitor = ? WHERE visitor = ?', to, from));

  // 만든 필름, 사는 삶, 올린 그림과 소리
  out.push(q('UPDATE films SET owner = ? WHERE owner = ?', to, from));
  out.push(q('UPDATE plays SET owner = ? WHERE owner = ?', to, from));
  out.push(q('UPDATE images SET owner = ? WHERE owner = ?', to, from));
  out.push(q('UPDATE media SET owner = ? WHERE owner = ?', to, from));

  // 이름: to에 이름이 없을 때만 from의 이름을 가져간다
  out.push(
    q(
      'INSERT INTO visitors (id, name, created_at, updated_at) SELECT ?, name, created_at, ? FROM visitors WHERE id = ? ON CONFLICT(id) DO NOTHING',
      to,
      now,
      from,
    ),
  );
  out.push(q('DELETE FROM visitors WHERE id = ?', from));
  return out;
}
