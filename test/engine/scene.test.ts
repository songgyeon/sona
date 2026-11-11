import { describe, expect, it } from 'vitest';
import { createFilm, parseFilm } from '../../worker/engine/films';
import { skip } from '../../worker/engine/skip';
import { viewOf } from '../../worker/engine/store';
import { parseScene } from '../../worker/engine/talk';
import { enter, say } from '../../worker/engine/turn';
import { Fail } from '../../worker/engine/ctx';
import { FAKE_DEFAULTS } from '../../worker/model/fake';
import type { ModelCall, Purpose } from '../../worker/model/index';
import { DEV_FILM, testCtx, uid } from '../helpers/film';

/* 본편 — 채팅은 하나다. 작가(대사 모델)가 나오는 사람들을 모두 맡아 쓰고, 누가 나오고 누가 말할지도 정한다.
   유저의 인물만은 쓰지 못한다. 그 사람의 말과 지문은 유저가 쓴다.
   임시 필름(동네 서점): 유저의 인물은 수아, 한서(c1)와 지후(c2). 금요일 오후 4시에 시작한다. */

const FILM = {
  ...DEV_FILM,
  opens: { feed: false, ping: false, aside: false },
  firstScene: {
    place: '서점 계산대',
    beats: [
      { kind: 'tell', text: '손님이 끊긴 오후.' },
      { kind: 'say', cast: 'c1', text: '수아 씨, 그건 이쪽 칸이에요.' },
      { kind: 'tell', text: '문 위의 종이 한 번 울린다.' },
    ],
    room: 'c1',
    speaker: 'persona',
  },
};

type Part = string | ((call: ModelCall) => string);
async function setup(film: unknown = FILM, parts: Partial<Record<Purpose, Part>> = {}) {
  const ctx = testCtx((call) => {
    const p = parts[call.purpose];
    if (p === undefined) return FAKE_DEFAULTS[call.purpose];
    return typeof p === 'function' ? p(call) : p;
  });
  const { id: filmId } = await createFilm(ctx, film);
  const playId = uid();
  await enter(ctx, filmId, playId);
  const send = (text: string, tell = '') => say(ctx, playId, { text, tell, requestId: uid() });
  const calls = (purpose: Purpose) => ctx.model.calls.filter((c) => c.purpose === purpose);
  return { ctx, filmId, playId, send, calls };
}

async function failOf(p: Promise<unknown>): Promise<Fail | null> {
  try {
    await p;
  } catch (e) {
    if (e instanceof Fail) return e;
    throw e;
  }
  return null;
}

describe('본편: 작가가 쓴 대목 읽기', () => {
  const film = parseFilm(FILM);
  const read = (raw: string) => parseScene(raw, film);

  it('「이름: "대사"」 줄은 그 캐스트의 대사고, 나머지는 지문이다. 대사를 감싼 따옴표만 벗긴다', () => {
    const r = read('한서가 책을 내려놓는다.\n한서: "그건 제가 할게요."\n창가에서 지후가 고개를 든다.\n지후: "오늘도 그 자리 비었어요?"');
    expect(r.pieces).toEqual([
      { speaker: 'tell', text: '한서가 책을 내려놓는다.' },
      { speaker: 'c1', text: '그건 제가 할게요.' },
      { speaker: 'tell', text: '창가에서 지후가 고개를 든다.' },
      { speaker: 'c2', text: '오늘도 그 자리 비었어요?' },
    ]);
    expect(r.personaSpoke).toBe(false);
  });

  it('이어지는 지문은 한 덩이로 둔다. 모르는 이름이 붙은 줄은 지문이다', () => {
    const r = read('물이 끓는다.\n컵이 두 개 놓여 있다.\n손님: "이 책 있어요?"\n한서: 네, 있어요.');
    expect(r.pieces).toEqual([
      { speaker: 'tell', text: '물이 끓는다.\n컵이 두 개 놓여 있다.\n손님: "이 책 있어요?"' },
      { speaker: 'c1', text: '네, 있어요.' },
    ]);
  });

  it('이름표를 꾸민 기호는 떼고 읽는다', () => {
    expect(read('**한서**: "왔어요?"\n[지후] : "어서 와요."').pieces).toEqual([
      { speaker: 'c1', text: '왔어요?' },
      { speaker: 'c2', text: '어서 와요.' },
    ]);
  });

  it('유저의 인물이 말하는 줄은 받지 않는다', () => {
    const r = read('한서가 고개를 든다.\n수아: "저 왔어요."\n한서: "어, 왔어요?"');
    expect(r.personaSpoke).toBe(true);
    expect(r.pieces).toEqual([
      { speaker: 'tell', text: '한서가 고개를 든다.' },
      { speaker: 'c1', text: '어, 왔어요?' },
    ]);
  });

  it('캐스트가 한 명뿐이면, 이름 없이 따옴표로만 감싼 줄도 그 사람의 말이다', () => {
    const solo = parseFilm({ ...FILM, casts: [FILM.casts[0]], ties: [] });
    expect(parseScene('고개를 든다.\n"왔어요?"', solo).pieces).toEqual([
      { speaker: 'tell', text: '고개를 든다.' },
      { speaker: 'c1', text: '왔어요?' },
    ]);
    // 여럿이면 누구의 말인지 알 수 없다. 지문으로 둔다
    expect(read('고개를 든다.\n"왔어요?"').pieces).toEqual([{ speaker: 'tell', text: '고개를 든다.\n"왔어요?"' }]);
  });
});

describe('본편: 채팅은 하나다', () => {
  it('작가는 나오는 사람 모두의 카드를 받는다. 유저의 인물은 따로 적힌다', async () => {
    const { send, calls } = await setup();
    await send('안녕하세요.');
    const { cast, system } = calls('reply')[0]!.layers;
    expect(cast).toContain('[나오는 사람들]\n이름: 한서');
    expect(cast).toContain('\n\n이름: 지후');
    expect(cast).toContain('- 지후를 「형」이라고 부른다');
    expect(cast).toContain('- 자는 시간: 01:00 ~ 08:30');
    expect(cast).toContain('[유저의 인물]\n수아 — 이번 주에 새로 온 서점 알바');
    expect(system).toContain('[유저의 인물]은 네가 쓰지 않는다');
  });

  it('누가 말하든 한 흐름에 놓인다. 누가 나올지는 작가가 정한다', async () => {
    const SCENE = '한서가 책을 내려놓는다.\n한서: "그건 제가 할게요."\n창가에서 지후가 고개를 든다.\n지후: "오늘도 그 자리 비었어요?"';
    const { send } = await setup(FILM, { reply: SCENE });
    const v = await send('이 책은 어디에 꽂아요?');
    expect(v.messages.map((m) => [m.speaker, m.kind, m.text])).toEqual([
      ['persona', 'chat', '이 책은 어디에 꽂아요?'],
      ['tell', 'chat', '한서가 책을 내려놓는다.'],
      ['c1', 'chat', '그건 제가 할게요.'],
      ['tell', 'chat', '창가에서 지후가 고개를 든다.'],
      ['c2', 'chat', '오늘도 그 자리 비었어요?'],
    ]);
    expect(new Set(v.messages.map((m) => m.room))).toEqual(new Set(['scene']));
    expect(new Set(v.messages.map((m) => m.at))).toEqual(new Set([3]));
  });

  it('지나간 장면은 누가 한 말인지 이름과 함께 건네진다', async () => {
    const { send, calls } = await setup(FILM, { reply: '한서: "그건 제가 할게요."\n지후: "오늘도 그 자리 비었어요?"' });
    await send('이 책은 어디에 꽂아요?');
    await send('두 분은 원래 아는 사이예요?');
    const { scene } = calls('reply').at(-1)!.layers;
    expect(scene).toContain('[이야기가 시작된 자리]\n서점 계산대\n손님이 끊긴 오후.\n한서: "수아 씨, 그건 이쪽 칸이에요."');
    expect(scene).toContain('[지금까지의 장면]\n수아: 이 책은 어디에 꽂아요?\n한서: "그건 제가 할게요."\n지후: "오늘도 그 자리 비었어요?"');
    expect(calls('reply').at(-1)!.user).toBe('수아: 두 분은 원래 아는 사이예요?');
  });

  it('작가가 유저의 인물 대사를 쓰면 그 줄은 받지 않는다. 그 줄뿐이면 못 받은 것이다', async () => {
    const some = await setup(FILM, { reply: '수아: "저 먼저 갈게요."\n한서: "벌써요?"' });
    const v = await some.send('오늘 손님이 없네요.');
    expect(v.messages.map((m) => m.speaker)).toEqual(['persona', 'c1']);
    expect(v.stuck).toBeNull();

    const none = await setup(FILM, { reply: '수아: "저 먼저 갈게요."' });
    const w = await none.send('오늘 손님이 없네요.');
    expect(w.stuck).toMatchObject({ status: 'failed', failReason: 'empty' });
    expect(w.messages.map((m) => m.speaker)).toEqual(['persona']);
  });

  it('캐스트마다 방이 따로이던 때의 말도 한 흐름으로 읽힌다', async () => {
    const { ctx, playId, send, calls } = await setup();
    // 예전 모양: 지후의 방에 적힌 말
    const turn = (await ctx.db.first<{ id: string }>('SELECT id FROM turns WHERE play_id = ? ORDER BY turn_no DESC LIMIT 1', playId))!;
    await ctx.db.run(
      "INSERT INTO messages (id, play_id, turn_id, room, speaker, text, at, kind, created_at) VALUES (?, ?, ?, 'c2', 'c2', '아 그거 나도 읽으려고 했는데.', 0, 'chat', 1)",
      uid(),
      playId,
      turn.id,
    );
    const v = await send('뭐 읽으세요?');
    expect(v.messages.map((m) => m.room)).toEqual(['c2', 'scene', 'scene', 'scene']);
    expect(calls('reply').at(-1)!.layers.scene).toContain('[지금까지의 장면]\n지후: "아 그거 나도 읽으려고 했는데."');
  });
});

describe('본편: 내 지문', () => {
  it('지문과 대사를 함께 보낸다. 지문이 먼저 놓인다', async () => {
    const { send, calls } = await setup();
    const v = await send('이건 어디에 꽂아요?', '책 몇 권을 들고 서가 앞에 선다.');
    expect(v.messages.slice(0, 2).map((m) => [m.speaker, m.kind, m.text])).toEqual([
      ['persona', 'act', '책 몇 권을 들고 서가 앞에 선다.'],
      ['persona', 'chat', '이건 어디에 꽂아요?'],
    ]);
    expect(calls('reply')[0]!.user).toBe('(수아의 지문) 책 몇 권을 들고 서가 앞에 선다.\n수아: 이건 어디에 꽂아요?');
    // 한 번 보낸 것은 한 턴이다. 시계도 한 번만 간다
    expect(v.elapsed).toBe(3);
    expect(new Set(v.messages.map((m) => m.turnId)).size).toBe(1);
  });

  it('지문만 보내도 된다. 다음에는 지나간 장면에 지문으로 적힌다', async () => {
    const { send, calls } = await setup();
    const v = await send('', '말없이 문을 열고 나간다.');
    expect(v.messages[0]).toMatchObject({ speaker: 'persona', kind: 'act', text: '말없이 문을 열고 나간다.' });
    expect(calls('reply')[0]!.user).toBe('(수아의 지문) 말없이 문을 열고 나간다.');
    await send('다녀왔어요.');
    expect(calls('reply')[1]!.layers.scene).toContain('[지금까지의 장면]\n(수아의 지문) 말없이 문을 열고 나간다.');
  });

  it('둘 다 비었거나 너무 길면 받지 않는다', async () => {
    const { ctx, playId, send } = await setup();
    expect((await failOf(send('  ', ' ')))?.code).toBe('empty_say');
    expect((await failOf(send('가'.repeat(401))))?.code).toBe('long_say');
    expect((await failOf(send('', '가'.repeat(401))))?.message).toContain('지문');
    expect((await viewOf(ctx, playId)).elapsed).toBe(0);
  });
});

describe('본편: 누가 무엇을 아는가', () => {
  const OPEN = { ...FILM, opens: { feed: true, ping: true, aside: true } };
  const DAY = (call: ModelCall) =>
    call.layers.cast.includes('이름: 한서') ? '18:30 | 일상 | 퇴근길에 약국에 들렀다.\n22:40 | 피드 | 오늘은 일찍 잔다' : '19:00 | 일상 | 연구실에서 늦게까지 실험을 했다.';
  const ASIDE = '장소 | 서점 앞\n둘이 셔터를 내린다.\n한서: "형, 새 알바 봤어요?"\n지후: "봤지. 조용하더라."\n한서: "첫 주니까요."';

  it('모두 아는 일과 몇 사람만 아는 일을 갈라서 건넨다', async () => {
    const { ctx, playId, send, calls } = await setup(OPEN, { gap: DAY, aside: ASIDE });
    await send('먼저 가 볼게요.');
    await skip(ctx, playId, { kind: 'sleep', requestId: uid() });
    await send('좋은 아침이에요.');
    const { scene } = calls('reply').at(-1)!.layers;
    // 피드에 올린 글은 모두가 본다
    expect(scene).toContain('[모두 아는 일]\n- (금요일 밤) 한서의 피드에 올라온 글: 「오늘은 일찍 잔다」');
    // 혼자 한 일은 그 사람만 안다
    expect(scene).toContain('[한서만 아는 일 — 다른 사람은 듣기 전에는 모른다]\n- (금요일 저녁) 퇴근길에 약국에 들렀다.');
    expect(scene).toContain('[지후만 아는 일 — 다른 사람은 듣기 전에는 모른다]\n- (금요일 저녁) 연구실에서 늦게까지 실험을 했다.');
    // 둘이 나눈 이야기는 둘만 안다
    expect(scene).toContain('[한서, 지후만 아는 일 — 다른 사람은 듣기 전에는 모른다]');
    expect(scene).toContain('둘이 나눈 이야기(수아는 그 자리에 없었다)');
  });

  it('캐스트가 한 명이어도 혼자 한 일은 그 사람만 안다', async () => {
    const solo = { ...OPEN, casts: [OPEN.casts[0]], ties: [], opens: { feed: true, ping: true, aside: false } };
    const { ctx, playId, send, calls } = await setup(solo, { gap: '18:30 | 일상 | 퇴근길에 약국에 들렀다.' });
    await send('먼저 가 볼게요.');
    await skip(ctx, playId, { kind: 'sleep', requestId: uid() });
    await send('좋은 아침이에요.');
    expect(calls('reply').at(-1)!.layers.scene).toContain('[한서만 아는 일 — 다른 사람은 듣기 전에는 모른다]\n- (금요일 저녁) 퇴근길에 약국에 들렀다.');
  });
});

describe('본편: 시간을 넘긴 뒤', () => {
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

describe('본편: 자리를 비운 사이', () => {
  const OPEN = { ...FILM, opens: { feed: true, ping: true, aside: true } };

  it('혼자 보낸 시간을 적을 때도 본편에서 오간 말을 안다', async () => {
    const { ctx, playId, send, calls } = await setup(OPEN);
    await send('한서 씨, 저 먼저 가 볼게요.', '가방을 멘다.');
    await skip(ctx, playId, { kind: 'sleep', requestId: uid() });
    const ofJihu = calls('gap').find((c) => c.layers.cast.includes('이름: 지후'))!;
    expect(ofJihu.layers.scene).toContain('[구간 직전의 대화]');
    expect(ofJihu.layers.scene).toContain('수아: 한서 씨, 저 먼저 가 볼게요.');
    expect(ofJihu.layers.scene).toContain('한서: 응, 듣고 있어.');
    // 지문은 대화가 아니다
    expect(ofJihu.layers.scene).not.toContain('가방을 멘다');
  });

  it('한편의 작가에게는 유저의 인물이 있던 자리에서 오간 말이 건네진다', async () => {
    const { ctx, playId, send, calls } = await setup(OPEN);
    await send('한서 씨, 저 먼저 가 볼게요.');
    await skip(ctx, playId, { kind: 'sleep', requestId: uid() });
    const { scene } = calls('aside')[0]!.layers;
    expect(scene).toContain('[수아가 있던 자리에서 최근에 오간 말 — 그 자리에 있던 사람만 들었다]\n수아: 한서 씨, 저 먼저 가 볼게요.\n한서: 응, 듣고 있어.');
  });

  it('아무 말도 나누지 않았으면 그렇다고 적는다', async () => {
    const { ctx, playId, calls } = await setup(OPEN);
    await skip(ctx, playId, { kind: 'sleep', requestId: uid() });
    expect(calls('aside')[0]!.layers.scene).toContain('[수아와는 아직 아무 말도 나누지 않았다]');
  });
});
