import { describe, expect, it } from 'vitest';
import { cutFor, cutOwners, sceneOf, together } from '../../shared/opening';
import { RULES } from '../../shared/rules';
import { createFilm, parseFilm } from '../../worker/engine/films';
import { skip } from '../../worker/engine/skip';
import { takesTurn } from '../../worker/engine/talk';
import { enter, say } from '../../worker/engine/turn';
import { FAKE_DEFAULTS } from '../../worker/model/fake';
import type { ModelCall, Purpose } from '../../worker/model/index';
import { DEV_FILM, testCtx, uid } from '../helpers/film';

/* 한자리 — 오프닝에 함께 나온 캐스트들은 그 뒤로도 한자리에서 이야기한다.
   임시 필름(동네 서점): 유저의 인물은 수아, 한서(c1)와 지후(c2). 금요일 오후 4시에 시작한다. */

const CUT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CUT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const CUT_C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const POSTER = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

/** 한서와 지후가 오프닝에 함께 나온다 */
const TOGETHER = {
  ...DEV_FILM,
  opens: { feed: false, ping: false, aside: false },
  firstScene: {
    place: '서점 계산대',
    beats: [
      { kind: 'cut', image: CUT_A },
      { kind: 'tell', text: '손님이 끊긴 오후.' },
      { kind: 'say', cast: 'c1', text: '수아 씨, 그건 이쪽 칸이에요.' },
      { kind: 'cut', image: CUT_B },
      { kind: 'say', cast: 'c2', text: '오늘도 그 자리 비었어요?' },
      { kind: 'cut', image: CUT_C },
      { kind: 'tell', text: '문 위의 종이 한 번 울린다.' },
    ],
    room: 'c1',
    speaker: 'persona',
  },
};

/** 오프닝에는 한서만 나온다. 지후는 그 자리에 없다 */
const APART = {
  ...TOGETHER,
  firstScene: { ...TOGETHER.firstScene, beats: TOGETHER.firstScene.beats.filter((b) => !(b.kind === 'say' && b.cast === 'c2')) },
};

type Part = string | ((call: ModelCall) => string);
async function setup(film: unknown = TOGETHER, parts: Partial<Record<Purpose, Part>> = {}) {
  const ctx = testCtx((call) => {
    const p = parts[call.purpose];
    if (p === undefined) return FAKE_DEFAULTS[call.purpose];
    return typeof p === 'function' ? p(call) : p;
  });
  const { id: filmId } = await createFilm(ctx, film);
  const playId = uid();
  await enter(ctx, filmId, playId);
  const send = (text: string, room = 'c1') => say(ctx, playId, { room, text, requestId: uid() });
  const calls = (purpose: Purpose) => ctx.model.calls.filter((c) => c.purpose === purpose);
  return { ctx, playId, send, calls };
}

describe('한자리: 누가 같이 있나', () => {
  it('오프닝에 함께 나온 캐스트가 둘 이상이면 한자리다', () => {
    expect(together(parseFilm(TOGETHER))).toEqual(['c1', 'c2']);
    expect(sceneOf(parseFilm(TOGETHER), 'c2')).toEqual(['c1', 'c2']);
  });

  it('오프닝에 혼자 나오면 묶을 자리가 없다. 저마다 따로다', () => {
    expect(together(parseFilm(APART))).toEqual([]);
    expect(sceneOf(parseFilm(APART), 'c1')).toEqual(['c1']);
    expect(sceneOf(parseFilm(APART), 'c2')).toEqual(['c2']);
    expect(together(parseFilm({ ...TOGETHER, casts: [TOGETHER.casts[0]], ties: [], firstScene: APART.firstScene }))).toEqual([]);
  });
});

describe('한자리: 누구의 컷인가', () => {
  const film = parseFilm(TOGETHER);

  it('컷 다음에 처음 말하는 캐스트가 그 컷의 사람이다. 아무도 말하지 않으면 누구의 컷도 아니다', () => {
    expect(cutOwners(film)).toEqual([
      { image: CUT_A, cast: 'c1' },
      { image: CUT_B, cast: 'c2' },
      { image: CUT_C, cast: '' },
    ]);
  });

  it('말하는 사람의 컷이 걸린다. 다른 사람의 컷은 걸지 않는다', () => {
    expect(cutFor(film, 'c1')).toBe(CUT_A);
    expect(cutFor(film, 'c2')).toBe(CUT_B);
    // 제 컷이 없는 사람: 누구의 것도 아닌 컷
    const three = parseFilm({ ...TOGETHER, casts: [...TOGETHER.casts, { ...TOGETHER.casts[0], name: '서준' }] });
    expect(cutFor(three, 'c3')).toBe(CUT_C);
    // 그런 컷도 없으면 포스터, 그것도 없으면 걸지 않는다
    const owned = { ...TOGETHER, firstScene: { ...TOGETHER.firstScene, beats: TOGETHER.firstScene.beats.slice(0, 5) } };
    expect(cutFor(parseFilm({ ...owned, poster: POSTER, casts: [...TOGETHER.casts, { ...TOGETHER.casts[0], name: '서준' }] }), 'c3')).toBe(POSTER);
    expect(cutFor(parseFilm({ ...owned, casts: [...TOGETHER.casts, { ...TOGETHER.casts[0], name: '서준' }] }), 'c3')).toBe('');
  });

  it('같은 사람의 컷이 여럿이면 마지막 것이다', () => {
    const twice = parseFilm({
      ...TOGETHER,
      firstScene: { ...TOGETHER.firstScene, beats: [...TOGETHER.firstScene.beats, { kind: 'cut', image: POSTER }, { kind: 'say', cast: 'c1', text: '이번 주 어땠어요.' }] },
    });
    expect(cutFor(twice, 'c1')).toBe(POSTER);
  });
});

describe('한자리: 한 사람에게 한 말을 모두가 듣는다', () => {
  it('지후는 내가 한서에게 한 말과 한서의 답을 들었다', async () => {
    const { send, calls } = await setup(TOGETHER, { reply: (c) => (c.layers.cast.includes('이름: 한서') ? '책을 내려놓는다.\n"그건 제가 할게요."' : '"아 그래요?"') });
    await send('한서 씨, 이 책은 어디에 꽂아요?');
    await send('지후 씨는 뭐 읽어요?', 'c2');

    const toJihu = calls('reply').at(-1)!;
    expect(toJihu.layers.cast).toContain('이름: 지후');
    expect(toJihu.layers.scene).toContain('[지금 이 자리]\n너, 수아, 한서. 모두 한자리에 있다.');
    expect(toJihu.layers.scene).toContain('수아: 한서 씨, 이 책은 어디에 꽂아요?');
    expect(toJihu.layers.scene).toContain('책을 내려놓는다.');
    expect(toJihu.layers.scene).toContain('한서: "그건 제가 할게요."');
    expect(toJihu.user).toBe('지후 씨는 뭐 읽어요?');
  });

  it('답은 불린 사람의 방에 적힌다. 흐름에서는 작중 시각 순으로 한데 놓인다', async () => {
    const { send } = await setup();
    await send('안녕하세요.');
    const v = await send('지후 씨도 안녕하세요.', 'c2');
    expect(v.messages.map((m) => [m.room, m.speaker])).toEqual([
      ['c1', 'persona'],
      ['c1', 'tell'],
      ['c1', 'c1'],
      ['c2', 'persona'],
      ['c2', 'tell'],
      ['c2', 'c2'],
    ]);
    expect(v.messages.map((m) => m.at)).toEqual([3, 3, 3, 6, 6, 6]);
  });

  it('따로 있는 캐스트는 듣지 못한다', async () => {
    const { send, calls } = await setup(APART);
    await send('한서 씨, 이 책은 어디에 꽂아요?');
    await send('지후 씨는 뭐 읽어요?', 'c2');
    const toJihu = calls('reply').at(-1)!;
    expect(toJihu.layers.scene).not.toContain('[지금 이 자리]');
    expect(toJihu.layers.scene).not.toContain('이 책은 어디에 꽂아요');
    expect(calls('join')).toHaveLength(0);
  });
});

describe('한자리: 다른 사람도 낀다', () => {
  const JOIN = '책등을 훑다가 고개를 든다.\n"그건 저도 궁금했는데."';

  it('내 말이 잇달아 이어지는 동안 한마디도 못 했으면 차례가 온다', async () => {
    const { send, calls } = await setup(TOGETHER, { join: JOIN });
    await send('안녕하세요.');
    expect(calls('join')).toHaveLength(0);

    const v = await send('오늘 손님이 없네요.');
    expect(calls('join')).toHaveLength(1);
    expect(calls('join')[0]!.layers.cast).toContain('이름: 지후');
    // 방금 한서가 한 답까지 듣고 낀다
    expect(calls('join')[0]!.layers.scene).toContain('수아: 오늘 손님이 없네요.');
    expect(calls('join')[0]!.layers.scene).toContain('한서: "응, 듣고 있어."');
    // 같은 턴에, 한서의 답 뒤에 놓인다
    expect(v.messages.slice(-5).map((m) => [m.room, m.speaker, m.at])).toEqual([
      ['c1', 'persona', 6],
      ['c1', 'tell', 6],
      ['c1', 'c1', 6],
      ['c2', 'tell', 6],
      ['c2', 'c2', 6],
    ]);
    expect(v.messages.at(-1)!.text).toBe('그건 저도 궁금했는데.');
    expect(new Set(v.messages.slice(-5).map((m) => m.turnId)).size).toBe(1);

    // 방금 끼었으니 다음 말에는 차례가 오지 않는다
    await send('그렇죠?');
    expect(calls('join')).toHaveLength(1);
  });

  it('방금 오간 말에 불렸으면 바로 낀다', async () => {
    const { send, calls } = await setup(TOGETHER, { join: JOIN });
    await send('한서 씨, 지후 씨는 원래 저래요?');
    expect(calls('join')).toHaveLength(1);
  });

  it('낄 까닭이 없다고 넘기면 아무 말도 남지 않는다', async () => {
    const { ctx, send, calls } = await setup(TOGETHER);
    await send('안녕하세요.');
    const v = await send('오늘 손님이 없네요.');
    expect(calls('join')).toHaveLength(1);
    expect(v.messages.filter((m) => m.room === 'c2')).toHaveLength(0);
    expect(v.stuck).toBeNull();
    const notes = (await ctx.db.all<{ note: string | null }>("SELECT note FROM gen_log WHERE purpose = 'join'")).map((r) => r.note);
    expect(notes).toEqual(['끼지 않고 넘김']);
  });

  it('끼는 말을 못 받아도 턴은 끝난 것이다', async () => {
    const { send, calls } = await setup(TOGETHER, {
      join: () => {
        throw new Error('모델이 죽었다');
      },
    });
    await send('안녕하세요.');
    const v = await send('오늘 손님이 없네요.');
    expect(calls('join')).toHaveLength(1);
    expect(v.stuck).toBeNull();
    expect(v.messages.at(-1)!.speaker).toBe('c1');
    // 다음 말도 그대로 보낼 수 있다
    expect((await send('그렇죠?')).elapsed).toBe(9);
  });

  it('차례를 정하는 것은 코드다: 불렸는가, 오래 잠잠했는가', () => {
    const film = parseFilm(TOGETHER);
    const [hanseo, jihu] = film.casts as [(typeof film.casts)[0], (typeof film.casts)[0]];
    const line = (room: string, speaker: string) => ({ id: uid(), room, speaker, text: '', at: 0, kind: 'chat' as const, turnId: 't' });
    // 이름, 불리는 이름, 다른 캐스트가 부르는 말
    expect(takesTurn(film, jihu, [], ['지후 씨는요?'])).toBe(true);
    expect(takesTurn(film, jihu, [], ['단골 손님 오셨네.'])).toBe(true);
    expect(takesTurn(film, hanseo, [], ['한서는 원래 저래.'])).toBe(true);
    // 한 글자짜리 부르는 말(「형」)은 치지 않는다
    expect(takesTurn(film, jihu, [], ['형편이 좀 그래요.'])).toBe(false);
    // 잠잠했던 만큼
    const quiet = [line('c1', 'persona'), line('c1', 'c1'), line('c1', 'persona'), line('c1', 'c1')];
    expect(takesTurn(film, jihu, quiet.slice(0, 2), [])).toBe(false);
    expect(takesTurn(film, jihu, quiet, [])).toBe(RULES.scene.quietTurns <= 2);
    // 그 사람의 차례에 쓰인 지문도 그 사람이 움직인 것이다
    expect(takesTurn(film, jihu, [...quiet.slice(0, 2), line('c2', 'tell'), line('c1', 'persona'), line('c1', 'c1')], [])).toBe(false);
  });
});

describe('한자리: 시간을 넘긴 뒤', () => {
  it('앞 장면과 지금 사이에 시간이 흘렀다고 적힌다', async () => {
    const { ctx, playId, send, calls } = await setup();
    await send('먼저 가 볼게요.');
    await skip(ctx, playId, { kind: 'sleep', requestId: uid() });
    await send('좋은 아침이에요.');
    const { scene } = calls('reply').at(-1)!.layers;
    expect(scene).toContain('[지금]\n토요일 아침.');
    const lines = scene.split('\n');
    expect(lines.at(-1)).toBe('(시간이 흘렀다. 지금은 토요일 아침.)');
    expect(lines.at(-2)).toBe('한서: "응, 듣고 있어."');
  });

  it('지나간 장면 사이에서 벌어진 자리에도 적힌다', async () => {
    const { ctx, playId, send, calls } = await setup();
    await send('먼저 가 볼게요.');
    await skip(ctx, playId, { kind: 'sleep', requestId: uid() });
    await send('좋은 아침이에요.');
    await send('잘 잤어요?');
    const lines = calls('reply').at(-1)!.layers.scene.split('\n');
    const at = lines.indexOf('(시간이 흘렀다. 지금은 토요일 아침.)');
    expect(lines[at - 1]).toBe('한서: "응, 듣고 있어."');
    expect(lines[at + 1]).toBe('수아: 좋은 아침이에요.');
    // 방금 한 말 뒤로는 시간이 흐르지 않았다
    expect(lines.filter((l) => l.startsWith('(시간이 흘렀다'))).toHaveLength(1);
  });

  it('한마디도 안 하고 넘겼으면 오프닝 뒤에 적힌다', async () => {
    const { ctx, playId, send, calls } = await setup();
    await skip(ctx, playId, { kind: 'sleep', requestId: uid() });
    await send('좋은 아침이에요.');
    const { scene } = calls('reply').at(-1)!.layers;
    expect(scene).toContain('문 위의 종이 한 번 울린다.\n\n(시간이 흘렀다. 지금은 토요일 아침.)');
    expect(scene).not.toContain('[지금까지의 장면]');
  });

  it('잠깐 비운 것은 같은 장면이다', async () => {
    const { ctx, playId, send, calls } = await setup();
    await send('잠깐만요.');
    await skip(ctx, playId, { kind: 'short', requestId: uid() });
    await send('다녀왔어요.');
    expect(calls('reply').at(-1)!.layers.scene).not.toContain('시간이 흘렀다');
  });
});

describe('한자리: 자리를 비운 사이', () => {
  const OPEN = { ...TOGETHER, opens: { feed: true, ping: true, aside: true } };

  it('혼자 보낸 시간을 적을 때도 그 자리에서 오간 말을 안다', async () => {
    const { ctx, playId, send, calls } = await setup(OPEN);
    await send('한서 씨, 저 먼저 가 볼게요.');
    await skip(ctx, playId, { kind: 'sleep', requestId: uid() });
    const ofJihu = calls('gap').find((c) => c.layers.cast.includes('이름: 지후'))!;
    expect(ofJihu.layers.scene).toContain('[구간 직전의 대화]');
    expect(ofJihu.layers.scene).toContain('수아: 한서 씨, 저 먼저 가 볼게요.');
    expect(ofJihu.layers.scene).toContain('한서: 응, 듣고 있어.');
  });

  it('한편의 작가에게는 셋이 있던 자리의 말이 둘 다 아는 일로 건네진다', async () => {
    const { ctx, playId, send, calls } = await setup(OPEN);
    await send('한서 씨, 저 먼저 가 볼게요.');
    await skip(ctx, playId, { kind: 'sleep', requestId: uid() });
    const { scene } = calls('aside')[0]!.layers;
    const [shared, rest] = scene.split('[둘 다 아는 일]')[1]!.split('만 아는 일') as [string, string | undefined];
    expect(shared).toContain('수아까지 셋이 함께 있던 자리에서 오간 말:');
    expect(shared).toContain('수아: 한서 씨, 저 먼저 가 볼게요.');
    expect(scene).not.toContain('말을 나눈 적이 없다');
    expect(scene).not.toContain('나눈 말:');
    expect(rest ?? '').not.toContain('먼저 가 볼게요');
  });

  it('따로 있는 캐스트끼리의 한편은 전과 같다', async () => {
    const { ctx, playId, send, calls } = await setup({ ...APART, opens: { feed: true, ping: true, aside: true } });
    await send('한서 씨, 저 먼저 가 볼게요.');
    await skip(ctx, playId, { kind: 'sleep', requestId: uid() });
    const { scene } = calls('aside')[0]!.layers;
    expect(scene).toContain('[한서만 아는 일 — 지후는 한서에게 듣기 전에는 모른다]');
    expect(scene).toContain('- 수아와 나눈 말:');
    expect(scene).toContain('[지후만 아는 일 — 한서는 지후에게 듣기 전에는 모른다]\n- 수아와 말을 나눈 적이 없다.');
    expect(scene).not.toContain('셋이 함께 있던 자리');
  });
});
