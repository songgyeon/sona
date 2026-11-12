import { describe, expect, it } from 'vitest';
import { RULES } from '../../shared/rules';
import { createFilm } from '../../worker/engine/films';
import { viewOf } from '../../worker/engine/store';
import { enter, say } from '../../worker/engine/turn';
import { FAKE_DEFAULTS } from '../../worker/model/fake';
import type { ModelCall, Purpose } from '../../worker/model/index';
import { DEV_FILM, testCtx, uid } from '../helpers/film';

/* 같이 사는 느낌 — 캐스트에게도 저마다의 하루가 있다.
   임시 필름(동네 서점): 한서(c1, 01:00~08:30에 잔다)와 지후(c2). 금요일 오후 4시에 시작한다.
   한 번 보낼 때마다 작중 3분이 흐른다. */

/** 한서만 그 자리에 있는 장면. 지후는 자리에 없다 */
const HANSEO_ONLY = '장소 | 서점 계산대\n한서가 책을 꽂는다.\n한서: "네."\n모습 | 한서는 계산대 뒤에 서 있다. 수아는 서가 앞에 있다.';
/** 둘 다 그 자리에 있는 장면 */
const BOTH = '장소 | 서점 계산대\n한서: "네."\n지후: "저도요."\n모습 | 한서는 계산대 뒤에, 지후는 창가 자리에 앉아 있다.';

type Part = string | ((call: ModelCall) => string);
async function setup(parts: Partial<Record<Purpose, Part>> = {}, film: unknown = { ...DEV_FILM, opens: { feed: true, ping: false, aside: false } }) {
  const ctx = testCtx((call) => {
    const p = parts[call.purpose];
    if (p === undefined) return FAKE_DEFAULTS[call.purpose];
    return typeof p === 'function' ? p(call) : p;
  });
  const { id: filmId } = await createFilm(ctx, film);
  const v = await enter(ctx, filmId, uid());
  const send = (text: string) => say(ctx, v.id, { text, requestId: uid() });
  const calls = (purpose: Purpose) => ctx.model.calls.filter((c) => c.purpose === purpose);
  /** n번 주고받는다 */
  const talk = async (n: number) => {
    let last = v;
    for (let i = 0; i < n; i++) last = await send(`${i}번째 말.`);
    return last;
  };
  return { ctx, filmId, playId: v.id, entered: v, send, talk, calls };
}

describe('같이 사는 느낌: 이야기 전에 올려 둔 글', () => {
  it('들어가면 캐스트마다 이야기가 시작되기 전에 올려 둔 글이 있다', async () => {
    const { entered, calls } = await setup();
    expect(calls('past')).toHaveLength(2);
    const before = entered.posts.filter((p) => p.at < 0);
    // 시각 차례로 선다: 이틀 전 점심, 하루 전 밤
    expect(before.map((p) => [p.cast, p.text])).toEqual([
      ['c1', '점심은 또 편의점 샌드위치.'],
      ['c2', '점심은 또 편의점 샌드위치.'],
      ['c1', '비 오는 날은 일찍 자고 싶다.'],
      ['c2', '비 오는 날은 일찍 자고 싶다.'],
    ]);
    // 「2일 전 13:40」 — 이야기가 시작된 금요일 16:00에서 거꾸로 셈한다
    expect(before.find((p) => p.text.startsWith('점심'))!.at).toBe(13 * 60 + 40 - 16 * 60 - 2 * 24 * 60);
  });

  it('줄 모양이 틀렸거나, 자는 시간이거나, 너무 길면 버린다. 많아야 정해진 수까지', async () => {
    const lines = [
      '1일 전 03:00 | 자는 시간에 올린 글',
      '아무 모양도 아닌 줄',
      `2일 전 12:00 | ${'가'.repeat(RULES.feed.length + 1)}`,
      '3일 전 09:10 | 하나',
      '2일 전 10:10 | 둘',
      '1일 전 11:10 | 셋',
      '1일 전 12:10 | 넷',
    ].join('\n');
    const { entered } = await setup({ past: (call) => (call.layers.cast.includes('이름: 한서') ? lines : '') });
    expect(entered.posts.filter((p) => p.cast === 'c1').map((p) => p.text)).toEqual(['하나', '둘', '셋']);
    expect(entered.posts.filter((p) => p.cast === 'c2')).toHaveLength(0);
  });

  it('장면을 쓰는 작가에게 「아는 일」로 건네지 않는다', async () => {
    const { send, calls } = await setup();
    await send('안녕하세요.');
    expect(calls('reply')[0]!.layers.scene).not.toContain('편의점 샌드위치');
  });

  it('피드를 열지 않은 필름에는 없다', async () => {
    const { entered, calls } = await setup({}, { ...DEV_FILM, opens: { feed: false, ping: false, aside: false } });
    expect(calls('past')).toHaveLength(0);
    expect(entered.posts).toHaveLength(0);
  });

  it('이 기능이 생기기 전에 들어간 삶은 다음 대목 때 한 번 적는다', async () => {
    const { ctx, playId, send, calls } = await setup();
    await ctx.db.run('DELETE FROM posts');
    await ctx.db.run('UPDATE plays SET past = 0');
    await send('하나.');
    expect(calls('past')).toHaveLength(4);
    expect((await viewOf(ctx, playId)).posts.filter((p) => p.at < 0)).toHaveLength(4);
    await send('둘.');
    expect(calls('past')).toHaveLength(4);
  });
});

describe('같이 사는 느낌: 채팅하는 동안의 피드 글', () => {
  const steps = RULES.feed.everyMin / RULES.minutesPerSend;

  it('지금 장면에 없는 사람이, 정해진 만큼 시간이 흐르면 올린다. 그 자리에 있는 사람은 올리지 않는다', async () => {
    const { talk, calls } = await setup({ reply: HANSEO_ONLY });
    const early = await talk(steps - 1);
    expect(early.posts.filter((p) => p.at >= 0)).toHaveLength(0);
    const v = await talk(1);
    const live = v.posts.filter((p) => p.at >= 0);
    expect(live.map((p) => [p.cast, p.text, p.at])).toEqual([['c2', FAKE_DEFAULTS.post, RULES.feed.everyMin]]);
    // 지후가 되어 쓴다. 떨어져 있다고 알린다
    expect(calls('post')[0]!.layers.cast).toContain('이름: 지후');
    expect(calls('post')[0]!.user).toContain('떨어져 있다');
  });

  it('올린 글은 모두가 안다. 다음 대목을 쓰는 작가에게 건네진다', async () => {
    const { talk, send, calls } = await setup({ reply: HANSEO_ONLY });
    await talk(steps);
    await send('그런데요.');
    expect(calls('reply').at(-1)!.layers.scene).toContain(`지후의 피드에 올라온 글: 「${FAKE_DEFAULTS.post}」`);
  });

  it('방금 말한 사람은 모습 줄에 없어도 그 자리에 있다. 올리지 않는다', async () => {
    const spoke = '한서: "네."\n지후: "저도 들었어요."\n모습 | 한서는 계산대 뒤에 서 있다.';
    const { talk, calls } = await setup({ reply: spoke });
    await talk(steps * 2);
    expect(calls('post')).toHaveLength(0);
  });

  it('글과 같이 온 답에 그 사람이 나오면 그 글은 버린다 — 말하다가 피드를 올리지 않는다', async () => {
    let n = 0;
    const enters = '문이 열리고 지후가 들어온다.\n지후: "다들 여기 있었네."\n모습 | 한서는 계산대 뒤에, 지후는 문 앞에 서 있다.';
    const { talk, calls, ctx } = await setup({ reply: () => (++n === steps ? enters : HANSEO_ONLY) });
    const v = await talk(steps);
    // 지후의 글은 받았지만 적지 않았다
    expect(calls('post')).toHaveLength(1);
    expect(v.posts.filter((p) => p.at >= 0)).toHaveLength(0);
    const log = await ctx.db.first<{ accepted: number; note: string }>("SELECT accepted, note FROM gen_log WHERE purpose = 'post'");
    expect(log).toEqual({ accepted: 0, note: '이번 대목에 나와서 버림' });
  });

  it('모두 그 자리에 있으면 아무도 올리지 않는다', async () => {
    const { talk, calls } = await setup({ reply: BOTH });
    const v = await talk(steps * 2);
    expect(calls('post')).toHaveLength(0);
    expect(v.posts.filter((p) => p.at >= 0)).toHaveLength(0);
  });

  it('캐스트가 한 명이고 늘 같이 있으면 채팅하는 동안에는 올리지 않는다', async () => {
    const solo = { ...DEV_FILM, casts: [DEV_FILM.casts[0]], ties: [], opens: { feed: true, ping: true, aside: false } };
    const { talk, calls } = await setup({ reply: '한서: "네."\n모습 | 한서는 계산대 뒤에 서 있다.' }, solo);
    await talk(steps * 2);
    expect(calls('post')).toHaveLength(0);
    expect(calls('ping')).toHaveLength(0);
  });

  it('같은 사람은 정해진 만큼에 한 번까지다', async () => {
    const { talk } = await setup({ reply: HANSEO_ONLY });
    const v = await talk(steps * 2);
    // 한 시간 지나 지후가 올렸고, 다시 한 시간이 지났지만 지후는 아직 세 시간이 안 됐다. 한서는 그 자리에 있다
    expect(v.posts.filter((p) => p.at >= 0).map((p) => p.cast)).toEqual(['c2']);
  });

  it('자는 사람은 올리지 않는다', async () => {
    const sleepy = { ...DEV_FILM, opens: { feed: true, ping: false, aside: false }, casts: [DEV_FILM.casts[0], { ...DEV_FILM.casts[1], sleepFrom: 16 * 60, sleepTo: 20 * 60 }] };
    const { talk, calls } = await setup({ reply: HANSEO_ONLY }, sleepy);
    await talk(steps);
    expect(calls('post')).toHaveLength(0);
  });

  it('글을 못 받아도 장면은 그대로 간다', async () => {
    const { talk } = await setup({
      reply: HANSEO_ONLY,
      post: () => {
        throw new Error('upstream 503');
      },
    });
    const v = await talk(steps);
    expect(v.stuck).toBeNull();
    expect(v.messages.at(-1)).toMatchObject({ speaker: 'c1', text: '네.' });
    expect(v.posts.filter((p) => p.at >= 0)).toHaveLength(0);
  });
});

describe('같이 사는 느낌: 채팅하는 동안 먼저 오는 메시지', () => {
  const OPEN = { ...DEV_FILM, opens: { feed: false, ping: true, aside: false } };
  const steps = RULES.ping.chatMin / RULES.minutesPerSend;

  it('여럿이 나오는 필름에서, 자리에 없는 사람이 한동안 말이 없으면 먼저 메시지를 보낸다', async () => {
    const { talk, calls } = await setup({ reply: HANSEO_ONLY, ping: '오늘 서점 바빠요?' }, OPEN);
    const early = await talk(steps - 1);
    expect(early.messages.filter((m) => m.kind === 'ping')).toHaveLength(0);
    const v = await talk(1);
    expect(v.messages.filter((m) => m.kind === 'ping').map((m) => [m.speaker, m.text])).toEqual([['c2', '오늘 서점 바빠요?']]);
    expect(calls('ping')[0]!.user).toContain('다른 곳에 있다');
  });

  it('먼저 오는 연락을 열지 않은 필름에서는 보내지 않는다', async () => {
    const { talk, calls } = await setup({ reply: HANSEO_ONLY }, { ...OPEN, opens: { feed: false, ping: false, aside: false } });
    await talk(steps);
    expect(calls('ping')).toHaveLength(0);
  });
});

describe('같이 사는 느낌: 피드를 열 때와 내 피드', () => {
  it('이야기 전 글이 없던 삶은 피드를 열 때 적는다. 두 번 적지 않는다', async () => {
    const { ctx, playId, calls } = await setup();
    await ctx.db.run('DELETE FROM posts');
    await ctx.db.run('UPDATE plays SET past = 0');
    const { openFeed } = await import('../../worker/engine/alive');
    const v = await openFeed(ctx, playId);
    expect(v.posts.filter((p) => p.at < 0)).toHaveLength(4);
    await openFeed(ctx, playId);
    expect(calls('past')).toHaveLength(4);
  });

  it('내 피드에 올린 글은 캐스트도 안다. 시간은 흐르지 않는다', async () => {
    const { ctx, playId, send, calls } = await setup();
    const { postMine } = await import('../../worker/engine/alive');
    const v = await postMine(ctx, playId, { text: '  비 그친 줄 알았는데.  ' });
    expect(v.elapsed).toBe(0);
    expect(v.posts.filter((p) => p.cast === 'persona').map((p) => p.text)).toEqual(['비 그친 줄 알았는데.']);
    await send('안녕하세요.');
    expect(calls('reply').at(-1)!.layers.scene).toContain('[모두 아는 일]\n- (금요일 낮) 수아의 피드에 올라온 글: 「비 그친 줄 알았는데.」');
  });

  it('비었거나 너무 길거나, 피드를 열지 않은 필름이면 받지 않는다', async () => {
    const { ctx, playId } = await setup();
    const { postMine } = await import('../../worker/engine/alive');
    const code = async (p: Promise<unknown>) => p.then(() => null, (e: { code?: string }) => e.code ?? null);
    expect(await code(postMine(ctx, playId, { text: '  ' }))).toBe('empty_post');
    expect(await code(postMine(ctx, playId, { text: '가'.repeat(RULES.feed.length + 1) }))).toBe('long_post');
    const closed = await setup({}, { ...DEV_FILM, opens: { feed: false, ping: false, aside: false } });
    expect(await code(postMine(closed.ctx, closed.playId, { text: '안녕' }))).toBe('feed_closed');
  });
});
