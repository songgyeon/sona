import { describe, expect, it } from 'vitest';
import { RULES } from '../../shared/rules';
import { Fail } from '../../worker/engine/ctx';
import { checkKey, spend, visitorOf } from '../../worker/guard';
import { memoryDb } from '../helpers/db';

const req = (headers: Record<string, string>) => new Request('https://sona.test/api/films', { headers });

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'ok';
  } catch (e) {
    if (e instanceof Fail) return e.code;
    throw e;
  }
}

describe('문지기', () => {
  it('맞는 열쇠만 통과한다', async () => {
    expect(await code(checkKey(req({ 'x-sona-key': 'dev' }), 'dev'))).toBe('ok');
    expect(await code(checkKey(req({ 'x-sona-key': 'de' }), 'dev'))).toBe('bad_key');
    expect(await code(checkKey(req({}), 'dev'))).toBe('bad_key');
  });

  it('한글 열쇠는 싸서 온 것을 풀어 견준다', async () => {
    const wrapped = encodeURIComponent('필름 열쇠');
    expect(await code(checkKey(req({ 'x-sona-key': wrapped }), '필름 열쇠'))).toBe('ok');
    expect(await code(checkKey(req({ 'x-sona-key': '%E0%A4%A' }), '필름 열쇠'))).toBe('bad_key');
  });

  it('열쇠를 안 걸어 둔 배포는 열지 않는다', async () => {
    expect(await code(checkKey(req({ 'x-sona-key': '' }), undefined))).toBe('no_key_set');
    expect(await code(checkKey(req({ 'x-sona-key': 'anything' }), ''))).toBe('no_key_set');
  });

  it('방문자 표가 없으면 받지 않는다', () => {
    expect(() => visitorOf(req({}))).toThrow(Fail);
    expect(visitorOf(req({ 'x-sona-visitor': '11111111-1111-4111-8111-111111111111' }))).toBe(
      '11111111-1111-4111-8111-111111111111',
    );
  });

  it('하루 몫을 넘으면 모델을 부르지 않는다', async () => {
    const db = memoryDb();
    const now = Date.UTC(2026, 10, 11, 3, 0, 0);
    await db.run('INSERT INTO usage (day, who, calls) VALUES (?, ?, ?)', '2026-11-11', 'all', RULES.dailyCalls - 1);
    expect(await code(spend(db, now))).toBe('ok');
    expect(await code(spend(db, now))).toBe('budget');
    // 날이 바뀌면 다시 쓸 수 있다
    expect(await code(spend(db, now + 24 * 3600 * 1000))).toBe('ok');
  });
});
