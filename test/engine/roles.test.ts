import { describe, expect, it } from 'vitest';
import { readFilm } from '../../shared/opening';
import { RULES } from '../../shared/rules';
import type { Film } from '../../shared/types';
import { Fail } from '../../worker/engine/ctx';
import { chooseAs, filmView } from '../../worker/engine/entry';
import { createFilm, forScreen, loadFilm, parseFilm } from '../../worker/engine/films';
import { setMe } from '../../worker/engine/me';
import { addPersona } from '../../worker/engine/mypersonas';
import { viewOf } from '../../worker/engine/store';
import { enter, say } from '../../worker/engine/turn';
import { DEV_FILM, testCtx, uid } from '../helpers/film';

/* 내 배역 여럿과 「유저 이름」.
   임시 필름(동네 서점)의 캐스트는 한서(c1)와 지후(c2). 배역을 셋 둔다:
   첫째는 「유저 이름」(글에는 {{user}}), 둘째는 이름이 정해진 수아, 셋째는 「유저 이름」인데 글에 「주인공」이라고 쓴다. */

async function failCode(p: Promise<unknown>): Promise<string | null> {
  try {
    await p;
  } catch (e) {
    if (e instanceof Fail) return e.code;
    throw e;
  }
  return null;
}

const ROLES_FILM = {
  ...DEV_FILM,
  title: '개발용 — 배역 여럿',
  setting: '골목 끝의 작은 서점. {{user}}는 이번 주에 들어왔다.',
  persona: { name: '', player: true, line: '이번 주에 새로 온 알바', extras: [{ label: '나이', text: '{{user}}는 스물둘이다.' }] },
  roles: [
    { name: '수아', line: '서점 주인의 조카', extras: [{ label: '비밀', text: '수아는 서점을 물려받기 싫다.' }] },
    { name: '주인공', player: true, line: '단골 손님' },
  ],
  firstScene: {
    place: '서점 계산대',
    beats: [
      { kind: 'tell', text: '손님이 끊긴 오후.' },
      { kind: 'say', cast: 'c1', text: '{{user}} 씨, 그건 이쪽 칸이에요.' },
    ],
    room: 'c1',
    speaker: 'persona',
  },
};

async function setup() {
  const ctx = testCtx();
  const { id: filmId } = await createFilm(ctx, ROLES_FILM);
  return { ctx, filmId };
}

describe('필름에 내 배역 여럿', () => {
  it('「유저 이름」 배역은 이름을 비워도 된다. 비우면 글에 대신 쓰는 이름이다. 그 밖의 배역은 이름이 있어야 한다', () => {
    const film = parseFilm(ROLES_FILM);
    expect(film.persona).toMatchObject({ name: RULES.playerName, player: true });
    expect(film.roles).toHaveLength(2);
    expect(film.roles![0]).toMatchObject({ name: '수아' });
    expect(film.roles![0]!.player).toBeUndefined();
    expect(() => parseFilm({ ...ROLES_FILM, roles: [{ name: '', line: '' }] })).toThrow(Fail);
  });

  it('배역은 정해진 수까지다. 캐스트와 같은 이름의 배역은 받지 않는다', () => {
    const many = Array.from({ length: RULES.limits.roles }, (_, i) => ({ name: `배역${i}`, line: '' }));
    expect(() => parseFilm({ ...ROLES_FILM, roles: many })).toThrow(Fail);
    expect(() => parseFilm({ ...ROLES_FILM, roles: [{ name: '한서', line: '' }] })).toThrow(Fail);
  });

  it('화면으로 보내는 필름에는 배역들의 덧붙인 칸이 비어 있다. 예전 필름은 배역이 하나다', () => {
    const film = parseFilm(ROLES_FILM);
    expect(forScreen(film).roles![0]!.extras).toEqual([]);
    expect(film.roles![0]!.extras).toHaveLength(1);
    const { roles: _roles, ...old } = parseFilm(DEV_FILM);
    expect(readFilm(old as Film).roles).toEqual([]);
  });
});

describe('들어갈 때 배역 고르기', () => {
  it('고른 적이 없으면 첫째 배역이다. 「유저 이름」이면 내 이름으로 들어가고 글 속의 대신 쓰는 이름도 내 이름이 된다', async () => {
    const { ctx, filmId } = await setup();
    await setMe(ctx, { name: '서하' });
    expect((await filmView(ctx, filmId)).mine).toMatchObject({ name: '서하', as: 'role', role: 0, personaId: null });
    const v = await enter(ctx, filmId, uid());
    expect(v.film.persona).toMatchObject({ name: '서하', line: '이번 주에 새로 온 알바' });
    expect(v.film.firstScene.beats[1]).toMatchObject({ text: '서하 씨, 그건 이쪽 칸이에요.' });
    expect(v.film.setting).toBe('골목 끝의 작은 서점. 서하는 이번 주에 들어왔다.');
    // 삶에는 맡은 배역 하나만 간다
    expect(v.film.roles ?? []).toEqual([]);
    const { film } = await loadFilm(ctx, filmId);
    expect(film.roles).toHaveLength(2);
  });

  it('이름이 정해진 배역을 고르면 그 배역으로 들어간다. 그 배역의 덧붙인 칸이 대사 모델에게 간다', async () => {
    const { ctx, filmId } = await setup();
    await setMe(ctx, { name: '서하' });
    expect((await chooseAs(ctx, filmId, { as: 'role', role: 1 })).mine).toMatchObject({ name: '수아', as: 'role', role: 1 });
    const v = await enter(ctx, filmId, uid());
    expect(v.film.persona).toMatchObject({ name: '수아', line: '서점 주인의 조카' });
    await say(ctx, v.id, { text: '안녕하세요.', requestId: uid() });
    const cast = ctx.model.calls.filter((c) => c.purpose === 'reply').at(-1)!.layers.cast;
    expect(cast).toContain('수아는 서점을 물려받기 싫다.');
    expect(cast).not.toContain('스물둘');
  });

  it('「유저 이름」 배역은 내 이름이 있어야 고른다. 글에 다른 이름으로 적어 둔 배역도 내 이름이 된다', async () => {
    const { ctx, filmId } = await setup();
    expect(await failCode(chooseAs(ctx, filmId, { as: 'role', role: 2 }))).toBe('no_name');
    await setMe(ctx, { name: '서하' });
    expect((await chooseAs(ctx, filmId, { as: 'role', role: 2 })).mine).toMatchObject({ name: '서하', as: 'role', role: 2 });
    expect((await enter(ctx, filmId, uid())).film.persona).toMatchObject({ name: '서하', line: '단골 손님' });
  });

  it('내 페르소나로 들어가도 배역 하나를 맡는다. 사진과 소개가 비면 그 배역의 것을 쓴다', async () => {
    const { ctx, filmId } = await setup();
    const [p] = await addPersona(ctx, { name: '문리현', line: '', face: '' });
    const { mine } = await chooseAs(ctx, filmId, { as: 'persona', id: p!.id, role: 1 });
    expect(mine).toMatchObject({ name: '문리현', line: '서점 주인의 조카', as: 'me', personaId: p!.id, role: 1 });
    const v = await enter(ctx, filmId, uid());
    expect(v.film.persona).toMatchObject({ name: '문리현', line: '서점 주인의 조카' });
    await say(ctx, v.id, { text: '안녕하세요.', requestId: uid() });
    // 수아라는 배역 이름은 내 페르소나 이름으로 읽는다
    expect(ctx.model.calls.filter((c) => c.purpose === 'reply').at(-1)!.layers.cast).toContain('문리현은 서점을 물려받기 싫다.');
  });

  it('살던 삶에서 배역을 바꾸면 그 삶에도 바꾼 배역이 적힌다', async () => {
    const { ctx, filmId } = await setup();
    await setMe(ctx, { name: '서하' });
    const v = await enter(ctx, filmId, uid());
    await say(ctx, v.id, { text: '안녕하세요.', requestId: uid() });
    expect(ctx.model.calls.filter((c) => c.purpose === 'reply').at(-1)!.layers.cast).toContain('서하는 스물둘이다.');
    await chooseAs(ctx, filmId, { as: 'role', role: 1 });
    const now = (await viewOf(ctx, v.id)).film.persona;
    expect(now).toMatchObject({ name: '수아', line: '서점 주인의 조카' });
    // 화면에는 덧붙인 칸이 안 간다. 대사 모델에게 가는 것으로 본다
    await say(ctx, v.id, { text: '네, 수아예요.', requestId: uid() });
    const cast = ctx.model.calls.filter((c) => c.purpose === 'reply').at(-1)!.layers.cast;
    expect(cast).toContain('수아는 서점을 물려받기 싫다.');
    expect(cast).not.toContain('스물둘');
  });
});
