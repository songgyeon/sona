import { describe, expect, it } from 'vitest';
import { renameIn } from '../../shared/ko';
import { RULES } from '../../shared/rules';
import { Fail } from '../../worker/engine/ctx';
import { createFilm, getFilm } from '../../worker/engine/films';
import { setMine } from '../../worker/engine/persona';
import { viewOf } from '../../worker/engine/store';
import { enter, say } from '../../worker/engine/turn';
import { DEV_FILM, OTHER_VISITOR, testCtx, uid } from '../helpers/film';

const FACE = 'ffffffff-ffff-4fff-8fff-ffffffffffff';

/** 오프닝에 유저의 인물(수아)이 이름으로 적혀 있는 필름 */
const FILM = {
  ...DEV_FILM,
  firstScene: {
    place: '서점 계산대',
    beats: [
      { kind: 'tell', text: '손님이 끊긴 오후. 수아가 책을 들고 서가 앞에 서 있다. 한서는 수아를 한 번 본다.' },
      { kind: 'say', cast: 'c1', text: '수아 씨, 그건 이쪽 칸이에요.' },
    ],
    room: 'c1',
    speaker: 'persona',
  },
};

async function setup() {
  const ctx = testCtx();
  const { id: filmId } = await createFilm(ctx, FILM);
  const playId = uid();
  await enter(ctx, filmId, playId);
  return { ctx, filmId, playId };
}

async function failCode(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    if (e instanceof Fail) return e.code;
    throw e;
  }
  return 'no-fail';
}

describe('글 속의 이름 바꾸기', () => {
  it('이름 뒤의 조사를 새 이름의 받침에 맞춘다', () => {
    expect(renameIn('수아가 책을 든다. 한서는 수아를 본다.', '수아', '문리현')).toBe('문리현이 책을 든다. 한서는 문리현을 본다.');
    expect(renameIn('문리현이 앉은 자리다. 문리현을 본다.', '문리현', '수아')).toBe('수아가 앉은 자리다. 수아를 본다.');
    expect(renameIn('수아는 수아와 수아랑 수아로', '수아', '문리현')).toBe('문리현은 문리현과 문리현이랑 문리현으로');
    expect(renameIn('문리현은 문리현과 문리현이랑 문리현으로', '문리현', '수아')).toBe('수아는 수아와 수아랑 수아로');
    expect(renameIn('수아라고 했나.', '수아', '문리현')).toBe('문리현이라고 했나.');
    expect(renameIn('문리현이라는 사람', '문리현', '수아')).toBe('수아라는 사람');
  });

  it('ㄹ 받침 뒤에는 「로」가 온다', () => {
    expect(renameIn('수아로 왔다.', '수아', '하늘')).toBe('하늘로 왔다.');
    expect(renameIn('하늘로 왔다.', '하늘', '문리현')).toBe('문리현으로 왔다.');
  });

  it('조사가 없으면 이름만 바꾼다. 다른 낱말로 이어지면 조사로 보지 않는다', () => {
    expect(renameIn('수아 씨, 그건 이쪽 칸이에요.', '수아', '문리현')).toBe('문리현 씨, 그건 이쪽 칸이에요.');
    expect(renameIn('수아가방', '수아', '문리현')).toBe('문리현가방');
  });

  it('캐스트 이름의 한 토막이면 건드리지 않는다', () => {
    expect(renameIn('수아라가 수아를 부른다.', '수아', '문리현', ['수아라'])).toBe('수아라가 문리현을 부른다.');
  });

  it('바꿀 것이 없으면 그대로 돌려준다', () => {
    expect(renameIn('한서가 고개를 든다.', '수아', '문리현')).toBe('한서가 고개를 든다.');
    expect(renameIn('수아가 온다.', '수아', '수아')).toBe('수아가 온다.');
  });
});

describe('내 배역 고치기', () => {
  it('사진과 소개를 고치면 내 삶에 적힌다. 디렉터의 필름은 그대로다', async () => {
    const { ctx, filmId, playId } = await setup();
    const v = await setMine(ctx, playId, { name: '수아', line: '서점에서 일한 지 일주일. 책을 좋아한다.', face: FACE });
    expect(v.film.persona).toEqual({ name: '수아', line: '서점에서 일한 지 일주일. 책을 좋아한다.', face: FACE });
    expect((await viewOf(ctx, playId)).film.persona.face).toBe(FACE);

    const made = (await getFilm(ctx, filmId)).film;
    expect(made.persona).toMatchObject({ name: '수아', line: DEV_FILM.persona.line, face: '' });
  });

  it('고친 소개는 다음 대사부터 캐스트에게 건네진다', async () => {
    const { ctx, playId } = await setup();
    await setMine(ctx, playId, { name: '수아', line: '서점에서 일한 지 일주일. 책을 좋아한다.', face: '' });
    await say(ctx, playId, { room: 'c1', text: '안녕하세요.', requestId: uid() });
    expect(ctx.model.calls.at(-1)!.layers.cast).toContain('[상대]\n수아 — 서점에서 일한 지 일주일. 책을 좋아한다.');
  });

  it('이름을 바꾸면 캐스트가 부르는 말과 오프닝 속의 이름도 바뀐다', async () => {
    const { ctx, playId } = await setup();
    const v = await setMine(ctx, playId, { name: '문리현', line: '', face: '' });
    expect(v.film.persona).toEqual({ name: '문리현', line: '', face: '', formerly: ['수아'] });
    expect(v.film.casts.map((c) => c.callsUser)).toEqual(['문리현 씨', '문리현 님']);
    expect(v.film.firstScene.beats).toEqual([
      { kind: 'tell', text: '손님이 끊긴 오후. 문리현이 책을 들고 서가 앞에 서 있다. 한서는 문리현을 한 번 본다.' },
      { kind: 'say', cast: 'c1', text: '문리현 씨, 그건 이쪽 칸이에요.' },
    ]);
  });

  it('이름을 바꾼 뒤에는 캐스트에게 전의 이름도 알려 준다. 지나간 장면에는 그 이름이 남아 있다', async () => {
    const { ctx, playId } = await setup();
    await say(ctx, playId, { room: 'c1', text: '어느 칸이요?', requestId: uid() });
    await setMine(ctx, playId, { name: '문리현', line: '', face: '' });
    await say(ctx, playId, { room: 'c1', text: '여기요?', requestId: uid() });
    const { cast, scene } = ctx.model.calls.at(-1)!.layers;
    expect(cast).toContain('[상대]\n문리현\n(전에는 「수아」라고 불렸다. 같은 사람이다. 지금은 문리현이라고 부른다.)');
    expect(cast).toContain('문리현을 부르는 말: 문리현 씨');
    expect(scene).toContain('문리현: 어느 칸이요?');
  });

  it('이름을 다시 바꾸면 그 이름으로 또 바뀐다. 전의 이름들은 겹치지 않게 적힌다', async () => {
    const { ctx, playId } = await setup();
    await setMine(ctx, playId, { name: '문리현', line: '', face: '' });
    const v = await setMine(ctx, playId, { name: '수아', line: '', face: '' });
    expect(v.film.persona).toEqual({ name: '수아', line: '', face: '', formerly: ['문리현'] });
    expect(v.film.casts[0]!.callsUser).toBe('수아 씨');
    expect(v.film.firstScene.beats[0]).toEqual({ kind: 'tell', text: '손님이 끊긴 오후. 수아가 책을 들고 서가 앞에 서 있다. 한서는 수아를 한 번 본다.' });
  });

  it('맞지 않는 내용은 거절한다. 내 배역은 그대로다', async () => {
    const { ctx, playId } = await setup();
    expect(await failCode(setMine(ctx, playId, { name: ' ', line: '', face: '' }))).toBe('film_invalid');
    expect(await failCode(setMine(ctx, playId, { name: '수아', line: '가'.repeat(RULES.limits.persona + 1), face: '' }))).toBe('film_invalid');
    expect(await failCode(setMine(ctx, playId, { name: '수아', line: '', face: 'not-an-image' }))).toBe('film_invalid');
    expect(await failCode(setMine(ctx, playId, { name: '한서', line: '', face: '' }))).toBe('persona_taken');
    expect((await viewOf(ctx, playId)).film.persona).toMatchObject({ name: '수아', face: '' });
  });

  it('남의 삶의 배역은 못 고친다', async () => {
    const { ctx, playId } = await setup();
    expect(await failCode(setMine({ ...ctx, visitor: OTHER_VISITOR }, playId, { name: '문리현', line: '', face: '' }))).toBe('play_missing');
  });

  it('같은 필름에 다시 들어가도 내가 고친 배역으로 들어간다. 다른 사람은 디렉터가 정한 배역으로 들어간다', async () => {
    const { ctx, filmId, playId } = await setup();
    await setMine(ctx, playId, { name: '문리현', line: '새로 온 알바', face: FACE });

    const again = await enter(ctx, filmId, uid());
    expect(again.film.persona).toEqual({ name: '문리현', line: '새로 온 알바', face: FACE, formerly: ['수아'] });
    expect(again.film.casts[0]!.callsUser).toBe('문리현 씨');

    const guest = await enter({ ...ctx, visitor: OTHER_VISITOR }, filmId, uid());
    expect(guest.film.persona).toMatchObject({ name: '수아', face: '' });
    expect(guest.film.casts[0]!.callsUser).toBe('수아 씨');
  });
});
