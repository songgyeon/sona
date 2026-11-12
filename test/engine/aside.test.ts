import { describe, expect, it } from 'vitest';
import { formatWorld } from '../../shared/clock';
import { RULES } from '../../shared/rules';
import { asideSlot, knownPairs, parseAside, pickPair } from '../../worker/engine/aside';
import { createFilm, parseFilm } from '../../worker/engine/films';
import { skip } from '../../worker/engine/skip';
import { listPlays } from '../../worker/engine/store';
import { enter, say } from '../../worker/engine/turn';
import { FAKE_DEFAULTS } from '../../worker/model/fake';
import type { ModelCall, Purpose } from '../../worker/model/index';
import { TWO_FILM, testCtx, uid } from '../helpers/film';

/* 금요일 오후 4시에 시작한다. 민아(c1)와 이도현(c2)은 서로 아는 사이다(외삼촌과 조카, 회사에서는 숨긴다).
   유저의 인물은 수아. 민아는 0시~6시, 이도현은 0시~7시에 잔다. */
const clock = (elapsed: number) => ({ startDow: 5, startMin: 16 * 60, elapsed });

/** 한편을 여는 필름 */
const OPEN_FILM = { ...TWO_FILM, opens: { feed: false, ping: false, aside: true } };

const SCENE = [
  '장소 | 사무실',
  '사무실에 둘만 남았다. 이도현이 모니터를 끄고 가방을 든다.',
  '이도현: "민아, 저녁은."',
  '민아가 주위를 한 번 둘러본다.',
  '민아: "삼촌, 회사에서는 그렇게 부르지 말라니까요."',
  '이도현: "다 갔어."',
  '민아: "수아 선배가 아까 물어봤어요. 우리 어떻게 아는 사이냐고."',
  '이도현의 손이 가방끈 위에서 멎는다.',
].join('\n');

type Part = string | ((call: ModelCall) => string);
async function setup(parts: Partial<Record<Purpose, Part>>, film: unknown = OPEN_FILM) {
  const ctx = testCtx((call) => {
    const p = parts[call.purpose];
    if (p === undefined) return FAKE_DEFAULTS[call.purpose];
    return typeof p === 'function' ? p(call) : p;
  });
  const { id: filmId } = await createFilm(ctx, film);
  const playId = uid();
  await enter(ctx, filmId, playId);
  const send = (text: string, room = 'c1') => say(ctx, playId, { room, text, requestId: uid() });
  const away = (kind: 'short' | 'errand' | 'evening' | 'sleep') => skip(ctx, playId, { kind, requestId: uid() });
  const calls = (purpose: Purpose) => ctx.model.calls.filter((c) => c.purpose === purpose);
  const notes = async () => (await ctx.db.all<{ note: string | null }>("SELECT note FROM gen_log WHERE purpose IN ('aside', 'check') ORDER BY rowid")).map((r) => r.note);
  return { ctx, playId, send, away, calls, notes };
}

describe('한편: 누가 언제 만나나', () => {
  const film = parseFilm(OPEN_FILM);
  const [mina, dohyun] = film.casts as [(typeof film.casts)[0], (typeof film.casts)[0]];

  it('사이가 적힌 두 사람이 서로 아는 사이다', () => {
    expect(knownPairs(film).map((p) => p.map((c) => c.name))).toEqual([['민아', '이도현']]);
    expect(knownPairs(parseFilm({ ...OPEN_FILM, ties: [] }))).toEqual([]);
  });

  it('장면이 가장 적었던 쌍이 만난다', () => {
    const three = parseFilm({
      ...OPEN_FILM,
      casts: [...OPEN_FILM.casts, { ...OPEN_FILM.casts[0], name: '서준' }],
      ties: [...OPEN_FILM.ties, { from: 'c1', to: 'c3', relation: '입사 동기', calls: '서준 씨' }],
    });
    const names = (counts: [string, number][]) => pickPair(three, new Map(counts))!.map((c) => c.name);
    expect(names([])).toEqual(['민아', '이도현']);
    expect(names([['c1+c2', 1]])).toEqual(['민아', '서준']);
    expect(names([['c1+c2', 1], ['c1+c3', 1]])).toEqual(['민아', '이도현']);
  });

  it('비운 사이에 저녁 9시가 들어 있으면 그때 만난다. 아니면 가운데서 만난다', () => {
    // 금요일 오후 4시 ~ 토요일 오전 7시: 저녁 9시가 들어 있다
    expect(formatWorld(clock(asideSlot(clock(0), mina, dohyun, 0, 900)!))).toBe('금요일 오후 9:00');
    // 금요일 오후 4시 ~ 오후 7시: 저녁 9시가 없다. 가운데인 오후 5시 30분
    expect(formatWorld(clock(asideSlot(clock(0), mina, dohyun, 0, 180)!))).toBe('금요일 오후 5:30');
  });

  it('누가 자고 있으면 만나지 않는다', () => {
    // 토요일 0시 ~ 오전 6시: 둘 다 자는 시간
    expect(asideSlot(clock(0), mina, dohyun, 480, 840)).toBeNull();
  });
});

describe('한편: 장면 읽기', () => {
  const film = parseFilm(OPEN_FILM);
  const [mina, dohyun] = film.casts as [(typeof film.casts)[0], (typeof film.casts)[0]];
  const read = (raw: string) => parseAside(raw, film, mina, dohyun);

  it('곳과 지문과 두 사람의 대사를 가른다. 대사를 감싼 따옴표만 벗긴다', () => {
    const r = read(SCENE);
    expect(r.place).toBe('사무실');
    expect(r.personaSpoke).toBe(false);
    expect(r.pieces.map((p) => p.speaker)).toEqual(['tell', 'c2', 'tell', 'c1', 'c2', 'c1', 'tell']);
    expect(r.pieces[1]!.text).toBe('민아, 저녁은.');
    expect(r.pieces[3]!.text).toBe('삼촌, 회사에서는 그렇게 부르지 말라니까요.');
  });

  it('이어지는 지문은 한 덩이로 둔다. 모르는 이름이 붙은 줄은 지문이다', () => {
    const r = read('장소: 탕비실\n물이 끓는다.\n컵이 두 개 놓여 있다.\n민아: 커피 드실래요?\n경비원: "불 끄고 가요."');
    expect(r.place).toBe('탕비실');
    expect(r.pieces).toEqual([
      { speaker: 'tell', text: '물이 끓는다.\n컵이 두 개 놓여 있다.' },
      { speaker: 'c1', text: '커피 드실래요?' },
      { speaker: 'tell', text: '경비원: "불 끄고 가요."' },
    ]);
  });

  it('곳을 적는 줄이 없거나 너무 길면 곳을 비워 둔다', () => {
    expect(read('민아: "가요."\n이도현: "그래."').place).toBe('');
    expect(read(`장소 | ${'가'.repeat(RULES.limits.place + 1)}\n민아: "가요."`).place).toBe('');
  });

  it('유저의 인물이 말하는 줄이 있으면 그렇다고 알린다', () => {
    expect(read('장소 | 사무실\n수아: "저 왔어요."\n민아: "선배!"').personaSpoke).toBe(true);
  });
});

describe('한편: 자리를 비운 사이', () => {
  it('서로 아는 두 사람의 장면이 하나 생긴다. 줄들은 그 장면만의 자리에 놓인다', async () => {
    const { away, calls } = await setup({ aside: SCENE });
    const v = await away('sleep');

    expect(calls('aside')).toHaveLength(1);
    expect(v.asides).toHaveLength(1);
    const aside = v.asides[0]!;
    expect(aside).toMatchObject({ place: '사무실', casts: ['c1', 'c2'] });
    expect(formatWorld(clock(aside.at))).toBe('금요일 오후 9:00');

    const lines = v.messages.filter((m) => m.room === aside.id);
    expect(lines.map((m) => [m.speaker, m.kind, m.at])).toEqual(
      ['tell', 'c2', 'tell', 'c1', 'c2', 'c1', 'tell'].map((s) => [s, 'aside', aside.at]),
    );
    // 누구와의 방에도 섞이지 않는다
    expect(v.messages.filter((m) => m.kind === 'aside' && (m.room === 'c1' || m.room === 'c2'))).toHaveLength(0);
  });

  it('작가에게는 두 사람의 카드와 사이, 그 자리에 없는 사람이 건네진다', async () => {
    const { send, away, calls } = await setup({ aside: SCENE });
    await send('민아 씨, 팀장님이랑은 원래 알던 사이예요?');
    await away('sleep');

    const { layers } = calls('aside')[0]!;
    expect(layers.cast).toContain('이름: 민아');
    expect(layers.cast).toContain('이름: 이도현');
    expect(layers.cast).toContain('이도현을 「삼촌」이라고 부른다');
    expect(layers.cast).toContain('민아를 「민아」라고 부른다');
    expect(layers.scene).toContain('[그 자리에 없는 사람]\n수아');
    expect(layers.scene).toContain('금요일 밤');
    // 수아가 있던 자리에서 오간 말. 채팅은 하나라서, 그 자리에 누가 있었는지는 누가 말했는지로 안다
    expect(layers.scene).toContain('[수아가 있던 자리에서 최근에 오간 말 — 그 자리에 있던 사람만 들었다]\n수아: 민아 씨, 팀장님이랑은 원래 알던 사이예요?\n민아: 응, 듣고 있어.');
  });

  it('둘 다 아는 일은 한 번만 건넨다. 한 사람만 아는 일은 그 사람 아래에 적힌다', async () => {
    const withFeed = { ...OPEN_FILM, opens: { feed: true, ping: false, aside: true } };
    const day = (call: ModelCall) => (call.layers.cast.includes('이름: 민아') ? '17:10 | 일상 | 퇴근길에 서점에 들렀다.' : '');
    const { ctx, playId, away, calls } = await setup({ aside: SCENE, gap: day, post: '없음' }, withFeed);
    // 내 피드에 올린 글은 모두가 본다
    const { postMine } = await import('../../worker/engine/alive');
    await postMine(ctx, playId, { text: '오늘은 일찍 잔다' });
    await away('evening');
    await away('sleep');

    const scene = calls('aside')[1]!.layers.scene;
    const [both, rest] = scene.split('[민아만 아는 일');
    // 피드에 올린 글은 모두가 본다
    expect(both).toContain('[둘 다 아는 일]');
    expect(both).toContain('오늘은 일찍 잔다');
    // 혼자 한 일은 그 사람만 안다
    expect(both).not.toContain('퇴근길에 서점에 들렀다.');
    expect(rest).toContain('— 이도현은 민아에게 듣기 전에는 모른다]');
    expect(rest).toContain('- (금요일 저녁) 퇴근길에 서점에 들렀다.');
    // 혼자만 아는 일이 없는 사람의 묶음은 적지 않는다
    expect(scene).not.toContain('[이도현만 아는 일');
  });

  it('그 일은 두 사람만 안다. 다른 캐스트의 프롬프트에는 실리지 않는다', async () => {
    const three = {
      ...OPEN_FILM,
      casts: [...OPEN_FILM.casts, { ...OPEN_FILM.casts[0], name: '서준', role: '옆 팀 동기' }],
    };
    const { ctx, send, away, calls } = await setup({ aside: SCENE }, { ...three, opens: { feed: true, ping: false, aside: true } });
    await away('sleep');

    const known = await ctx.db.all<{ known_by: string; text: string }>("SELECT known_by, text FROM events WHERE kind = 'aside'");
    expect(known).toHaveLength(1);
    expect(JSON.parse(known[0]!.known_by)).toEqual(['c1', 'c2']);
    expect(known[0]!.text).toContain('이도현: "민아, 저녁은."');

    // 장면을 쓰는 작가에게는 두 사람만 아는 일로 건네진다
    await send('어제 팀장님이랑 무슨 얘기 했어요?');
    const scene = calls('reply').at(-1)!.layers.scene;
    expect(scene).toContain('[민아, 이도현만 아는 일 — 다른 사람은 듣기 전에는 모른다]');
    expect(scene).toContain('민아와 이도현이 사무실에서 둘이 나눈 이야기');

    // 그 사람이 되어 쓰는 자리(혼자 보낸 시간)에서, 그 자리에 없던 캐스트는 그 일을 받지 않는다
    await away('evening');
    const gaps = calls('gap').slice(-3);
    expect(gaps.find((c) => c.layers.cast.includes('이름: 민아'))!.layers.scene).toContain('둘이 나눈 이야기');
    expect(gaps.find((c) => c.layers.cast.includes('이름: 서준'))!.layers.scene).not.toContain('둘이 나눈 이야기');
  });

  it('유저의 인물이 말하는 장면은 통째로 버린다', async () => {
    const { away, notes } = await setup({ aside: `${SCENE}\n수아: "저 아직 안 갔는데요."` });
    const v = await away('sleep');
    expect(v.asides).toHaveLength(0);
    expect(v.messages.filter((m) => m.kind === 'aside')).toHaveLength(0);
    expect(await notes()).toEqual(['유저의 인물이 말해서 장면을 버림']);
  });

  it('유저의 이름이 나오면 그 자리에 있는지 묻는다. 얘기만 하는 것이면 남긴다', async () => {
    const { away, calls } = await setup({ aside: SCENE, check: '판정: 없음' });
    const v = await away('sleep');
    expect(calls('check')).toHaveLength(1);
    expect(calls('check')[0]!.user).toContain('[상대]\n수아');
    expect(v.asides).toHaveLength(1);
  });

  it('유저가 그 자리에 있다고 하면 버린다. 판정을 못 읽어도 버린다', async () => {
    const there = await setup({ aside: SCENE, check: '판정: 있음' });
    expect((await there.away('sleep')).asides).toHaveLength(0);
    expect(await there.notes()).toContain('유저가 그 자리에 있어서 장면을 버림');

    const unreadable = await setup({ aside: SCENE, check: '글쎄요' });
    expect((await unreadable.away('sleep')).asides).toHaveLength(0);
  });

  it('유저의 이름이 안 나오는 장면은 묻지 않고 남긴다', async () => {
    const quiet = '장소 | 사무실\n이도현: "민아, 저녁은."\n민아: "먹고 왔어요."';
    const { away, calls } = await setup({ aside: quiet });
    expect((await away('sleep')).asides).toHaveLength(1);
    expect(calls('check')).toHaveLength(0);
  });

  it('대사가 모자라면 장면으로 치지 않는다', async () => {
    const { away, notes } = await setup({ aside: '장소 | 사무실\n둘 다 말이 없다.\n이도현: "가자."' });
    expect((await away('sleep')).asides).toHaveLength(0);
    expect(await notes()).toEqual(['대사가 모자라서 장면을 버림']);
  });

  it('한 번 비운 동안 한 장면까지다. 다음에 비우면 또 하나 생길 수 있다', async () => {
    const { away, calls } = await setup({ aside: SCENE });
    await away('evening');
    expect(calls('aside')).toHaveLength(1);
    const v = await away('sleep');
    expect(calls('aside')).toHaveLength(2);
    expect(v.asides.map((a) => formatWorld(clock(a.at)))).toEqual(['금요일 오후 5:30', '금요일 오후 9:00']);
  });

  it('스위치가 꺼져 있거나, 서로 아는 사이가 없거나, 캐스트가 한 명이면 만들지 않는다', async () => {
    const off = await setup({ aside: SCENE }, { ...OPEN_FILM, opens: { feed: false, ping: false, aside: false } });
    await off.away('sleep');
    expect(off.calls('aside')).toHaveLength(0);

    const strangers = await setup({ aside: SCENE }, { ...OPEN_FILM, ties: [] });
    await strangers.away('sleep');
    expect(strangers.calls('aside')).toHaveLength(0);

    const solo = parseFilm({ ...OPEN_FILM, casts: [OPEN_FILM.casts[0]], ties: [] });
    expect(solo.opens.aside).toBe(false);

    // 스위치가 없던 때의 필름은 꺼진 것으로 읽는다
    expect(parseFilm(TWO_FILM).opens.aside).toBe(false);
  });

  it('짧게 비우면 만나지 않는다', async () => {
    const { away, calls } = await setup({ aside: SCENE });
    await away('short');
    expect(calls('aside')).toHaveLength(0);
  });

  it('장면을 못 받아도 시계는 가고, 그 사이는 조용히 닫힌다', async () => {
    const { away, notes } = await setup({
      aside: () => {
        throw new Error('모델이 답이 없다');
      },
    });
    const v = await away('sleep');
    expect(formatWorld(clock(v.elapsed))).toBe('토요일 오전 7:00');
    expect(v.stuck).toBeNull();
    expect(v.asides).toHaveLength(0);
    expect((await notes())[0]).toContain('한편을 못 받음');
  });

  it('목록에 보이는 마지막 대사에는 한편의 줄이 끼지 않는다', async () => {
    const { ctx, send, away } = await setup({ aside: SCENE });
    await send('먼저 갈게요.');
    await away('sleep');
    expect((await listPlays(ctx))[0]!.lastLine).toBe('응, 듣고 있어.');
  });
});
