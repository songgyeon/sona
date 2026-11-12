import { describe, expect, it } from 'vitest';
import { fromFilm, previewFilm } from '../../shared/draft';
import { newClip, newText } from '../../shared/reel';
import { fillCard, fillFilm, fillUser } from '../../shared/roles';
import { chooseAs } from '../../worker/engine/entry';
import { createFilm, parseFilm } from '../../worker/engine/films';
import { setMe } from '../../worker/engine/me';
import { addPersona } from '../../worker/engine/mypersonas';
import { listPlays, viewOf } from '../../worker/engine/store';
import { enter, say } from '../../worker/engine/turn';
import { DEV_FILM, testCtx, uid } from '../helpers/film';

/* 디렉터가 글에 쓴 {{user}}는 어디서든 들어가는 사람(배역이나 내 페르소나)의 이름으로 읽는다.
   필름 정보, 목록, 미리 보기, 들어간 삶, 대사 모델에게 건네는 글까지. 디렉터의 필름은 그대로다. */

const USER = /\{\{\s*user\s*\}\}/i;

/** 여기저기 {{user}}를 쓴 필름. 첫째 배역은 이름이 정해진 수아, 둘째는 「유저 이름」 */
const FILM = {
  ...DEV_FILM,
  title: '개발용 — {{user}}의 금요일',
  logline: '{{user}}는 이번 주에 서점에 들어왔다.',
  setting: '골목 끝의 작은 서점. {{user}}가 계산대를 본다.',
  persona: { name: '수아', line: '{{user}}는 서점 주인의 조카', extras: [{ label: '{{user}}의 비밀', text: '{{user}}는 서점을 물려받기 싫다.' }] },
  roles: [{ name: '', player: true, line: '단골 손님' }],
  casts: DEV_FILM.casts.map((c, i) => (i === 0 ? { ...c, intro: '{{user}}를 처음 본 날을 기억한다.', role: '{{user}}의 선배' } : c)),
  firstScene: {
    place: '{{user}}의 계산대',
    beats: [
      { kind: 'tell', text: '{{user}}은(는) 책을 정리하고 있다.' },
      { kind: 'say', cast: 'c1', text: '{{user}} 씨, 그건 이쪽 칸이에요.' },
    ],
    room: 'c1',
    speaker: 'persona',
  },
  reel: { ratio: 'tall', clips: [{ ...newClip('black', '', 3), texts: [newText('{{user}}의 금요일')] }], music: '', musicName: '', musicFrom: 0 },
};

/** 필름에 {{user}}가 남았는지 — 글 칸 전부를 본다 */
const leftIn = (x: unknown): boolean => USER.test(JSON.stringify(x));

describe('{{user}}는 들어가는 사람의 이름으로 읽는다', () => {
  it('조사는 그 이름의 받침에 맞춘다. 받침 있는 꼴로 적었든 없는 꼴로 적었든, 둘 다 적었든', () => {
    expect(fillUser('{{user}}는 웃었다.', '리현')).toBe('리현은 웃었다.');
    expect(fillUser('{{user}}는 웃었다.', '수아')).toBe('수아는 웃었다.');
    expect(fillUser('{{user}}가 왔다. {{ User }}를 본다.', '리현')).toBe('리현이 왔다. 리현을 본다.');
    expect(fillUser('{{user}}은(는) 서점 알바다.', '수아')).toBe('수아는 서점 알바다.');
    expect(fillUser('{{user}}야, {{user}}로서.', '리현')).toBe('리현아, 리현으로서.');
    expect(fillUser('{{user}}랑 {{user}}라고 했다.', '리현')).toBe('리현이랑 리현이라고 했다.');
    expect(fillUser('{{user}}님, {{user}} 씨', '리현')).toBe('리현님, 리현 씨');
    // 이름이 아직 없으면 「나」다
    expect(fillUser('{{user}}는', '')).toBe('나는');
    expect(fillUser('그대로 둔다.', '리현')).toBe('그대로 둔다.');
  });

  it('필름의 글 전부: 제목, 한 줄 소개, 배경, 덧붙인 칸, 캐스트 소개, 첫 장면, 오프닝 영상의 글자. 이름 칸과 디렉터의 필름은 그대로다', () => {
    const film = parseFilm(FILM);
    const shown = fillFilm(film, '리현');
    expect(leftIn({ ...shown, roles: [] })).toBe(false);
    expect(shown.title).toBe('개발용 — 리현의 금요일');
    expect(shown.logline).toBe('리현은 이번 주에 서점에 들어왔다.');
    expect(shown.persona.extras![0]).toEqual({ label: '리현의 비밀', text: '리현은 서점을 물려받기 싫다.' });
    expect(shown.casts[0]).toMatchObject({ intro: '리현을 처음 본 날을 기억한다.', role: '리현의 선배' });
    expect(shown.firstScene.place).toBe('리현의 계산대');
    expect(shown.firstScene.beats[0]).toMatchObject({ text: '리현은 책을 정리하고 있다.' });
    expect(shown.reel!.clips[0]!.texts![0]!.text).toBe('리현의 금요일');
    // 「유저 이름」 배역의 이름 칸은 대신 쓰는 이름이라 건드리지 않는다
    expect(shown.roles![0]!.name).toBe(film.roles![0]!.name);
    expect(leftIn(film)).toBe(true);
  });

  it('이름이 정해진 배역으로 들어가면 그 배역의 이름이다. 대사 모델에게 가는 글에도 {{user}}가 없다', async () => {
    const ctx = testCtx();
    const { id } = await createFilm(ctx, FILM);
    const v = await enter(ctx, id, uid());
    expect(v.film.persona.name).toBe('수아');
    expect(v.film.setting).toBe('골목 끝의 작은 서점. 수아가 계산대를 본다.');
    expect(v.film.firstScene.beats[1]).toMatchObject({ text: '수아 씨, 그건 이쪽 칸이에요.' });
    expect(v.film.reel!.clips[0]!.texts![0]!.text).toBe('수아의 금요일');
    expect(leftIn(v.film)).toBe(false);
    await say(ctx, v.id, { text: '안녕하세요.', requestId: uid() });
    const calls = ctx.model.calls;
    expect(calls.length).toBeGreaterThan(0);
    expect(leftIn(calls)).toBe(false);
  });

  it('내 페르소나로 들어가면 그 페르소나의 이름이다. 「유저 이름」 배역은 내 이름이다', async () => {
    const ctx = testCtx();
    const { id } = await createFilm(ctx, FILM);
    const [p] = await addPersona(ctx, { name: '문리현', line: '', face: '' });
    await chooseAs(ctx, id, { as: 'persona', id: p!.id, role: 0 });
    const v = await enter(ctx, id, uid());
    expect(v.film.logline).toBe('문리현은 이번 주에 서점에 들어왔다.');
    expect(leftIn(v.film)).toBe(false);

    const other = testCtx();
    const { id: id2 } = await createFilm(other, FILM);
    await setMe(other, { name: '서하' });
    await chooseAs(other, id2, { as: 'role', role: 1 });
    const w = await enter(other, id2, uid());
    expect(w.film.persona.name).toBe('서하');
    expect(w.film.firstScene.beats[0]).toMatchObject({ text: '서하는 책을 정리하고 있다.' });
  });

  it('{{user}}가 남은 채로 저장된 예전 삶도 읽을 때 그 삶의 내 이름으로 읽는다. 저장된 것은 그대로다. 이어 살기 목록도', async () => {
    const ctx = testCtx();
    const { id } = await createFilm(ctx, FILM);
    const v = await enter(ctx, id, uid());
    // 이 기능이 없던 때의 삶: 들고 간 필름에 {{user}}가 그대로 있다
    await ctx.db.run('UPDATE plays SET film = ? WHERE id = ?', JSON.stringify({ ...parseFilm(FILM), roles: [] }), v.id);
    const again = await viewOf(ctx, v.id);
    expect(again.film.logline).toBe('수아는 이번 주에 서점에 들어왔다.');
    expect(leftIn(again.film)).toBe(false);
    const row = await ctx.db.first<{ film: string }>('SELECT film FROM plays WHERE id = ?', v.id);
    expect(USER.test(row!.film)).toBe(true);
    const [card] = await listPlays(ctx);
    expect(card).toMatchObject({ title: '개발용 — 수아의 금요일', logline: '수아는 이번 주에 서점에 들어왔다.' });
  });

  it('목록의 한 칸은 내 이름으로, 미리 보기는 첫째 배역으로 들어간 이름으로 읽는다', () => {
    const card = fillCard({ id: 'f', title: '{{user}}의 금요일', logline: '{{user}}는 알바다.', poster: '', castNames: [], personaName: '수아', personaLine: '{{user}}의 조카', mine: false, featured: false, private: false } as never, '서하');
    expect(card).toMatchObject({ title: '서하의 금요일', logline: '서하는 알바다.', personaLine: '서하의 조카' });
    const shown = previewFilm(fromFilm(parseFilm(FILM)), '서하');
    expect(shown.persona.name).toBe('수아');
    expect(shown.logline).toBe('수아는 이번 주에 서점에 들어왔다.');
    expect(leftIn(shown)).toBe(false);
  });
});
