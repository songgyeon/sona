import { describe, expect, it } from 'vitest';
import { fromFilm, readDraft, toFilm } from '../../shared/draft';
import { readFilm } from '../../shared/opening';
import { RULES } from '../../shared/rules';
import type { Film } from '../../shared/types';
import { Fail } from '../../worker/engine/ctx';
import { createFilm, getFilm, parseFilm, updateFilm } from '../../worker/engine/films';
import { setMine } from '../../worker/engine/persona';
import { skip } from '../../worker/engine/skip';
import { viewOf } from '../../worker/engine/store';
import { enter, say } from '../../worker/engine/turn';
import { FAKE_DEFAULTS, type Script } from '../../worker/model/fake';
import type { Purpose } from '../../worker/model/index';
import { DEV_FILM, OTHER_VISITOR, VISITOR, testCtx, uid } from '../helpers/film';

/* 캐스트 카드의 성격·습관·트라우마·결핍·비밀. 적지 않아도 되는 칸이다.
   임시 필름의 한서(c1)에게만 적어 둔다. 지후(c2)의 칸은 비어 있다. */
const NOTES = {
  nature: '말수가 적다. 맡은 일은 끝까지 한다.',
  habit: '생각할 때 책등을 손끝으로 두드린다.',
  trauma: '전에 일하던 곳에서 남의 실수를 혼자 뒤집어썼다.',
  lack: '누구에게 먼저 기대 본 적이 없다.',
  secret: '서점을 그만둘지 고민하고 있다. 수아에게는 말하지 않았다.',
};
const EMPTY = { nature: '', habit: '', trauma: '', lack: '', secret: '' };
const NAMES = ['성격', '습관', '트라우마', '결핍', '비밀'];

const FILM = {
  ...DEV_FILM,
  opens: { feed: true, ping: true, aside: true },
  casts: [{ ...DEV_FILM.casts[0], ...NOTES }, DEV_FILM.casts[1]],
};

async function setup(film: unknown = FILM, script?: Script) {
  const ctx = testCtx(script);
  const { id: filmId } = await createFilm(ctx, film);
  const playId = uid();
  await enter(ctx, filmId, playId);
  const send = (text: string, room = 'c1', who = ctx, play = playId) => say(who, play, { room, text, requestId: uid() });
  const last = (purpose: Purpose) => ctx.model.calls.filter((c) => c.purpose === purpose).at(-1)!;
  return { ctx, filmId, playId, send, last };
}

async function fail(p: () => unknown): Promise<Fail | null> {
  try {
    await p();
  } catch (e) {
    if (e instanceof Fail) return e;
    throw e;
  }
  return null;
}

describe('캐스트의 성격·습관·트라우마·결핍·비밀', () => {
  it('적지 않아도 개봉된다. 빈 칸으로 읽힌다', async () => {
    const film = parseFilm(DEV_FILM);
    expect(film.casts[0]).toMatchObject(EMPTY);
    expect(film.casts[1]).toMatchObject(EMPTY);

    const { send, last } = await setup(DEV_FILM);
    await send('안녕하세요.');
    for (const name of NAMES) expect(last('reply').layers.cast).not.toContain(`${name}:`);
  });

  it('적은 그대로 저장된다. 앞뒤 빈칸만 뗀다', () => {
    const film = parseFilm({ ...FILM, casts: [{ ...FILM.casts[0], secret: `  ${NOTES.secret}\n` }, FILM.casts[1]] });
    expect(film.casts[0]).toMatchObject(NOTES);
    expect(film.casts[1]).toMatchObject(EMPTY);
  });

  it('칸의 길이를 넘으면 어느 칸인지 말하고 거절한다', async () => {
    const long = '가'.repeat(RULES.limits.trait + 1);
    for (const [key, name] of Object.keys(NOTES).map((k, i) => [k, NAMES[i]!] as const)) {
      const f = await fail(() => parseFilm({ ...FILM, casts: [{ ...FILM.casts[0], [key]: long }, FILM.casts[1]] }));
      expect(f?.code).toBe('film_invalid');
      expect(f?.message).toContain(name);
    }
    expect(parseFilm({ ...FILM, casts: [{ ...FILM.casts[0], secret: '가'.repeat(RULES.limits.trait) }, FILM.casts[1]] }).casts[0]!.secret).toHaveLength(RULES.limits.trait);
  });

  it('적은 칸은 장면을 쓰는 작가에게 그 캐스트의 카드로 건네진다', async () => {
    const { send, last } = await setup();
    await send('안녕하세요.');
    const [hanseo, jihu] = last('reply').layers.cast.split('\n\n이름: 지후') as [string, string];
    expect(hanseo).toContain(`- 성격: ${NOTES.nature}`);
    expect(hanseo).toContain(`- 습관: ${NOTES.habit}`);
    expect(hanseo).toContain(`- 트라우마: ${NOTES.trauma}`);
    expect(hanseo).toContain(`- 결핍: ${NOTES.lack}`);
    expect(hanseo).toContain(`- 비밀: ${NOTES.secret}`);
    // 지후의 카드에는 그런 줄이 없다
    for (const text of Object.values(NOTES)) expect(jihu).not.toContain(text);
    expect(jihu).not.toMatch(/- (성격|습관|트라우마|결핍|비밀):/);
  });

  it('채운 칸만 건네진다', async () => {
    const { send, last } = await setup({ ...DEV_FILM, casts: [{ ...DEV_FILM.casts[0], habit: NOTES.habit }, DEV_FILM.casts[1]] });
    await send('안녕하세요.');
    const { cast } = last('reply').layers;
    expect(cast).toContain(`습관: ${NOTES.habit}`);
    for (const name of ['성격', '트라우마', '결핍', '비밀']) expect(cast).not.toContain(`${name}:`);
  });

  it('혼자 보낸 시간을 적는 쪽, 먼저 거는 연락, 한편의 작가에게도 건네진다', async () => {
    // 한서가 저녁에 건넬 얘깃거리를 하나 남긴다 — 그래야 먼저 연락한다
    const { ctx, playId, send, last } = await setup(FILM, (call) =>
      call.purpose === 'gap' && call.layers.cast.includes('이름: 한서') ? '18:30 | 말거리 | 새로 들어온 책을 정리했다.' : FAKE_DEFAULTS[call.purpose],
    );
    await send('먼저 가 볼게요.');
    await skip(ctx, playId, { kind: 'sleep', requestId: uid() });

    const gaps = ctx.model.calls.filter((c) => c.purpose === 'gap').map((c) => c.layers.cast);
    const ofHanseo = gaps.find((c) => c.includes('이름: 한서'))!;
    const ofJihu = gaps.find((c) => c.includes('이름: 지후'))!;
    expect(ofHanseo).toContain(`비밀: ${NOTES.secret}`);
    expect(ofJihu).not.toContain(NOTES.secret);

    // 한편의 작가는 두 사람의 카드를 함께 받는다
    const aside = last('aside').layers.cast;
    expect(aside).toContain(`- 성격: ${NOTES.nature}`);
    expect(aside).toContain(`- 습관: ${NOTES.habit}`);
    expect(aside).toContain(`- 트라우마: ${NOTES.trauma}`);
    expect(aside).toContain(`- 결핍: ${NOTES.lack}`);
    expect(aside).toContain(`- 비밀: ${NOTES.secret}`);
    // 지후의 카드에는 그런 줄이 없다
    expect(aside.split('이름: 지후')[1]).not.toMatch(/- (성격|습관|트라우마|결핍|비밀):/);

    const pings = ctx.model.calls.filter((c) => c.purpose === 'ping');
    expect(pings).toHaveLength(1);
    expect(pings[0]!.layers.cast).toContain('이름: 한서');
    expect(pings[0]!.layers.cast).toContain(`비밀: ${NOTES.secret}`);
  });

  it('화면으로는 보내지 않는다. 만든 사람이 필름을 고칠 때만 보낸다', async () => {
    const { ctx, filmId, playId, send, last } = await setup();
    const guest = { ...ctx, visitor: OTHER_VISITOR };

    // 만든 사람: 고치는 화면이 읽는 필름에는 다 있다
    expect((await getFilm(ctx, filmId)).film.casts[0]).toMatchObject(NOTES);
    // 링크로 온 사람: 필름 정보에는 비어 있다. 다른 칸은 그대로다
    const seen = (await getFilm(guest, filmId)).film.casts[0]!;
    expect(seen).toMatchObject({ ...EMPTY, name: '한서', role: DEV_FILM.casts[0]!.role });

    // 재생하는 화면은 누구에게든 비워서 보낸다
    expect((await viewOf(ctx, playId)).film.casts[0]).toMatchObject(EMPTY);
    expect((await send('안녕하세요.')).film.casts[0]).toMatchObject(EMPTY);
    const guestPlay = uid();
    expect((await enter(guest, filmId, guestPlay)).film.casts[0]).toMatchObject(EMPTY);

    // 그래도 그 사람의 삶에는 디렉터가 쓴 그대로 들어 있다 — 캐스트에게는 건네진다
    await send('안녕하세요.', 'c1', guest, guestPlay);
    expect(last('reply').layers.cast).toContain(`비밀: ${NOTES.secret}`);
  });

  it('만든 사람만 고친다. 고친 칸은 새로 들어갈 때부터 쓰인다', async () => {
    const { ctx, filmId, playId, send, last } = await setup();
    const fixed = { ...FILM, casts: [{ ...FILM.casts[0], secret: '서점을 물려받기로 했다.' }, FILM.casts[1]] };
    expect((await fail(() => updateFilm({ ...ctx, visitor: OTHER_VISITOR }, filmId, fixed)))?.code).toBe('not_owner');
    await updateFilm(ctx, filmId, fixed);

    await send('안녕하세요.');
    expect(last('reply').layers.cast).toContain(`비밀: ${NOTES.secret}`);

    const again = uid();
    await enter(ctx, filmId, again);
    await send('안녕하세요.', 'c1', ctx, again);
    expect(last('reply').layers.cast).toContain('비밀: 서점을 물려받기로 했다.');
    expect(playId).not.toBe(again);
  });

  it('내 배역의 이름을 바꾸면 이 칸에 적힌 이름도 바뀐다', async () => {
    const { ctx, playId, send, last } = await setup();
    await setMine(ctx, playId, { name: '문리현', line: '', face: '' });
    await send('안녕하세요.');
    expect(last('reply').layers.cast).toContain('비밀: 서점을 그만둘지 고민하고 있다. 문리현에게는 말하지 않았다.');
  });

  it('이 칸들이 없던 때의 필름과 삶도 그대로 읽힌다', async () => {
    const parsed = parseFilm(DEV_FILM);
    const old = {
      ...parsed,
      casts: parsed.casts.map(({ nature: _n, habit: _h, trauma: _t, lack: _l, secret: _s, ...c }) => c),
    } as unknown as Film;
    expect(readFilm(old).casts[0]).toMatchObject(EMPTY);
    expect(fromFilm(readFilm(old)).casts[0]).toMatchObject(EMPTY);

    const ctx = testCtx();
    const filmId = uid();
    const playId = uid();
    await ctx.db.run(
      'INSERT INTO films (id, owner, title, logline, featured, data, created_at) VALUES (?, ?, ?, ?, 0, ?, ?)',
      filmId,
      VISITOR,
      'old',
      '',
      JSON.stringify(old),
      1,
    );
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
    for (const name of NAMES) expect(cast).not.toContain(`${name}:`);

    // 이름을 바꿔도 탈이 없다
    const v = await setMine(ctx, playId, { name: '문리현', line: '', face: '' });
    expect(v.film.casts[0]!.callsUser).toBe('문리현 씨');
  });

  it('필름을 칸으로 되돌려도 남아 있다. 예전에 쓰다 만 내용은 빈 칸으로 읽힌다', () => {
    const film = parseFilm(FILM);
    const draft = fromFilm(film);
    expect(draft.casts[0]).toMatchObject(NOTES);
    expect(draft.casts[1]).toMatchObject(EMPTY);
    expect(parseFilm(toFilm(draft)).casts).toEqual(film.casts);

    const kept = readDraft({ title: '쓰다 만 것', casts: [{ name: '한서', speech: '존댓말' }] });
    expect(kept.casts[0]).toMatchObject({ name: '한서', speech: '존댓말', ...EMPTY });
  });
});

describe('캐스트의 소개 — 프로필에 보여 주기만 하는 글', () => {
  const INTRO = '서점 주인의 조카. 무뚝뚝해 보여도 단골의 취향은 다 외운다.';
  const WITH_INTRO = { ...DEV_FILM, casts: [{ ...DEV_FILM.casts[0], intro: INTRO }, DEV_FILM.casts[1]] };

  it('적지 않아도 개봉된다. 적으면 그대로 남고, 누구에게나 보인다', async () => {
    const ctx = testCtx();
    expect(parseFilm(DEV_FILM).casts[0]!.intro).toBe('');
    const { id } = await createFilm(ctx, WITH_INTRO);
    expect((await getFilm({ ...ctx, visitor: OTHER_VISITOR }, id)).film.casts[0]!.intro).toBe(INTRO);
    expect(await (async () => {
      try {
        parseFilm({ ...DEV_FILM, casts: [{ ...DEV_FILM.casts[0], intro: '가'.repeat(RULES.limits.intro + 1) }] });
        return null;
      } catch (e) {
        return (e as Fail).message;
      }
    })()).toContain('소개');
  });

  it('대사 모델에게는 건네지 않는다', async () => {
    const ctx = testCtx();
    const { id } = await createFilm(ctx, { ...WITH_INTRO, opens: { feed: true, ping: true, aside: true } });
    const v = await enter(ctx, id, uid());
    await say(ctx, v.id, { text: '안녕하세요.', requestId: uid() });
    await skip(ctx, v.id, { kind: 'sleep', requestId: uid() });
    const all = ctx.model.calls.map((c) => JSON.stringify(c));
    expect(all.length).toBeGreaterThan(2);
    expect(all.some((c) => c.includes('단골의 취향'))).toBe(false);
  });

  it('필름을 칸으로 되돌려도 남는다. 소개가 없던 때의 필름은 빈 소개로 읽힌다', () => {
    const film = parseFilm(WITH_INTRO);
    expect(fromFilm(film).casts[0]!.intro).toBe(INTRO);
    expect((toFilm(fromFilm(film)) as { casts: { intro: string }[] }).casts[0]!.intro).toBe(INTRO);
    const old = JSON.parse(JSON.stringify(film)) as Film;
    delete (old.casts[0] as Partial<Film['casts'][0]>).intro;
    expect(readFilm(old).casts[0]!.intro).toBe('');
  });
});
