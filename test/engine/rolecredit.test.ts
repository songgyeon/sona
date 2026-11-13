import { describe, expect, it } from 'vitest';
import { fromFilm, readDraft, toFilm } from '../../shared/draft';
import { readFilm } from '../../shared/opening';
import { fillFilm } from '../../shared/roles';
import { RULES } from '../../shared/rules';
import type { Film } from '../../shared/types';
import { Fail } from '../../worker/engine/ctx';
import { chooseAs } from '../../worker/engine/entry';
import { createFilm, getFilm, parseFilm } from '../../worker/engine/films';
import { setMe } from '../../worker/engine/me';
import { addPersona } from '../../worker/engine/mypersonas';
import { setMine } from '../../worker/engine/persona';
import { skip } from '../../worker/engine/skip';
import { viewOf } from '../../worker/engine/store';
import { enter, say } from '../../worker/engine/turn';
import { FAKE_DEFAULTS } from '../../worker/model/fake';
import { DEV_FILM, OTHER_VISITOR, testCtx, uid } from '../helpers/film';

/* 내 배역의 나이·직업·대표 대사 — 캐스트와 같은 배역 소개. 배역에 붙어 있어서 누가 맡든 그 배역의 것이 간다.
   임시 필름(동네 서점)에 배역을 둘 둔다: 첫째는 「유저 이름」, 둘째는 같은 자리의 다른 나이. */
const FIRST = { age: '25세', job: '밥집 사장', quote: '{{user}}는 귀찮은 거 질색이야.' };
const SECOND = { age: '27세', job: '밥집 사장', quote: '밥이나 먹어.' };

const FILM = {
  ...DEV_FILM,
  title: '개발용 — 배역 소개',
  opens: { feed: true, ping: true, aside: true },
  persona: { name: '', player: true, line: '여자. 바닷가 마을에서 작은 밥집을 한다.', ...FIRST },
  roles: [{ name: '', player: true, line: '남자. 바닷가 마을에서 작은 밥집을 한다.', ...SECOND }],
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

async function setup() {
  const ctx = testCtx((call) =>
    // 한서가 저녁에 건넬 얘깃거리를 하나 남긴다 — 그래야 한편과 먼저 거는 연락이 돈다
    call.purpose === 'gap' && call.layers.cast.includes('이름: 한서') ? '18:30 | 말거리 | 새로 들어온 책을 정리했다.' : FAKE_DEFAULTS[call.purpose],
  );
  await setMe(ctx, { name: '리현' });
  const { id: filmId } = await createFilm(ctx, FILM);
  return { ctx, filmId };
}

describe('내 배역의 나이·직업·대표 대사', () => {
  it('적지 않아도 개봉된다. 적으면 그대로 남고, 길이를 넘으면 어느 배역의 어느 칸인지 말한다', async () => {
    expect(parseFilm(DEV_FILM).persona).toMatchObject({ age: '', job: '', quote: '' });
    const film = parseFilm(FILM);
    expect(film.persona).toMatchObject(FIRST);
    expect(film.roles![0]).toMatchObject(SECOND);

    const L = RULES.limits;
    for (const [key, max, name] of [
      ['age', L.age, '나이'],
      ['job', L.job, '직업'],
      ['quote', L.quote, '대표 대사'],
    ] as const) {
      const f = await fail(() => parseFilm({ ...FILM, roles: [{ ...FILM.roles[0], [key]: '가'.repeat(max + 1) }] }));
      expect(f?.code).toBe('film_invalid');
      expect(f?.message).toContain(`내 배역 2의 ${name}`);
    }
  });

  it('필름 정보에서 누구에게나 보인다. {{user}}는 들어가는 사람의 이름으로 읽는다', async () => {
    const { ctx, filmId } = await setup();
    const seen = (await getFilm({ ...ctx, visitor: OTHER_VISITOR }, filmId)).film;
    expect(seen.persona).toMatchObject(FIRST);
    expect(fillFilm(seen, '리현').persona.quote).toBe('리현은 귀찮은 거 질색이야.');
  });

  it('들어가면 맡은 배역의 것이 삶에 간다. 나이·직업은 대사 모델에게, 대표 대사는 아무 데도 건네지 않는다', async () => {
    const { ctx, filmId } = await setup();
    const v = await enter(ctx, filmId, uid());
    expect(v.film.persona).toMatchObject({ name: '리현', age: '25세', job: '밥집 사장', quote: '리현은 귀찮은 거 질색이야.' });
    await say(ctx, v.id, { text: '오늘은 일찍 닫을까.', requestId: uid() });
    await skip(ctx, v.id, { kind: 'sleep', requestId: uid() });

    const of = (purpose: string) => ctx.model.calls.filter((c) => c.purpose === purpose).map((c) => c.layers.cast);
    // 장면을 쓰는 작가: [유저의 인물]
    const writer = of('reply').at(-1)!;
    expect(writer).toContain('[유저의 인물]\n리현 — 여자. 바닷가 마을에서 작은 밥집을 한다.\n- 나이: 25세\n- 직업: 밥집 사장');
    // 혼자 보낸 시간·먼저 거는 연락: [상대]
    expect(of('gap')[0]).toContain('[상대]\n리현 — 여자. 바닷가 마을에서 작은 밥집을 한다.\n- 나이: 25세\n- 직업: 밥집 사장');
    // 한편: 그 자리에 없는 사람
    const aside = ctx.model.calls.filter((c) => c.purpose === 'aside').map((c) => JSON.stringify(c));
    expect(aside.length).toBeGreaterThan(0);
    expect(aside.at(-1)).toContain('- 나이: 25세');

    const all = ctx.model.calls.map((c) => JSON.stringify(c));
    expect(all.some((c) => c.includes('귀찮은 거 질색'))).toBe(false);
  });

  it('배역을 바꾸면 살던 삶에도 바꾼 배역의 나이·직업·대표 대사가 간다', async () => {
    const { ctx, filmId } = await setup();
    const v = await enter(ctx, filmId, uid());
    await chooseAs(ctx, filmId, { as: 'role', role: 1 });
    expect((await viewOf(ctx, v.id)).film.persona).toMatchObject({ name: '리현', ...SECOND, line: '남자. 바닷가 마을에서 작은 밥집을 한다.' });
    await chooseAs(ctx, filmId, { as: 'role', role: 0 });
    expect((await viewOf(ctx, v.id)).film.persona).toMatchObject({ age: '25세', quote: '리현은 귀찮은 거 질색이야.' });
  });

  it('내 페르소나로 맡아도 그 배역의 나이·직업·대표 대사가 간다. 이름·사진·소개는 페르소나의 것이다', async () => {
    const { ctx, filmId } = await setup();
    // 입장권에 적은 이름(리현)이 첫 페르소나다. 새로 만든 문리현을 고른다
    const p = (await addPersona(ctx, { name: '문리현', line: '말수가 적다.', face: '' })).find((x) => x.name === '문리현')!;
    await chooseAs(ctx, filmId, { as: 'persona', id: p.id, role: 1 });
    const v = await enter(ctx, filmId, uid());
    expect(v.film.persona).toMatchObject({ name: '문리현', line: '말수가 적다.', ...SECOND });
  });

  it('내 배역을 고쳐도(이름·소개) 나이·직업·대표 대사는 그대로다', async () => {
    const { ctx, filmId } = await setup();
    const v = await enter(ctx, filmId, uid());
    const after = await setMine(ctx, v.id, { name: '서하', line: '새로 온 사장', face: '' });
    expect(after.film.persona).toMatchObject({ name: '서하', line: '새로 온 사장', age: '25세', job: '밥집 사장' });
  });

  it('필름을 칸으로 되돌려도 남는다. 칸이 없던 때의 필름·삶·쓰다 만 것은 빈 칸으로 읽힌다', async () => {
    const film = parseFilm(FILM);
    const draft = fromFilm(film);
    expect(draft).toMatchObject({ personaAge: '25세', personaJob: '밥집 사장' });
    expect(draft.roles[0]).toMatchObject(SECOND);
    expect(parseFilm(toFilm(draft)).persona).toEqual(film.persona);
    expect(parseFilm(toFilm(draft)).roles).toEqual(film.roles);

    const kept = readDraft({ title: '쓰다 만 것', personaName: '다온', roles: [{ name: '수아', line: '조카' }] });
    expect(kept).toMatchObject({ personaAge: '', personaJob: '', personaQuote: '' });
    expect(kept.roles[0]).toMatchObject({ name: '수아', age: '', job: '', quote: '' });

    const old = JSON.parse(JSON.stringify(film)) as Film;
    for (const p of [old.persona, ...(old.roles ?? [])]) for (const k of ['age', 'job', 'quote'] as const) delete p[k];
    const read = readFilm(old);
    expect(read.persona).toMatchObject({ age: '', job: '', quote: '' });
    expect(read.roles![0]).toMatchObject({ age: '', job: '', quote: '' });
  });
});
