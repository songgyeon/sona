import { describe, expect, it } from 'vitest';
import { givenName } from '../../shared/ko';
import type { MessageView } from '../../shared/types';
import { createFilm, parseFilm } from '../../worker/engine/films';
import { relabel, speakerOf } from '../../worker/engine/speakers';
import { parseScene } from '../../worker/engine/talk';
import { viewOf } from '../../worker/engine/store';
import { enter, say } from '../../worker/engine/turn';
import { FAKE_DEFAULTS } from '../../worker/model/fake';
import { DEV_FILM, testCtx, uid } from '../helpers/film';

/* 대사 줄의 이름표. 작가(대사 모델)는 지문에서 부르던 대로 성을 떼고 쓰기도 한다.
   시험 필름: 유저의 인물은 문리현, 캐스트는 배이안(c1, 「형」이라고도 불린다)과 한서(c2). */

const CAST = DEV_FILM.casts[0]!;
const FILM = {
  ...DEV_FILM,
  title: '개발용 — 이름표',
  persona: { ...DEV_FILM.persona, name: '문리현' },
  casts: [
    { ...CAST, name: '배이안', aliases: ['형'] },
    { ...DEV_FILM.casts[1]!, name: '한서' },
  ],
  ties: [],
  opens: { feed: false, ping: false, aside: false },
  firstScene: { place: '방', beats: [{ kind: 'tell', text: '아침.' }], room: 'c1', speaker: 'persona' },
};

describe('이름표 알아보기', () => {
  const film = parseFilm(FILM);

  it('성을 뗀 이름', () => {
    expect(givenName('배이안')).toBe('이안');
    expect(givenName('남궁민수')).toBe('민수');
    expect(givenName('한서')).toBe('한서');
    expect(givenName('Ian')).toBe('Ian');
  });

  it('캐스트는 이름, 성을 뗀 이름, 불리는 이름으로 말한다. 유저의 인물은 성을 뗀 이름으로 써도 받지 않는다', () => {
    const r = parseScene('이안이 냄비를 내려놓는다.\n이안: "잠깐 깼어? 더 자지."\n**형**: "일어나."\n배이안: "밥 먹어."\n리현: "응."\n한서: "저도 왔어요."', film);
    expect(r.pieces).toEqual([
      { speaker: 'tell', text: '이안이 냄비를 내려놓는다.' },
      { speaker: 'c1', text: '잠깐 깼어? 더 자지.' },
      { speaker: 'c1', text: '일어나.' },
      { speaker: 'c1', text: '밥 먹어.' },
      { speaker: 'c2', text: '저도 왔어요.' },
    ]);
    expect(r.personaSpoke).toBe(true);
  });

  it('두 사람이 같이 쓰는 이름표는 아무에게도 주지 않는다. 이름 그대로가 먼저다', () => {
    const two = parseFilm({ ...FILM, casts: [FILM.casts[0], { ...FILM.casts[1], name: '김이안', aliases: [] }] });
    expect(parseScene('이안: "누구?"', two).pieces).toEqual([{ speaker: 'tell', text: '이안: "누구?"' }]);
    const exact = parseFilm({ ...FILM, casts: [FILM.casts[0], { ...FILM.casts[1], name: '이안', aliases: [] }] });
    expect(speakerOf(exact)('이안')).toBe('c2');
    expect(speakerOf(exact)('배이안')).toBe('c1');
  });

  it('지문 속에 섞여 저장된 대사는 읽을 때 대사로 선다. 저장된 말은 그대로 둔다', () => {
    const stored: MessageView = {
      id: 'm1',
      room: 'scene',
      speaker: 'tell',
      text: '이안이 냄비를 내려놓는다.\n이안: "잠깐 깼어?"\n리현: "응."\n그가 다가온다.',
      at: 3,
      kind: 'chat',
      turnId: 't1',
    };
    const plain: MessageView = { ...stored, id: 'm2', text: '창밖에 비가 온다.' };
    const out = relabel([stored, plain], film);
    expect(out.map((m) => [m.speaker, m.text])).toEqual([
      ['tell', '이안이 냄비를 내려놓는다.'],
      ['c1', '잠깐 깼어?'],
      ['tell', '그가 다가온다.'],
      ['tell', '창밖에 비가 온다.'],
    ]);
    expect(new Set(out.map((m) => m.id)).size).toBe(4);
    expect(out[3]).toBe(plain);
    expect(stored.text).toContain('이안: "잠깐 깼어?"');
  });
});

describe('재생에서', () => {
  it('작가가 성을 떼고 써도 그 캐스트의 대사로 적히고, 다음 대목의 작가에게도 대사로 간다', async () => {
    const ctx = testCtx((call) => (call.purpose === 'reply' ? '이안이 돌아본다.\n이안: "잠깐 깼어? 더 자지."\n모습 | 이안은 부엌에 서 있다.' : FAKE_DEFAULTS[call.purpose]));
    const { id } = await createFilm(ctx, FILM);
    const playId = uid();
    await enter(ctx, id, playId);
    const v = await say(ctx, playId, { text: '피곤해.', requestId: uid() });
    expect(v.messages.slice(-2).map((m) => [m.speaker, m.text])).toEqual([
      ['tell', '이안이 돌아본다.'],
      ['c1', '잠깐 깼어? 더 자지.'],
    ]);
    const row = await ctx.db.first<{ speaker: string }>("SELECT speaker FROM messages WHERE play_id = ? AND text = '잠깐 깼어? 더 자지.'", playId);
    expect(row?.speaker).toBe('c1');
    await say(ctx, playId, { text: '응.', requestId: uid() });
    const scene = ctx.model.calls.filter((c) => c.purpose === 'reply').at(-1)!.layers.scene;
    expect(scene).toContain('배이안: "잠깐 깼어? 더 자지."');
    expect((await viewOf(ctx, playId)).messages.some((m) => m.speaker === 'tell' && m.text.includes('이안: "'))).toBe(false);
  });
});
