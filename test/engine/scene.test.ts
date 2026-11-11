import { describe, expect, it } from 'vitest';
import { RULES } from '../../shared/rules';
import { createFilm, parseFilm } from '../../worker/engine/films';
import { skip } from '../../worker/engine/skip';
import { viewOf } from '../../worker/engine/store';
import { lastShapes, parseScene, rhythmFor } from '../../worker/engine/talk';
import { enter, retry, say } from '../../worker/engine/turn';
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
    expect(calls('reply').at(-1)!.user.split('\n')[0]).toBe('수아: 두 분은 원래 아는 사이예요?');
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
    expect(calls('reply')[0]!.user.split('\n(이번 대목은')[0]).toBe('(수아의 지문) 책 몇 권을 들고 서가 앞에 선다.\n수아: 이건 어디에 꽂아요?');
    // 한 번 보낸 것은 한 턴이다. 시계도 한 번만 간다
    expect(v.elapsed).toBe(3);
    expect(new Set(v.messages.map((m) => m.turnId)).size).toBe(1);
  });

  it('지문만 보내도 된다. 다음에는 지나간 장면에 지문으로 적힌다', async () => {
    const { send, calls } = await setup();
    const v = await send('', '말없이 문을 열고 나간다.');
    expect(v.messages[0]).toMatchObject({ speaker: 'persona', kind: 'act', text: '말없이 문을 열고 나간다.' });
    expect(calls('reply')[0]!.user.split('\n(이번 대목은')[0]).toBe('(수아의 지문) 말없이 문을 열고 나간다.');
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

describe('본편: 대목의 모양', () => {
  const line = (turnId: string, speaker: string, kind: 'chat' | 'ping' | 'act' = 'chat') => ({ id: uid(), room: 'scene', speaker, text: '', at: 0, kind, turnId });

  it('작가가 쓴 대목의 모양을 센다. 유저가 쓴 것과 폰으로 온 메시지는 치지 않는다', () => {
    expect(lastShapes([line('t1', 'persona', 'act'), line('t1', 'persona'), line('t1', 'tell'), line('t1', 'c1'), line('t2', 'c1', 'ping'), line('t3', 'persona'), line('t3', 'c1'), line('t3', 'c2')])).toEqual(['지문 → 대사', '대사']);
    expect(lastShapes([line('t1', 'persona')])).toEqual([]);
  });

  it('이번 대목을 어떤 차례로 짤지 짚어 준다. 바로 앞 대목과 열고 닫는 것이 같은 차례는 고르지 않는다', () => {
    const tellSay = [line('t1', 'tell'), line('t1', 'c1')];
    const sayTell = [line('t1', 'c1'), line('t1', 'tell')];
    const seeds = Array.from({ length: 80 }, (_, i) => `turn-${i}`);
    const picked = (before: ReturnType<typeof line>[]) => [...new Set(seeds.map((seed) => rhythmFor(before, seed)))];
    const ends = (shape: string) => [shape.split(' → ')[0], shape.split(' → ').at(-1)];
    // 앞에 쓴 대목이 없으면 여섯 가운데 하나. 네 덩이 아니면 다섯 덩이다
    expect(picked([])).toHaveLength(6);
    expect(new Set(picked([]).map((s) => s.split(' → ').length))).toEqual(new Set([4, 5]));
    // 앞 대목이 지문으로 열고 대사로 닫았으면 그렇게 짜인 차례는 빼고 고른다
    expect(picked(tellSay)).toHaveLength(5);
    expect(picked(tellSay).map(ends)).not.toContainEqual(['지문', '대사']);
    expect(picked(sayTell).map(ends)).not.toContainEqual(['대사', '지문']);
    // 같은 턴이면 늘 같은 것을 고른다
    expect(rhythmFor(tellSay, 'turn-7')).toBe(rhythmFor(tellSay, 'turn-7'));
  });

  it('유저가 쓴 것 바로 뒤에 붙여 건넨다. 다시 받아도 같은 말이다', async () => {
    let n = 0;
    const { ctx, playId, send, calls } = await setup(FILM, { reply: () => (n++ === 0 ? '' : '한서가 고개를 든다.\n한서: "응, 듣고 있어."') });
    await send('첫째 말.');
    const first = calls('reply')[0]!.user;
    expect(first).toMatch(/^수아: 첫째 말\.\n\(이번 대목은 대략 이 차례로 쓴다: (지문|대사)( → (지문|대사)){3,4}\. 지문 한 덩이는 한두 문장이다\.\)$/);
    await retry(ctx, playId);
    expect(calls('reply')[1]!.user).toBe(first);

    // 앞 대목이 「지문 → 대사」였으니 이번에는 그렇게 이르지 않는다
    await send('둘째 말.');
    expect(calls('reply')[2]!.user).not.toMatch(/차례로 쓴다: 지문 → [^.]* → 대사\./);
  });
});

describe('본편: 같은 말이 돌 때', () => {
  /** 대목마다 글은 다른데 지문에는 「무심-」이, 대사에는 「글쎄요」가 번번이 붙는다 */
  const TICS = [
    '한서가 무심하게 책장을 넘긴다.\n한서: "글쎄요. 잘 모르겠어요."',
    '무심한 얼굴로 계산대를 닦는다.\n한서: "글쎄요, 내일은 어떨지."',
    '종이 울린다. 한서는 무심히 문 쪽을 본다.\n한서: "어서 오세요."\n한서: "글쎄요."',
  ];
  const CUE =
    '(요즘 지문에 자주 나온 말: 「무심」. 요즘 대사에 자주 나온 말: 「글쎄요」. 버릇처럼 붙는 말과 되풀이되는 몸짓이면 이번에는 쓰지 않는다. 이야기에 꼭 있어야 하는 말은 그대로 쓴다.)';

  it('요즘 대목들에 자주 나온 말을 지문과 대사로 갈라 알려 준다. 이름은 세지 않는다', async () => {
    let n = 0;
    const { send, calls } = await setup(FILM, { reply: () => TICS[n++ % TICS.length]! });
    await send('하나.');
    await send('둘.');
    await send('셋.');
    // 두 번 나온 말은 아직 버릇이 아니다
    expect(calls('reply')[2]!.user.split('\n')).toHaveLength(2);
    await send('넷.');
    const told = calls('reply')[3]!.user.split('\n');
    expect(told[0]).toBe('수아: 넷.');
    expect(told[1]).toMatch(/^\(이번 대목은 대략 이 차례로 쓴다: /);
    expect(told[2]).toBe(CUE);
  });

  it('알려 주기만 한다. 받은 대목은 그대로 놓인다', async () => {
    let n = 0;
    const { send } = await setup(FILM, { reply: () => TICS[n++ % TICS.length]! });
    for (const text of ['하나.', '둘.', '셋.', '넷.']) await send(text);
    const v = await send('다섯.');
    expect(v.messages.slice(-2).map((m) => m.text)).toEqual(['무심한 얼굴로 계산대를 닦는다.', '글쎄요, 내일은 어떨지.']);
  });

  it('도는 말이 없으면 아무것도 붙이지 않는다. 유저가 되풀이한 말은 세지 않는다', async () => {
    let n = 0;
    const { send, calls } = await setup(FILM, { reply: () => `한서가 ${['책을 꽂는다', '창을 연다', '불을 켠다', '의자를 뺀다'][n++ % 4]}.` });
    for (const text of ['글쎄요.', '글쎄요.', '글쎄요.', '글쎄요.']) await send(text, '무심하게 선다.');
    expect(calls('reply').at(-1)!.user).not.toContain('자주 나온 말');
  });

  it('다시 받아도 같은 말을 건넨다', async () => {
    let n = 0;
    const { ctx, playId, send, calls } = await setup(FILM, { reply: () => (n === 3 ? (n++, '') : TICS[n++ % TICS.length]!) });
    for (const text of ['하나.', '둘.', '셋.', '넷.']) await send(text);
    await retry(ctx, playId);
    expect(calls('reply')[4]!.user).toBe(calls('reply')[3]!.user);
    expect(calls('reply')[4]!.user).toContain(CUE);
  });
});

describe('본편: 지나간 장면을 얼마나 건네나', () => {
  it('스무 턴 전에 한 말도 건네진다', async () => {
    const { send, calls } = await setup();
    await send('제 일당은 십일만 원이에요.');
    for (let i = 0; i < 20; i++) await send(`${i}번째 말.`);
    expect(calls('reply').at(-1)!.layers.scene).toContain('[지금까지의 장면]\n수아: 제 일당은 십일만 원이에요.');
  });

  it('아주 길어지면 오래된 말부터 빠진다. 방금 오간 말은 남는다', async () => {
    const { send, calls } = await setup(FILM, { reply: `한서: "${'나'.repeat(300)}"` });
    await send('맨 처음 한 말.');
    // 한 턴에 700자쯤 쌓인다. 스물네 턴이면 건네는 양을 넘긴다
    for (let i = 0; i < 24; i++) await send(`${i}번째. ${'가'.repeat(380)}`);
    await send('방금 한 말.');
    const { scene } = calls('reply').at(-1)!.layers;
    const history = scene.split('[지금까지의 장면]\n')[1]!;
    expect(history).not.toContain('맨 처음 한 말.');
    expect(history).not.toContain('수아: 0번째.');
    expect(history).toContain('수아: 23번째.');
    expect(history.length).toBeLessThanOrEqual(RULES.history.chars);
    // 줄 수로 자르지 않는다. 서른 줄보다 많이 실린다
    expect(history.split('\n').length).toBeGreaterThan(30);
    expect(calls('reply').at(-1)!.user.split('\n')[0]).toBe('수아: 방금 한 말.');
  });

  it('먼저 거는 연락을 쓸 때도 같은 만큼 건넨다', async () => {
    const OPEN = { ...FILM, opens: { feed: false, ping: true, aside: false } };
    const { ctx, playId, send, calls } = await setup(OPEN, {
      reply: '한서가 책을 꽂는다.\n한서: "네."\n종이 울린다.\n한서: "어서 오세요."',
      gap: '19:10 | 말거리 | 저녁에 뭘 먹을지 한참 골랐다.',
    });
    await send('제 일당은 십일만 원이에요.');
    // 한 턴에 다섯 줄씩, 그 뒤로 마흔 줄 넘게 쌓인다
    for (let i = 0; i < 9; i++) await send(`${i}번째 말.`);
    await skip(ctx, playId, { kind: 'sleep', requestId: uid() });
    const pings = calls('ping');
    expect(pings.length).toBeGreaterThan(0);
    expect(pings[0]!.layers.scene).toContain('[지금까지의 장면]\n수아: 제 일당은 십일만 원이에요.');
  });
});

describe('본편: 지금 있는 곳', () => {
  const film = parseFilm(FILM);

  it('「장소 | 곳」 줄은 흐름에 놓지 않고 곳으로 읽는다', () => {
    const r = parseScene('장소 | 안쪽 서가\n한서가 책을 꽂는다.\n한서: "여기예요."', film);
    expect(r.place).toBe('안쪽 서가');
    expect(r.pieces).toEqual([
      { speaker: 'tell', text: '한서가 책을 꽂는다.' },
      { speaker: 'c1', text: '여기예요.' },
    ]);
    // 적지 않았으면 모른다. 너무 길면 받지 않는다
    expect(parseScene('한서: "여기예요."', film).place).toBeNull();
    expect(parseScene(`장소 | ${'가'.repeat(41)}\n한서: "여기예요."`, film)).toMatchObject({ place: null, pieces: [{ speaker: 'c1', text: '여기예요.' }] });
  });

  it('이야기는 디렉터가 적은 곳에서 시작한다. 작가가 곳을 알려 주면 그리로 바뀐다', async () => {
    const { ctx, playId, send, calls } = await setup(FILM, {
      reply: (call) => (call.user.includes('안쪽') ? '장소 | 안쪽 서가\n한서가 따라 들어온다.\n한서: "여기예요."' : '한서: "네."'),
    });
    expect((await viewOf(ctx, playId)).place).toBe('서점 계산대');
    expect((await send('안녕하세요.')).place).toBe('서점 계산대');
    expect(calls('reply')[0]!.layers.scene).toContain('[지금]\n금요일 낮.\n바로 앞 대목까지 있던 곳: 서점 계산대');

    const v = await send('', '책을 안고 안쪽 서가로 들어간다.');
    expect(v.place).toBe('안쪽 서가');
    expect(v.messages.some((m) => m.text.includes('장소'))).toBe(false);
    // 다음 대목을 쓸 때는 옮겨 간 곳을 안다
    await send('여기 맞아요?');
    expect(calls('reply').at(-1)!.layers.scene).toContain('바로 앞 대목까지 있던 곳: 안쪽 서가');
  });

  it('유저가 지문을 쓴 턴에는, 자리를 옮겼으면 곳도 옮겨 적으라고 이른다', async () => {
    const { send, calls } = await setup();
    await send('여기 맞아요?', '책을 안고 안쪽 서가로 들어간다.');
    await send('여기 맞아요?');
    const cue = '(위 지문에서 수아가 자리를 옮겼으면 첫 줄의 곳을 옮겨 간 곳으로 적는다.)';
    expect(calls('reply')[0]!.user.split('\n')).toContain(cue);
    // 지문 없이 말만 보낸 턴에는 붙이지 않는다
    expect(calls('reply')[1]!.user).not.toContain('자리를 옮겼으면');
  });

  it('오래 비우고 돌아오면 어디인지 모른다. 잠깐 비운 것은 그대로다', async () => {
    const { ctx, playId, send, calls } = await setup();
    await send('잠깐만요.');
    expect((await skip(ctx, playId, { kind: 'short', requestId: uid() })).place).toBe('서점 계산대');
    expect((await skip(ctx, playId, { kind: 'sleep', requestId: uid() })).place).toBe('');
    await send('좋은 아침이에요.');
    expect(calls('reply').at(-1)!.layers.scene).not.toContain('있던 곳');
  });
});

describe('본편: 대목이 끝났을 때의 모습', () => {
  const film = parseFilm(FILM);
  const POSE = '한서는 계산대 뒤에 서 있다. 펜은 계산대 위에 놓여 있다.';
  const WITH_POSE = `장소 | 계산대\n한서가 펜을 내려놓는다.\n한서: "네."\n모습 | ${POSE}`;

  it('「모습 | …」 줄은 흐름에 놓지 않고 따로 읽는다', () => {
    const r = parseScene(WITH_POSE, film);
    expect(r.pose).toBe(POSE);
    expect(r.pieces).toEqual([
      { speaker: 'tell', text: '한서가 펜을 내려놓는다.' },
      { speaker: 'c1', text: '네.' },
    ]);
    // 이름표를 꾸며도 읽는다. 적지 않았으면 모른다. 너무 길면 받지 않는다
    expect(parseScene(`한서: "네."\n**모습** : ${POSE}`, film)).toMatchObject({ pose: POSE, pieces: [{ speaker: 'c1', text: '네.' }] });
    expect(parseScene('한서: "네."', film).pose).toBeNull();
    expect(parseScene(`한서: "네."\n모습 | ${'가'.repeat(301)}`, film)).toMatchObject({ pose: null, pieces: [{ speaker: 'c1', text: '네.' }] });
  });

  it('다음 대목을 쓸 때 [지금]에 적혀 돌아간다. 화면에는 나오지 않는다', async () => {
    let n = 0;
    const { send, calls } = await setup(FILM, { reply: () => (n++ === 0 ? WITH_POSE : '한서: "네."') });
    const v = await send('안녕하세요.');
    expect(v.messages.some((m) => m.text.includes('모습'))).toBe(false);
    expect(JSON.stringify(v)).not.toContain(POSE);
    // 아직 적어 준 적이 없으니 첫 대목에는 건네지 않는다
    expect(calls('reply')[0]!.layers.scene).not.toContain('끝났을 때의 모습');

    await send('뭐 하세요?');
    expect(calls('reply')[1]!.layers.scene).toContain(`[지금]\n금요일 낮.\n바로 앞 대목까지 있던 곳: 계산대\n바로 앞 대목이 끝났을 때의 모습: ${POSE}`);

    // 작가가 적지 않았으면 모른다. 묵은 모습을 건네지 않는다
    await send('그렇군요.');
    expect(calls('reply')[2]!.layers.scene).not.toContain('끝났을 때의 모습');
  });

  it('오래 비우고 돌아오면 모른다. 잠깐 비운 것은 그대로다', async () => {
    const { ctx, playId, send, calls } = await setup(FILM, { reply: WITH_POSE });
    await send('잠깐만요.');
    await skip(ctx, playId, { kind: 'short', requestId: uid() });
    await send('다녀왔어요.');
    expect(calls('reply').at(-1)!.layers.scene).toContain(`끝났을 때의 모습: ${POSE}`);
    await skip(ctx, playId, { kind: 'sleep', requestId: uid() });
    await send('좋은 아침이에요.');
    expect(calls('reply').at(-1)!.layers.scene).not.toContain('끝났을 때의 모습');
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
