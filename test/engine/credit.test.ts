import { describe, expect, it } from 'vitest';
import { fromFilm, readDraft, toFilm } from '../../shared/draft';
import { readFilm } from '../../shared/opening';
import { fillFilm } from '../../shared/roles';
import { RULES } from '../../shared/rules';
import type { Film } from '../../shared/types';
import { Fail } from '../../worker/engine/ctx';
import { createFilm, getFilm, parseFilm } from '../../worker/engine/films';
import { skip } from '../../worker/engine/skip';
import { viewOf } from '../../worker/engine/store';
import { enter, say } from '../../worker/engine/turn';
import { FAKE_DEFAULTS } from '../../worker/model/fake';
import { DEV_FILM, OTHER_VISITOR, VISITOR, testCtx, uid } from '../helpers/film';

/* 캐스트 프로필의 배역 소개: 나이·직업·대표 대사. 적지 않아도 되는 칸이다.
   나이와 직업은 프로필의 배역 줄에 서고 대사 모델도 읽는다. 대표 대사는 프로필에만 선다.
   임시 필름의 한서(c1)에게만 적어 둔다. 지후(c2)의 칸은 비어 있다. */
const CREDIT = { age: '29세', job: '골목 서점 주인', quote: '책은 사람을 안 떠나요.' };
const EMPTY = { age: '', job: '', quote: '' };

const FILM = {
  ...DEV_FILM,
  opens: { feed: true, ping: true, aside: true },
  casts: [{ ...DEV_FILM.casts[0], ...CREDIT }, DEV_FILM.casts[1]],
};

async function fail(p: () => unknown): Promise<Fail | null> {
  try {
    await p();
  } catch (e) {
    if (e instanceof Fail) return e;
    throw e;
  }
  return null;
}

describe('캐스트의 나이·직업·대표 대사', () => {
  it('적지 않아도 개봉된다. 적으면 앞뒤 빈칸만 떼고 그대로 남는다', () => {
    expect(parseFilm(DEV_FILM).casts[0]).toMatchObject(EMPTY);
    const film = parseFilm({ ...FILM, casts: [{ ...FILM.casts[0], quote: `  ${CREDIT.quote}\n` }, FILM.casts[1]] });
    expect(film.casts[0]).toMatchObject(CREDIT);
    expect(film.casts[1]).toMatchObject(EMPTY);
  });

  it('칸의 길이를 넘으면 어느 칸인지 말하고 거절한다', async () => {
    const L = RULES.limits;
    for (const [key, max, name] of [
      ['age', L.age, '나이'],
      ['job', L.job, '직업'],
      ['quote', L.quote, '대표 대사'],
    ] as const) {
      const f = await fail(() => parseFilm({ ...FILM, casts: [{ ...FILM.casts[0], [key]: '가'.repeat(max + 1) }, FILM.casts[1]] }));
      expect(f?.code).toBe('film_invalid');
      expect(f?.message).toContain(name);
      expect(parseFilm({ ...FILM, casts: [{ ...FILM.casts[0], [key]: '가'.repeat(max) }, FILM.casts[1]] }).casts[0]![key]).toHaveLength(max);
    }
  });

  it('누구에게나 보인다 — 링크로 온 사람의 필름 정보에도, 재생하는 화면에도', async () => {
    const ctx = testCtx();
    const { id } = await createFilm(ctx, FILM);
    expect((await getFilm({ ...ctx, visitor: OTHER_VISITOR }, id)).film.casts[0]).toMatchObject(CREDIT);
    const v = await enter(ctx, id, uid());
    expect(v.film.casts[0]).toMatchObject(CREDIT);
    expect((await viewOf(ctx, v.id)).film.casts[0]).toMatchObject(CREDIT);
  });

  it('나이와 직업은 장면을 쓰는 작가, 혼자 보낸 시간, 먼저 거는 연락, 한편의 작가에게 건네진다. 대표 대사는 아무 데도 건네지 않는다', async () => {
    const ctx = testCtx((call) =>
      // 한서가 저녁에 건넬 얘깃거리를 하나 남긴다 — 그래야 먼저 연락한다
      call.purpose === 'gap' && call.layers.cast.includes('이름: 한서') ? '18:30 | 말거리 | 새로 들어온 책을 정리했다.' : FAKE_DEFAULTS[call.purpose],
    );
    const { id } = await createFilm(ctx, FILM);
    const v = await enter(ctx, id, uid());
    await say(ctx, v.id, { text: '안녕하세요.', requestId: uid() });
    await skip(ctx, v.id, { kind: 'sleep', requestId: uid() });

    const of = (purpose: string) => ctx.model.calls.filter((c) => c.purpose === purpose).map((c) => c.layers.cast);
    // 장면을 쓰는 작가: 나오는 사람 모두의 카드. 지후의 카드에는 그런 줄이 없다
    const [hanseo, jihu] = of('reply').at(-1)!.split('\n\n이름: 지후') as [string, string];
    expect(hanseo).toContain(`- 나이: ${CREDIT.age}`);
    expect(hanseo).toContain(`- 직업: ${CREDIT.job}`);
    expect(jihu).not.toMatch(/- (나이|직업):/);
    // 혼자 보낸 시간과 먼저 거는 연락: 그 사람이 되어 쓴다
    expect(of('gap').find((c) => c.includes('이름: 한서'))).toContain(`나이: ${CREDIT.age}\n직업: ${CREDIT.job}`);
    expect(of('gap').find((c) => c.includes('이름: 지후'))).not.toMatch(/^(나이|직업):/m);
    expect(of('ping')).toHaveLength(1);
    expect(of('ping')[0]).toContain(`직업: ${CREDIT.job}`);
    // 한편의 작가는 두 사람의 카드를 함께 받는다
    expect(of('aside').at(-1)).toContain(`- 나이: ${CREDIT.age}\n- 직업: ${CREDIT.job}`);

    const all = ctx.model.calls.map((c) => JSON.stringify(c));
    expect(all.length).toBeGreaterThan(3);
    expect(all.some((c) => c.includes('사람을 안 떠나요'))).toBe(false);
    expect(all.some((c) => c.includes('대표 대사'))).toBe(false);
  });

  it('{{user}}는 들어가는 사람의 이름으로 읽는다', () => {
    const film = parseFilm({ ...FILM, casts: [{ ...FILM.casts[0], job: '{{user}}의 담임', quote: '{{user}}는 내가 지켜요.' }, FILM.casts[1]] });
    expect(fillFilm(film, '리현').casts[0]).toMatchObject({ job: '리현의 담임', quote: '리현은 내가 지켜요.' });
  });

  it('필름을 칸으로 되돌려도 남는다. 칸이 없던 때의 필름과 삶, 쓰다 만 것은 빈 칸으로 읽힌다', async () => {
    const film = parseFilm(FILM);
    expect(fromFilm(film).casts[0]).toMatchObject(CREDIT);
    expect(parseFilm(toFilm(fromFilm(film))).casts).toEqual(film.casts);
    expect(readDraft({ title: '쓰다 만 것', casts: [{ name: '한서' }] }).casts[0]).toMatchObject({ name: '한서', ...EMPTY });

    const old = JSON.parse(JSON.stringify(film)) as Film;
    for (const c of old.casts) for (const k of ['age', 'job', 'quote'] as const) delete (c as Partial<Film['casts'][0]>)[k];
    expect(readFilm(old).casts[0]).toMatchObject(EMPTY);
    expect(fromFilm(readFilm(old)).casts[0]).toMatchObject(EMPTY);

    // 저장소에 칸 없이 남아 있던 필름과 삶
    const ctx = testCtx();
    const filmId = uid();
    const playId = uid();
    await ctx.db.run('INSERT INTO films (id, owner, title, logline, featured, data, created_at) VALUES (?, ?, ?, ?, 0, ?, ?)', filmId, VISITOR, 'old', '', JSON.stringify(old), 1);
    await ctx.db.run(
      'INSERT INTO plays (id, film_id, owner, film, start_dow, start_min, elapsed, ended, created_at) VALUES (?, ?, ?, ?, 5, 960, 0, 0, 1)',
      playId,
      filmId,
      VISITOR,
      JSON.stringify(old),
    );
    expect((await getFilm(ctx, filmId)).film.casts[0]).toMatchObject(EMPTY);
    expect((await viewOf(ctx, playId)).film.casts[0]).toMatchObject(EMPTY);
    await say(ctx, playId, { room: 'c1', text: '여기요?', requestId: uid() });
    const { cast } = ctx.model.calls.filter((c) => c.purpose === 'reply').at(-1)!.layers;
    expect(cast).toContain('이름: 한서');
    expect(cast).not.toMatch(/(나이|직업):/);
  });
});
