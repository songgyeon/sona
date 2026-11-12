import { describe, expect, it } from 'vitest';
import { feedLine, kindsNow, parseFeed } from '../../shared/feed';
import { RULES } from '../../shared/rules';
import { Fail } from '../../worker/engine/ctx';
import { feedSpan, slotOf } from '../../worker/engine/feed';
import { createFilm, getFilm, parseFilm } from '../../worker/engine/films';
import { loadSave, makeSave } from '../../worker/engine/saves';
import { skip } from '../../worker/engine/skip';
import { loadPlay, viewOf } from '../../worker/engine/store';
import { enter, say } from '../../worker/engine/turn';
import { FAKE_DEFAULTS } from '../../worker/model/fake';
import { DEV_FILM, OTHER_VISITOR, testCtx, uid } from '../helpers/film';

const ALL = ['watch', 'song', 'diary', 'photo', 'search', 'tube'] as const;
const PHOTOS = [
  { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', about: '창밖의 비' },
  { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', about: '식은 커피 두 잔' },
];

describe('피드 한 줄 읽기', () => {
  it('종류마다 제 모양으로 읽는다', () => {
    const k = [...ALL];
    expect(parseFeed('영화 | 「이터널 선샤인」 | 세 번째.', k)).toEqual({ kind: 'watch', form: 'movie', title: '이터널 선샤인', ep: '', note: '세 번째.' });
    expect(parseFeed('드라마 | 나의 아저씨 | 7화 | 또 울었다.', k)).toEqual({ kind: 'watch', form: 'drama', title: '나의 아저씨', ep: '7화', note: '또 울었다.' });
    expect(parseFeed('노래 | 밤편지 | 아이유 | 문 닫고 한 번 더.', k)).toEqual({ kind: 'song', title: '밤편지', artist: '아이유', note: '문 닫고 한 번 더.' });
    expect(parseFeed('일기 | 비가 왔다. 손님이 둘뿐이었다.', k)).toEqual({ kind: 'diary', text: '비가 왔다. 손님이 둘뿐이었다.' });
    expect(parseFeed('사진 | 2 | 또 두 잔.', k, PHOTOS)).toEqual({ kind: 'photo', photo: PHOTOS[1]!.id, note: '또 두 잔.' });
    expect(parseFeed('검색 | 셔터 고치는 법 / 헌책 냄새', k)).toEqual({ kind: 'search', queries: ['셔터 고치는 법', '헌책 냄새'] });
    expect(parseFeed('영상 | 제본 다시 하기 (18:40) / 빗소리 세 시간 (3:00:00) / 고양이', k)).toEqual({
      kind: 'tube',
      items: [
        { title: '제본 다시 하기', length: '18:40' },
        { title: '빗소리 세 시간', length: '3:00:00' },
        { title: '고양이', length: '' },
      ],
    });
    expect(parseFeed('없음', k)).toBe('none');
  });

  it('켜 두지 않은 종류, 없는 사진, 너무 긴 것, 모르는 모양은 받지 않는다', () => {
    expect(parseFeed('노래 | 밤편지 | 아이유 |', ['watch'])).toBeNull();
    expect(parseFeed('사진 | 3 | 없는 사진', [...ALL], PHOTOS)).toBeNull();
    expect(parseFeed(`일기 | ${'가'.repeat(RULES.feed.diary + 1)}`, [...ALL])).toBeNull();
    expect(parseFeed(`검색 | ${Array.from({ length: RULES.feed.items + 1 }, (_, i) => `말${i}`).join(' / ')}`, [...ALL])).toBeNull();
    expect(parseFeed('오늘은 그냥 쉬었다', [...ALL])).toBeNull();
    expect(parseFeed('영화 |  | 제목이 없다', [...ALL])).toBeNull();
  });

  it('사진은 남은 사진이 있어야 고를 수 있다', () => {
    expect(kindsNow([...ALL], 0)).not.toContain('photo');
    expect(kindsNow([...ALL], 1)).toContain('photo');
    expect(kindsNow(['diary', 'photo'], 2)).toEqual(['diary', 'photo']);
  });

  it('한 줄 요약은 누가 무엇을 했는지 적는다', () => {
    expect(feedLine({ kind: 'song', title: '밤편지', artist: '아이유', note: '' }, '한서')).toBe('한서는 아이유의 노래 「밤편지」를 들었다.');
    expect(feedLine({ kind: 'watch', form: 'drama', title: '나의 아저씨', ep: '7화', note: '또 울었다.' }, '지후')).toBe('지후는 드라마 「나의 아저씨」 7화를 봤다. 또 울었다.');
    expect(feedLine({ kind: 'photo', photo: 'x', note: '비.' }, '지후', '창밖의 비')).toBe('지후가 피드에 사진을 올렸다(창밖의 비). 비.');
  });
});

describe('피드: 필름 만들기', () => {
  it('켜 둔 종류와 붙인 사진이 저장된다. 안 보내면 다 켠 것이다', () => {
    const film = parseFilm({ ...DEV_FILM, casts: [{ ...DEV_FILM.casts[0], feed: ['diary', 'nope', 'song'], photos: PHOTOS }, DEV_FILM.casts[1]] });
    expect(film.casts[0]!.feed).toEqual(['song', 'diary']);
    expect(film.casts[0]!.photos).toEqual(PHOTOS);
    expect(film.casts[1]!.feed).toEqual([...ALL]);
    expect(film.casts[1]!.photos).toEqual([]);
  });

  it('사진은 정해진 수까지. 무슨 사진인지 적은 것은 플레이하는 사람에게 보내지 않는다', async () => {
    const many = Array.from({ length: RULES.feed.photos + 1 }, () => ({ id: uid(), about: '' }));
    let err: Fail | null = null;
    try {
      parseFilm({ ...DEV_FILM, casts: [{ ...DEV_FILM.casts[0], photos: many }, DEV_FILM.casts[1]] });
    } catch (e) {
      err = e as Fail;
    }
    expect(err?.message).toContain(`${RULES.feed.photos}장`);
    const ctx = testCtx();
    const { id } = await createFilm(ctx, { ...DEV_FILM, casts: [{ ...DEV_FILM.casts[0], photos: PHOTOS }, DEV_FILM.casts[1]] });
    expect((await getFilm(ctx, id)).film.casts[0]!.photos).toEqual(PHOTOS);
    expect((await getFilm({ ...ctx, visitor: OTHER_VISITOR }, id)).film.casts[0]!.photos).toEqual([]);
  });
});

describe('피드: 자리를 비운 사이', () => {
  const HANSEO = '한서: "네."\n모습 | 한서는 계산대 뒤에 서 있다.';
  const ONE = { ...DEV_FILM, casts: [DEV_FILM.casts[0]], ties: [], opens: { feed: true, ping: false, aside: false } };

  async function solo(post: string | (() => string) = FAKE_DEFAULTS.post) {
    const ctx = testCtx((call) => (call.purpose === 'reply' ? HANSEO : call.purpose === 'post' ? (typeof post === 'function' ? post() : post) : FAKE_DEFAULTS[call.purpose]));
    const { id } = await createFilm(ctx, ONE);
    const v = await enter(ctx, id, uid());
    return { ctx, playId: v.id };
  }

  it('늘 같이 있어서 못 남긴 날은, 자리를 비우자마자 남긴다', async () => {
    const { ctx, playId } = await solo();
    const play = await loadPlay(ctx, playId);
    const slot = slotOf(play, play.film.casts[0]!, 0)!;
    await ctx.db.run('UPDATE plays SET elapsed = ? WHERE id = ?', slot + 30, playId);
    const before = await say(ctx, playId, { text: '네.', requestId: uid() });
    // 한서는 그 자리에 있다 — 채팅하는 동안에는 남기지 않는다
    expect(before.posts.filter((p) => p.at >= 0)).toHaveLength(0);
    const v = await skip(ctx, playId, { kind: 'short', requestId: uid() });
    const live = v.posts.filter((p) => p.at >= 0);
    expect(live).toHaveLength(1);
    expect(live[0]!.at).toBeGreaterThan(before.elapsed);
    expect(live[0]!.at).toBeLessThanOrEqual(v.elapsed);
  });

  it('비운 사이에 든 날마다 남길 때가 오면 하나. 같은 날은 두 번 남기지 않는다', async () => {
    const { ctx, playId } = await solo();
    await skip(ctx, playId, { kind: 'sleep', requestId: uid() });
    await skip(ctx, playId, { kind: 'sleep', requestId: uid() });
    const days = await ctx.db.all<{ day: number }>('SELECT day FROM feed_days WHERE play_id = ? AND day >= 0 ORDER BY day', playId);
    expect(days.map((d) => d.day)).toEqual([0, 1]);
    const v = await viewOf(ctx, playId);
    expect(v.posts.filter((p) => p.at >= 0)).toHaveLength(2);
  });

  it('장면 저장으로 돌아가면 그 뒤에 남긴 것도 같이 돌아간다', async () => {
    const { ctx, playId } = await solo();
    await makeSave(ctx, playId);
    const saves = await ctx.db.all<{ id: string }>('SELECT id FROM saves WHERE play_id = ?', playId);
    await skip(ctx, playId, { kind: 'sleep', requestId: uid() });
    expect((await viewOf(ctx, playId)).posts.filter((p) => p.at >= 0)).toHaveLength(1);
    const back = await loadSave(ctx, playId, saves[0]!.id);
    expect(back.posts.filter((p) => p.at >= 0)).toHaveLength(0);
    // 이야기 전 며칠 치는 저장할 때 이미 있었다. 그 뒤의 날은 없다
    expect(await ctx.db.all('SELECT * FROM feed_days WHERE play_id = ? AND day >= 0', playId)).toHaveLength(0);
  });

  it('feedSpan은 피드를 열지 않은 필름에서는 아무것도 하지 않는다', async () => {
    const ctx = testCtx();
    const { id } = await createFilm(ctx, { ...ONE, opens: { feed: false, ping: false, aside: false } });
    const v = await enter(ctx, id, uid());
    const play = await loadPlay(ctx, v.id);
    expect(await feedSpan(ctx, play, uid(), 0, 24 * 60, [])).toEqual([]);
  });
});
