import { describe, expect, it } from 'vitest';
import { parseFeed } from '../../shared/feed';
import { findWork, realize, someWorks, WORKS, workKey } from '../../shared/works';
import { createFilm } from '../../worker/engine/films';
import { skip } from '../../worker/engine/skip';
import { viewOf } from '../../worker/engine/store';
import { enter } from '../../worker/engine/turn';
import { FAKE_DEFAULTS } from '../../worker/model/fake';
import { DEV_FILM, testCtx, uid } from '../helpers/film';

/* 피드의 영화·드라마·노래·책은 실제로 있는 작품만(shared/works.ts) */

describe('작품 목록', () => {
  it('같은 종류 안에서 제목이 겹치지 않는다 — 영화와 드라마는 한 종류로 본다', () => {
    const group = (k: string) => (k === 'movie' || k === 'drama' ? 'watch' : k);
    const seen = new Set<string>();
    for (const w of WORKS) {
      const key = `${group(w.kind)}:${workKey(w.title)}`;
      expect(seen.has(key), `${w.kind} ${w.title}`).toBe(false);
      seen.add(key);
    }
    for (const w of WORKS.filter((x) => x.kind === 'song' || x.kind === 'book')) expect(w.by.length, w.title).toBeGreaterThan(0);
  });

  it('띄어쓰기와 문장 부호가 달라도 같은 작품이다. 없는 작품은 없다', () => {
    expect(findWork('너의 이름은', ['movie'])?.title).toBe('너의 이름은.');
    expect(findWork('응답하라1988', ['movie', 'drama'])).toMatchObject({ kind: 'drama', title: '응답하라 1988' });
    expect(findWork('어느 비 오는 날의 서점', ['movie', 'drama'])).toBeNull();
    expect(findWork('밤편지', ['book'])).toBeNull();
  });

  it('보여 줄 몇 편은 그 종류에서 겹치지 않게 뽑는다', () => {
    const some = someWorks('song', 20);
    expect(some).toHaveLength(20);
    expect(new Set(some.map((w) => w.title)).size).toBe(20);
    expect(some.every((w) => w.kind === 'song')).toBe(true);
  });
});

describe('실제로 있는 작품만 올린다', () => {
  const all = ['watch', 'song', 'book', 'diary'] as const;
  const read = (line: string) => {
    const d = parseFeed(line, [...all]);
    return d === null || d === 'none' ? d : realize(d);
  };

  it('목록에 없는 제목은 올리지 않는다', () => {
    expect(read('영화 | 어느 비 오는 날의 서점 | 좋았다.')).toBeNull();
    expect(read('노래 | 새벽 세 시의 편지 | 아이유 | 듣다 잤다.')).toBeNull();
    expect(read('책 | 서점 주인의 일기 | 김서하 | 반쯤 읽었다.')).toBeNull();
  });

  it('목록에 있으면 정식 제목과 부른 사람·지은이로 적는다. 영화로 적었어도 드라마면 드라마다', () => {
    expect(read('노래 | Dynamite | BTS | 출근길.')).toEqual({ kind: 'song', title: 'Dynamite', artist: '방탄소년단', note: '출근길.' });
    expect(read('책 | 소년이 온다 | 한 강 | 두 장 읽고 덮었다.')).toEqual({ kind: 'book', title: '소년이 온다', author: '한강', note: '두 장 읽고 덮었다.' });
    expect(read('영화 | 나의 아저씨 | 또 울었다.')).toMatchObject({ kind: 'watch', form: 'drama', title: '나의 아저씨' });
    expect(read('드라마 | 기생충 | 1화 | 이상하다.')).toMatchObject({ kind: 'watch', form: 'movie', title: '기생충', ep: '' });
    expect(read('일기 | 비가 왔다.')).toEqual({ kind: 'diary', text: '비가 왔다.' });
  });
});

describe('재생에서', () => {
  const ONE = { ...DEV_FILM, casts: [DEV_FILM.casts[0]], ties: [], opens: { feed: true, ping: false, aside: false } };
  const HANSEO = '한서: "네."\n모습 | 한서는 계산대 뒤에 서 있다.';

  it('대사 모델에게 고를 수 있는 작품을 보여 주고, 목록에 없는 작품을 고르면 그날은 남기지 않는다', async () => {
    const ctx = testCtx((call) => (call.purpose === 'reply' ? HANSEO : call.purpose === 'post' ? '영화 | 어느 비 오는 날의 서점 | 좋았다.' : FAKE_DEFAULTS[call.purpose]));
    const { id } = await createFilm(ctx, ONE);
    const playId = uid();
    await enter(ctx, id, playId);
    await skip(ctx, playId, { kind: 'sleep', requestId: uid() });
    const call = ctx.model.calls.filter((c) => c.purpose === 'post').at(-1)!;
    expect(call.layers.scene).toContain('[고를 수 있는 작품');
    expect((await viewOf(ctx, playId)).posts.filter((p) => p.at >= 0)).toEqual([]);
    const days = await ctx.db.all<{ kind: string }>('SELECT kind FROM feed_days WHERE play_id = ? AND day >= 0', playId);
    expect(days.length).toBeGreaterThan(0);
    expect(days.every((d) => d.kind === '')).toBe(true);
  });

  it('이야기 전 며칠 치도 같다: 목록에 없는 작품은 빠지고, 있는 작품은 정식 이름으로 남는다', async () => {
    const past = '3일 전 | 영화 | 어느 비 오는 날의 서점 | 좋았다.\n2일 전 | 노래 | dynamite | bts | 출근길.\n1일 전 | 일기 | 비가 왔다.';
    const ctx = testCtx((call) => (call.purpose === 'past' ? past : FAKE_DEFAULTS[call.purpose]));
    const { id } = await createFilm(ctx, ONE);
    const v = await enter(ctx, id, uid());
    const posts = (await viewOf(ctx, v.id)).posts;
    expect(posts.map((p) => p.data.kind)).toEqual(['song', 'diary']);
    expect(posts[0]!.data).toMatchObject({ title: 'Dynamite', artist: '방탄소년단' });
  });
});
