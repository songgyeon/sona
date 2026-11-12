import { describe, expect, it } from 'vitest';
import { RULES } from '../../shared/rules';
import { createFilm } from '../../worker/engine/films';
import { dayOf, slotOf } from '../../worker/engine/feed';
import { loadPlay, viewOf } from '../../worker/engine/store';
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

/** 지후(c2)의 사진. 디렉터가 붙인 것만 올라간다 */
const PHOTO_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PHOTO_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const PHOTOS = [
  { id: PHOTO_A, about: '연구실 창밖의 비' },
  { id: PHOTO_B, about: '식은 커피 두 잔' },
];
const withPhotos = (photos: typeof PHOTOS) => ({
  ...DEV_FILM,
  opens: { feed: true, ping: false, aside: false },
  casts: [DEV_FILM.casts[0], { ...DEV_FILM.casts[1], photos }],
});
const WITH_PHOTOS = withPhotos(PHOTOS);

/** 지후가 그날 남길 때(흐른 분). 그때까지 시계를 민다 */
async function untilSlot(s: Awaited<ReturnType<typeof setup>>, day = 0) {
  const play = await loadPlay(s.ctx, s.playId);
  const at = slotOf(play, play.film.casts[1]!, day)!;
  await s.ctx.db.run('UPDATE plays SET elapsed = ? WHERE id = ?', at - RULES.minutesPerSend, s.playId);
  return at;
}

describe('피드: 이야기 전 며칠 치', () => {
  it('들어가면 캐스트마다 이야기 전 사흘 가운데 남긴 날의 것이 있다. 남기지 않은 날은 비어 있다', async () => {
    const { entered, calls } = await setup();
    expect(calls('past')).toHaveLength(2);
    const c1 = entered.posts.filter((p) => p.cast === 'c1');
    // 3일 전: 영화, 2일 전: 없음, 1일 전: 일기
    expect(c1.map((p) => p.data)).toEqual([
      { kind: 'watch', form: 'movie', title: '이터널 선샤인', ep: '', note: '세 번째. 이번엔 끝까지 봤다.' },
      { kind: 'diary', text: '비가 왔다. 손님이 둘뿐이었다.' },
    ]);
    expect(c1.every((p) => p.at < 0)).toBe(true);
    expect(c1[0]!.text).toBe('한서는 영화 「이터널 선샤인」을 봤다. 세 번째. 이번엔 끝까지 봤다.');
  });

  it('남길 때는 그날 깨어 있는 때 가운데 하나다. 같은 삶이면 늘 같다', async () => {
    const { ctx, playId } = await setup();
    const play = await loadPlay(ctx, playId);
    const hanseo = play.film.casts[0]!;
    for (const day of [-3, -2, -1, 0, 1]) {
      const at = slotOf(play, hanseo, day)!;
      expect(at).toBe(slotOf(play, hanseo, day));
      expect(dayOf(play, at)).toBe(day);
      const min = (((play.startMin + at) % 1440) + 1440) % 1440;
      expect(min >= hanseo.sleepFrom && min < hanseo.sleepTo).toBe(false);
    }
    // 이야기가 시작된 날은 시작하고 조금 지나서부터
    expect(slotOf(play, hanseo, 0)!).toBeGreaterThanOrEqual(RULES.feed.calmMin);
  });

  it('모양이 틀렸거나, 켜 두지 않은 종류거나, 없는 날이거나, 같은 날을 두 번 적은 줄은 버린다', async () => {
    const lines = [
      '3일 전 | 노래 | 밤편지 | 아이유 | 문 닫고 한 번 더.',
      '3일 전 | 일기 | 같은 날을 또 적었다.',
      '2일 전 | 사진 | 1 | 붙인 사진이 없다',
      '1일 전 | 검색 | 켜 두지 않은 종류',
      '4일 전 | 일기 | 없는 날',
      '아무 모양도 아닌 줄',
    ].join('\n');
    const film = { ...DEV_FILM, opens: { feed: true, ping: false, aside: false }, casts: [{ ...DEV_FILM.casts[0], feed: ['song', 'diary', 'photo'] }, DEV_FILM.casts[1]] };
    const { entered, calls } = await setup({ past: (call) => (call.layers.cast.includes('이름: 한서') ? lines : '') }, film);
    expect(entered.posts.filter((p) => p.cast === 'c1').map((p) => p.data.kind)).toEqual(['song']);
    // 켜 둔 것만 고르게 건넨다. 사진은 붙인 것이 없어서 건네지 않는다
    const sys = calls('past').find((c) => c.layers.cast.includes('이름: 한서'))!.layers.system;
    expect(sys).toContain('- 노래:');
    expect(sys).toContain('- 일기:');
    expect(sys).not.toContain('- 사진:');
    expect(sys).not.toContain('- 검색:');
    expect(entered.posts.filter((p) => p.cast === 'c2')).toHaveLength(0);
  });

  it('장면을 쓰는 작가에게 「아는 일」로 건네지 않는다', async () => {
    const { send, calls } = await setup();
    await send('안녕하세요.');
    expect(calls('reply')[0]!.layers.scene).not.toContain('이터널 선샤인');
  });

  it('피드를 열지 않은 필름이나, 다 꺼 둔 캐스트에는 없다', async () => {
    const closed = await setup({}, { ...DEV_FILM, opens: { feed: false, ping: false, aside: false } });
    expect(closed.calls('past')).toHaveLength(0);
    expect(closed.entered.posts).toHaveLength(0);
    const off = await setup({}, { ...DEV_FILM, casts: [{ ...DEV_FILM.casts[0], feed: [] }, DEV_FILM.casts[1]] });
    expect(off.calls('past')).toHaveLength(1);
    expect(off.entered.posts.every((p) => p.cast === 'c2')).toBe(true);
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

describe('피드: 채팅하는 동안 — 하루에 많아야 하나', () => {
  it('그날 남길 때가 지나면, 지금 장면에 없는 사람이 하나를 남긴다. 그날은 다시 남기지 않는다', async () => {
    const s = await setup({ reply: HANSEO_ONLY });
    const at = await untilSlot(s);
    const v = await s.send('그런데요.');
    const live = v.posts.filter((p) => p.at >= 0);
    expect(live.map((p) => [p.cast, p.at, p.data.kind])).toEqual([['c2', at, 'song']]);
    // 지후가 되어 고른다. 켜 둔 것과 그때를 건넨다
    const call = s.calls('post')[0]!;
    expect(call.layers.cast).toContain('이름: 지후');
    expect(call.layers.system).toContain('- 영화:');
    expect(call.layers.system).toContain('- 없음:');
    await s.talk(30);
    expect(s.calls('post')).toHaveLength(1);
    expect((await viewOf(s.ctx, s.playId)).posts.filter((p) => p.at >= 0)).toHaveLength(1);
  });

  it('「없음」을 고르면 그날은 남기지 않는다. 다시 묻지 않는다', async () => {
    const s = await setup({ reply: HANSEO_ONLY, post: '없음' });
    await untilSlot(s);
    await s.talk(10);
    expect(s.calls('post')).toHaveLength(1);
    expect((await viewOf(s.ctx, s.playId)).posts.filter((p) => p.at >= 0)).toHaveLength(0);
  });

  it('다음 날이 되면 그날 남길 때에 또 하나', async () => {
    const s = await setup({ reply: HANSEO_ONLY });
    await untilSlot(s, 0);
    await s.send('하나.');
    await untilSlot(s, 1);
    await s.send('둘.');
    const live = (await viewOf(s.ctx, s.playId)).posts.filter((p) => p.at >= 0);
    expect(live.map((p) => p.cast)).toEqual(['c2', 'c2']);
  });

  it('그 자리에 있는 사람은 남기지 않는다. 장면에서 빠지면 그날이 가기 전에 남긴다', async () => {
    let both = true;
    const s = await setup({ reply: () => (both ? BOTH : HANSEO_ONLY) });
    await s.send('처음.');
    await untilSlot(s);
    await s.talk(3);
    expect(s.calls('post')).toHaveLength(0);
    both = false;
    await s.talk(2);
    expect(s.calls('post')).toHaveLength(1);
  });

  it('같이 온 답에 그 사람이 나오면 버린다 — 말하다가 피드를 올리지 않는다. 그날 다시 묻는다', async () => {
    let n = 0;
    const enters = '문이 열리고 지후가 들어온다.\n지후: "다들 여기 있었네."\n모습 | 한서는 계산대 뒤에 서 있다. 지후는 나갔다.';
    const s = await setup({ reply: () => (++n === 1 ? enters : HANSEO_ONLY) });
    await untilSlot(s);
    const v = await s.send('하나.');
    expect(s.calls('post')).toHaveLength(1);
    expect(v.posts.filter((p) => p.at >= 0)).toHaveLength(0);
    const log = await s.ctx.db.first<{ accepted: number; note: string }>("SELECT accepted, note FROM gen_log WHERE purpose = 'post'");
    expect(log).toEqual({ accepted: 0, note: '이번 대목에 나와서 버림' });
    // 방금 말한 지후는 다음 대목 때도 그 자리에 있다. 그 다음에 빠져 있으면 다시 묻는다
    await s.send('둘.');
    expect(s.calls('post')).toHaveLength(1);
    await s.send('셋.');
    expect(s.calls('post')).toHaveLength(2);
    expect((await viewOf(s.ctx, s.playId)).posts.filter((p) => p.at >= 0)).toHaveLength(1);
  });

  it('사진은 모두가 안다. 본 것·들은 것·일기·검색어는 그 사람만 안다', async () => {
    const s = await setup({ reply: HANSEO_ONLY, post: '사진 | 2 | 또 두 잔.' }, WITH_PHOTOS);
    await untilSlot(s);
    const v = await s.send('하나.');
    expect(v.posts.filter((p) => p.at >= 0).map((p) => p.data)).toEqual([{ kind: 'photo', photo: PHOTO_B, note: '또 두 잔.' }]);
    await s.send('둘.');
    const scene = s.calls('reply').at(-1)!.layers.scene;
    expect(scene).toMatch(/\[모두 아는 일\]\n- \(.+\) 지후가 피드에 사진을 올렸다\(식은 커피 두 잔\)\. 또 두 잔\./);

    const t = await setup({ reply: HANSEO_ONLY, post: '검색 | 연구실 창문 고치는 법 / 비 오는 날 우울' });
    await untilSlot(t);
    await t.send('하나.');
    await t.send('둘.');
    const scene2 = t.calls('reply').at(-1)!.layers.scene;
    expect(scene2).toContain('[지후만 아는 일');
    expect(scene2).toContain('지후가 검색한 말: 연구실 창문 고치는 법 / 비 오는 날 우울');
    expect(scene2).not.toContain('[모두 아는 일]\n- (금요일');
  });

  it('사진은 디렉터가 붙인 것만, 한 장은 한 번만 올린다. 다 올리면 사진은 고를 수 없다', async () => {
    const s = await setup({ reply: HANSEO_ONLY, post: '사진 | 1 | 비.' }, withPhotos(PHOTOS.slice(0, 1)));
    await untilSlot(s, 0);
    await s.send('하나.');
    expect(s.calls('post')[0]!.layers.scene).toContain('[올릴 수 있는 사진]\n1. 연구실 창밖의 비');
    await untilSlot(s, 1);
    await s.send('둘.');
    // 다음 날에는 남은 사진이 없다 — 사진을 고를 수 없고, 같은 답은 모양이 틀린 것으로 버린다
    expect(s.calls('post')[1]!.layers.system).not.toContain('- 사진:');
    const live = (await viewOf(s.ctx, s.playId)).posts.filter((p) => p.at >= 0);
    expect(live.map((p) => p.data.kind)).toEqual(['photo']);
    const bad = await s.ctx.db.first<{ note: string }>("SELECT note FROM gen_log WHERE purpose = 'post' ORDER BY rowid DESC");
    expect(bad!.note).toBe('모양이 틀림');
  });

  it('자는 사람은 남기지 않는다', async () => {
    const sleepy = { ...DEV_FILM, opens: { feed: true, ping: false, aside: false }, casts: [DEV_FILM.casts[0], { ...DEV_FILM.casts[1], sleepFrom: 0, sleepTo: 23 * 60 + 50 }] };
    const s = await setup({ reply: HANSEO_ONLY }, sleepy);
    await s.talk(40);
    expect(s.calls('post')).toHaveLength(0);
  });

  it('못 받아도 장면은 그대로 간다. 그날 다시 묻는다', async () => {
    let fail = true;
    const s = await setup({
      reply: HANSEO_ONLY,
      post: () => {
        if (fail) throw new Error('upstream 503');
        return '없음';
      },
    });
    await untilSlot(s);
    const v = await s.send('하나.');
    expect(v.stuck).toBeNull();
    expect(v.messages.at(-1)).toMatchObject({ speaker: 'c1', text: '네.' });
    fail = false;
    await s.send('둘.');
    expect(s.calls('post')).toHaveLength(2);
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
