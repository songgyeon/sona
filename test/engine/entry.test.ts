import { describe, expect, it } from 'vitest';
import { Fail } from '../../worker/engine/ctx';
import { chooseAs, filmView } from '../../worker/engine/entry';
import { createFilm } from '../../worker/engine/films';
import { getMe, setMe } from '../../worker/engine/me';
import { dropSave, listSaves, loadSave, makeSave } from '../../worker/engine/saves';
import { viewOf } from '../../worker/engine/store';
import { enter, say } from '../../worker/engine/turn';
import { DEV_FILM, OTHER_VISITOR, testCtx, uid } from '../helpers/film';
import { RULES } from '../../shared/rules';

/* 들어가기 전과 사는 동안 — 내 이름, 들어가는 이름, 장면 저장.
   임시 필름(동네 서점): 배역 이름은 수아, 캐스트는 한서(c1)와 지후(c2). 오프닝에서 한서가 「수아 씨」라고 부른다. */

async function failCode(p: Promise<unknown>): Promise<string | null> {
  try {
    await p;
  } catch (e) {
    if (e instanceof Fail) return e.code;
    throw e;
  }
  return null;
}

const OPENING = {
  place: '서점 계산대',
  beats: [
    { kind: 'tell', text: '손님이 끊긴 오후.' },
    { kind: 'say', cast: 'c1', text: '수아 씨, 그건 이쪽 칸이에요.' },
  ],
  room: 'c1',
  speaker: 'persona',
};

async function setup() {
  const ctx = testCtx();
  const { id: filmId } = await createFilm(ctx, { ...DEV_FILM, firstScene: OPENING });
  return { ctx, filmId };
}

describe('내 이름', () => {
  it('처음에는 없다. 정하면 남는다. 앞뒤 빈칸은 걷고 가운데 빈칸은 하나로 줄인다', async () => {
    const { ctx } = await setup();
    expect(await getMe(ctx)).toEqual({ name: '' });
    expect(await setMe(ctx, { name: '  서   하 ' })).toEqual({ name: '서 하' });
    expect(await getMe(ctx)).toEqual({ name: '서 하' });
    await setMe(ctx, { name: '서하' });
    expect(await getMe(ctx)).toEqual({ name: '서하' });
    // 다른 사람의 이름과는 따로다
    expect(await getMe({ ...ctx, visitor: OTHER_VISITOR })).toEqual({ name: '' });
  });

  it('비었거나 너무 길면 받지 않는다', async () => {
    const { ctx } = await setup();
    expect(await failCode(setMe(ctx, { name: '   ' }))).toBe('empty_name');
    expect(await failCode(setMe(ctx, {}))).toBe('empty_name');
    expect(await failCode(setMe(ctx, { name: '가'.repeat(RULES.limits.myName + 1) }))).toBe('long_name');
    expect(await setMe(ctx, { name: '가'.repeat(RULES.limits.myName) })).toEqual({ name: '가'.repeat(RULES.limits.myName) });
  });
});

describe('들어가는 이름', () => {
  it('처음에는 배역 이름으로 들어간다', async () => {
    const { ctx, filmId } = await setup();
    await setMe(ctx, { name: '서하' });
    expect((await filmView(ctx, filmId)).mine).toMatchObject({ name: '수아', as: 'role' });
  });

  it('내 이름을 고르면 그 이름으로 들어간다. 오프닝 속 이름도 바뀐다. 필름마다 기억한다', async () => {
    const { ctx, filmId } = await setup();
    await setMe(ctx, { name: '서하' });
    expect((await chooseAs(ctx, filmId, { as: 'me' })).mine).toMatchObject({ name: '서하', as: 'me' });
    const v = await enter(ctx, filmId, uid());
    expect(v.film.persona.name).toBe('서하');
    expect(v.film.firstScene.beats[1]).toMatchObject({ text: '서하 씨, 그건 이쪽 칸이에요.' });
    // 새로 들어가도 그대로다
    expect((await enter(ctx, filmId, uid())).film.persona.name).toBe('서하');
    // 사진과 소개는 그대로다
    expect(v.film.persona.line).toBe(DEV_FILM.persona.line);
  });

  it('살던 삶에도 적힌다. 배역 이름으로 되돌릴 수 있다', async () => {
    const { ctx, filmId } = await setup();
    await setMe(ctx, { name: '서하' });
    const v = await enter(ctx, filmId, uid());
    expect(v.film.persona.name).toBe('수아');
    await chooseAs(ctx, filmId, { as: 'me' });
    expect((await viewOf(ctx, v.id)).film.persona.name).toBe('서하');
    expect((await chooseAs(ctx, filmId, { as: 'role' })).mine).toMatchObject({ name: '수아', as: 'role' });
    expect((await viewOf(ctx, v.id)).film.persona.name).toBe('수아');
  });

  it('내 이름이 없거나 캐스트와 같으면 고르지 못한다. 남의 비공개 필름은 없는 필름이다', async () => {
    const { ctx, filmId } = await setup();
    expect(await failCode(chooseAs(ctx, filmId, { as: 'me' }))).toBe('no_name');
    await setMe(ctx, { name: '한서' });
    expect(await failCode(chooseAs(ctx, filmId, { as: 'me' }))).toBe('persona_taken');
    expect(await failCode(chooseAs(ctx, filmId, { as: '누구' }))).toBe('bad_as');
    const { id: hidden } = await createFilm(ctx, { ...DEV_FILM, private: true });
    expect(await failCode(chooseAs({ ...ctx, visitor: OTHER_VISITOR }, hidden, { as: 'role' }))).toBe('film_missing');
  });
});

describe('장면 저장', () => {
  async function living() {
    const { ctx, filmId } = await setup();
    const v = await enter(ctx, filmId, uid());
    const send = (text: string) => say(ctx, v.id, { text, requestId: uid() });
    const said = async () => (await viewOf(ctx, v.id)).messages.filter((m) => m.speaker === 'persona').map((m) => m.text);
    return { ctx, playId: v.id, send, said };
  }

  it('지금 장면을 저장하면 목록에 그때의 시각과 곳, 마지막 말이 선다', async () => {
    const { ctx, playId, send } = await living();
    await send('첫째 말.');
    const list = await makeSave(ctx, playId);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ at: 3, place: '서점 계산대', line: '응, 듣고 있어.', auto: false });
  });

  it('여기서 다시 살기: 그 장면으로 돌아가고, 그 뒤의 이야기는 지워진다. 돌아가기 전 장면은 저절로 남는다', async () => {
    const { ctx, playId, send, said } = await living();
    await send('첫째 말.');
    const [saved] = await makeSave(ctx, playId);
    await send('둘째 말.');
    await send('셋째 말.');
    const back = await loadSave(ctx, playId, saved!.id);
    expect(back.elapsed).toBe(3);
    expect(await said()).toEqual(['첫째 말.']);
    // 거기서 이어서 산다. 시계도 거기서 간다
    const next = await send('다른 길.');
    expect(next.elapsed).toBe(6);
    expect(await said()).toEqual(['첫째 말.', '다른 길.']);
    // 돌아가기 전 장면이 「자동」으로 남아 있다
    const list = await listSaves(ctx, playId);
    const auto = list.find((s) => s.auto)!;
    expect(auto).toMatchObject({ at: 9 });
    // 그리로 다시 가면 지웠던 이야기가 돌아온다
    await loadSave(ctx, playId, auto.id);
    expect(await said()).toEqual(['첫째 말.', '둘째 말.', '셋째 말.']);
    // 돌아가기 전 자리는 하나뿐이다
    expect((await listSaves(ctx, playId)).filter((s) => s.auto)).toHaveLength(1);
  });

  it('다른 장면은 건드리지 않는다. 지우면 그 장면만 없어진다', async () => {
    const { ctx, playId, send, said } = await living();
    await send('하나.');
    const [one] = await makeSave(ctx, playId);
    await send('둘.');
    const [two] = await makeSave(ctx, playId);
    await loadSave(ctx, playId, one!.id);
    await loadSave(ctx, playId, two!.id);
    expect(await said()).toEqual(['하나.', '둘.']);
    const after = await dropSave(ctx, playId, one!.id);
    expect(after.map((s) => s.id)).not.toContain(one!.id);
    expect(after.map((s) => s.id)).toContain(two!.id);
  });

  it('정해진 수까지만 저장한다. 대사를 다 받기 전에는 저장하지 못한다. 남의 삶은 못 건드린다', async () => {
    const { ctx, playId, send } = await living();
    await send('하나.');
    for (let i = 0; i < RULES.saves.max; i++) await makeSave(ctx, playId);
    expect(await failCode(makeSave(ctx, playId))).toBe('saves_full');
    const other = { ...ctx, visitor: OTHER_VISITOR };
    expect(await failCode(listSaves(other, playId))).toBe('play_missing');
    const [s] = await listSaves(ctx, playId);
    expect(await failCode(loadSave(other, playId, s!.id))).toBe('play_missing');
    expect(await failCode(loadSave(ctx, playId, uid()))).toBe('save_missing');

    // 답을 못 받고 멈춘 턴
    const stuck = testCtx(() => '');
    const { id: filmId } = await createFilm(stuck, DEV_FILM);
    const v = await enter(stuck, filmId, uid());
    await say(stuck, v.id, { text: '안녕.', requestId: uid() });
    expect(await failCode(makeSave(stuck, v.id))).toBe('stuck');
  });
});
