/* 문지기. 열쇠가 없으면 아무것도 안 열린다 — 모델 호출은 돈이고 하루 몫이 있다. */

import { RULES } from '../shared/rules';
import type { Db } from './db';
import { Fail } from './engine/ctx';

async function digest(s: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
}

/** 길이와 내용을 흘리지 않게 해시끼리 견준다 */
async function same(a: string, b: string): Promise<boolean> {
  const [x, y] = await Promise.all([digest(a), digest(b)]);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i]! ^ y[i]!;
  return diff === 0;
}

/** 화면은 열쇠를 싸서 보낸다(한글 열쇠도 되게). 못 풀면 빈 열쇠로 본다 */
function unwrap(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return '';
  }
}

export async function checkKey(req: Request, accessKey: string | undefined): Promise<void> {
  // 열쇠를 안 걸어 둔 배포는 열지 않는다
  if (!accessKey) {
    throw new Fail(503, 'no_key_set', '이 주소는 아직 잠겨 있어. Cloudflare에서 이 Worker의 변수와 시크릿에 ACCESS_KEY를 넣으면 열려.');
  }
  const got = unwrap(req.headers.get('x-sona-key') ?? '');
  if (!got || !(await same(got, accessKey))) {
    throw new Fail(401, 'bad_key', '열쇠가 맞지 않아.');
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const isUuid = (s: unknown): s is string => typeof s === 'string' && UUID.test(s);

export function visitorOf(req: Request): string {
  const v = req.headers.get('x-sona-visitor') ?? '';
  if (!isUuid(v)) throw new Fail(400, 'no_visitor', '방문자 표가 없어.');
  return v;
}

/** 모델을 부르기 전에 하루 몫에서 덜어 낸다 */
export async function spend(db: Db, now: number, n = 1): Promise<void> {
  const day = new Date(now).toISOString().slice(0, 10);
  await db.run(
    'INSERT INTO usage (day, who, calls) VALUES (?, ?, ?) ON CONFLICT(day, who) DO UPDATE SET calls = calls + ?',
    day,
    'all',
    n,
    n,
  );
  const row = await db.first<{ calls: number }>('SELECT calls FROM usage WHERE day = ? AND who = ?', day, 'all');
  if ((row?.calls ?? 0) > RULES.dailyCalls) {
    throw new Fail(429, 'budget', '오늘 쓸 수 있는 몫을 다 썼어. 내일 다시 와 줘.');
  }
}
