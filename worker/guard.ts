/* 문지기. 주소는 열려 있다. 주인이 열쇠를 걸어 두면 그때만 열쇠를 본다.
   모델 호출은 돈이라 하루 몫은 열쇠와 상관없이 지킨다. */

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
  // 열쇠를 안 걸어 둔 주소는 그냥 열린다. 잠그고 싶을 때만 ACCESS_KEY를 넣는다
  if (!accessKey) return;
  const got = unwrap(req.headers.get('x-sona-key') ?? '');
  if (!got || !(await same(got, accessKey))) {
    throw new Fail(401, 'bad_key', '열쇠가 맞지 않아요.');
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const isUuid = (s: unknown): s is string => typeof s === 'string' && UUID.test(s);

export function visitorOf(req: Request): string {
  const v = req.headers.get('x-sona-visitor') ?? '';
  if (!isUuid(v)) throw new Fail(400, 'no_visitor', '방문자 정보가 없어요. 새로 고친 뒤 다시 시도해 주세요.');
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
    throw new Fail(429, 'budget', '오늘 사용할 수 있는 횟수를 모두 썼어요. 내일 다시 이용해 주세요.');
  }
}
