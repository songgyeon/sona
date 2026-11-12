import { describe, expect, it } from 'vitest';
import { dropPost, editPost, postMine } from '../../worker/engine/alive';
import { Fail } from '../../worker/engine/ctx';
import { chooseAs } from '../../worker/engine/entry';
import { createFilm, dropFilm, getFilm, listFilms } from '../../worker/engine/films';
import { skip } from '../../worker/engine/skip';
import { listPlays, viewOf } from '../../worker/engine/store';
import { enter, say } from '../../worker/engine/turn';
import { FAKE_DEFAULTS } from '../../worker/model/fake';
import { DEV_FILM, OTHER_VISITOR, testCtx, uid } from '../helpers/film';

/* 지우기 — 피드 글과 필름. 되돌릴 수 없어서 화면이 한 번 묻는다. 여기서는 지운 뒤에 무엇이 남고 무엇이 없어지는지 본다 */

async function failCode(p: Promise<unknown>): Promise<string | null> {
  try {
    await p;
  } catch (e) {
    if (e instanceof Fail) return e.code;
    throw e;
  }
  return null;
}

const HANSEO = '한서: "네."\n모습 | 한서는 계산대 뒤에 서 있다.';
const ONE = { ...DEV_FILM, casts: [DEV_FILM.casts[0]], ties: [], opens: { feed: true, ping: false, aside: false } };

async function solo() {
  const ctx = testCtx((call) => (call.purpose === 'reply' ? HANSEO : FAKE_DEFAULTS[call.purpose]));
  const { id } = await createFilm(ctx, ONE);
  const v = await enter(ctx, id, uid());
  return { ctx, filmId: id, playId: v.id };
}

const countEvents = async (ctx: ReturnType<typeof testCtx>, playId: string, kind: string) =>
  (await ctx.db.first<{ n: number }>('SELECT COUNT(*) AS n FROM events WHERE play_id = ? AND kind = ?', playId, kind))!.n;

describe('피드 글 지우기', () => {
  it('캐스트가 올린 글을 지우면 글과, 그 글을 올린 일이 같이 없어진다. 그날은 치른 날로 남는다', async () => {
    const { ctx, playId } = await solo();
    await skip(ctx, playId, { kind: 'sleep', requestId: uid() });
    const v = await viewOf(ctx, playId);
    const post = v.posts.find((p) => p.at >= 0)!;
    expect(post).toBeTruthy();
    expect(await countEvents(ctx, playId, 'feed')).toBe(1);
    const after = await dropPost(ctx, playId, post.id);
    expect(after.posts.some((p) => p.id === post.id)).toBe(false);
    expect(await countEvents(ctx, playId, 'feed')).toBe(0);
    const days = await ctx.db.all<{ day: number }>('SELECT day FROM feed_days WHERE play_id = ? AND day >= 0', playId);
    expect(days.length).toBeGreaterThan(0);
    // 다음 대목의 대사 모델은 그 글을 모른다
    await say(ctx, playId, { text: '좋은 아침이에요.', requestId: uid() });
    const reply = ctx.model.calls.filter((c) => c.purpose === 'reply').at(-1)!;
    expect(JSON.stringify(reply.layers)).not.toContain(post.text);
  });

  it('내가 올린 글도 지운다. 이야기 전 글도 지운다. 다른 글은 그대로다', async () => {
    const { ctx, playId } = await solo();
    await postMine(ctx, playId, { text: '비 그친 줄 알았는데.' });
    await postMine(ctx, playId, { text: '우산 두고 왔다.' });
    let v = await viewOf(ctx, playId);
    const mine = v.posts.filter((p) => p.cast === 'persona');
    expect(await countEvents(ctx, playId, 'post')).toBe(2);
    v = await dropPost(ctx, playId, mine[0]!.id);
    expect(v.posts.filter((p) => p.cast === 'persona').map((p) => p.text)).toEqual([mine[1]!.text]);
    expect(await countEvents(ctx, playId, 'post')).toBe(1);
    const before = v.posts.find((p) => p.at < 0);
    if (before) {
      v = await dropPost(ctx, playId, before.id);
      expect(v.posts.some((p) => p.id === before.id)).toBe(false);
    }
  });

  it('남의 삶의 글은 못 지운다. 없는 글은 없다고 한다', async () => {
    const { ctx, playId } = await solo();
    await postMine(ctx, playId, { text: '비 그친 줄 알았는데.' });
    const post = (await viewOf(ctx, playId)).posts.find((p) => p.cast === 'persona')!;
    expect(await failCode(dropPost({ ...ctx, visitor: OTHER_VISITOR }, playId, post.id))).toBe('play_missing');
    expect(await failCode(dropPost(ctx, playId, uid()))).toBe('post_missing');
    expect((await viewOf(ctx, playId)).posts.some((p) => p.id === post.id)).toBe(true);
  });
});

describe('누가 고치고 지우나: 캐스트의 글은 만든 사람만, 내 글은 그 삶의 주인이', () => {
  it('남이 만든 필름에서는 캐스트의 글은 못 고치고 못 지운다. 내 글은 고치고 지운다', async () => {
    const { ctx, filmId } = await solo();
    const guest = { ...ctx, visitor: OTHER_VISITOR };
    const theirs = await enter(guest, filmId, uid());
    await skip(guest, theirs.id, { kind: 'sleep', requestId: uid() });
    await postMine(guest, theirs.id, { text: '저도 왔어요.' });
    const v = await viewOf(guest, theirs.id);
    expect(v.mine).toBe(false);
    const cast = v.posts.find((p) => p.cast !== 'persona')!;
    const mine = v.posts.find((p) => p.cast === 'persona')!;
    expect(await failCode(dropPost(guest, theirs.id, cast.id))).toBe('not_maker');
    expect(await failCode(editPost(guest, theirs.id, cast.id, { note: '고침' }))).toBe('not_maker');
    const edited = await editPost(guest, theirs.id, mine.id, { text: '저도 왔어요. 늦었지만.' });
    expect(edited.posts.find((p) => p.id === mine.id)!.text).toBe('저도 왔어요. 늦었지만.');
    expect((await dropPost(guest, theirs.id, mine.id)).posts.some((p) => p.id === mine.id)).toBe(false);
    expect((await viewOf(guest, theirs.id)).posts.some((p) => p.id === cast.id)).toBe(true);
  });
});

describe('피드 글 고치기', () => {
  it('만든 사람이 캐스트의 글을 고치면 그 종류의 칸이 바뀌고, 캐스트가 아는 일도 고친 글이 된다', async () => {
    const { ctx, playId } = await solo();
    await skip(ctx, playId, { kind: 'sleep', requestId: uid() });
    const post = (await viewOf(ctx, playId)).posts.find((p) => p.at >= 0 && p.data.kind === 'song')!;
    expect(post).toBeTruthy();
    const v = await editPost(ctx, playId, post.id, { title: '좋은 날', artist: '아이유', note: '아침부터 이거.' });
    const now = v.posts.find((p) => p.id === post.id)!;
    expect(now.data).toEqual({ kind: 'song', title: '좋은 날', artist: '아이유', note: '아침부터 이거.' });
    expect(now.text).toContain('「좋은 날」');
    const ev = await ctx.db.all<{ text: string }>("SELECT text FROM events WHERE play_id = ? AND kind = 'feed'", playId);
    expect(ev.map((e) => e.text)).toEqual([now.text]);
    await say(ctx, playId, { text: '좋은 아침.', requestId: uid() });
    const reply = ctx.model.calls.filter((c) => c.purpose === 'reply').at(-1)!;
    expect(JSON.stringify(reply.layers)).not.toContain('밤편지');
  });

  it('비운 칸이나 너무 긴 칸은 받지 않는다. 종류는 바뀌지 않는다', async () => {
    const { ctx, playId } = await solo();
    await skip(ctx, playId, { kind: 'sleep', requestId: uid() });
    const post = (await viewOf(ctx, playId)).posts.find((p) => p.at >= 0)!;
    expect(await failCode(editPost(ctx, playId, post.id, { title: '', artist: '아이유' }))).toBe('bad_post');
    expect(await failCode(editPost(ctx, playId, post.id, { title: '가'.repeat(200) }))).toBe('bad_post');
    const v = await editPost(ctx, playId, post.id, { kind: 'diary', text: '일기로 바꾸기', title: '밤편지', artist: '아이유' });
    expect(v.posts.find((p) => p.id === post.id)!.data.kind).toBe('song');
  });
});

describe('필름 지우기', () => {
  it('만든 사람만 지운다. 지우면 목록과 필름 정보에서 사라지고 새로 들어갈 수 없다', async () => {
    const { ctx, filmId } = await solo();
    expect(await failCode(dropFilm({ ...ctx, visitor: OTHER_VISITOR }, filmId))).toBe('film_missing');
    expect((await listFilms(ctx)).some((f) => f.id === filmId)).toBe(true);
    await dropFilm(ctx, filmId);
    expect((await listFilms(ctx)).some((f) => f.id === filmId)).toBe(false);
    expect((await listFilms({ ...ctx, visitor: OTHER_VISITOR })).some((f) => f.id === filmId)).toBe(false);
    expect(await failCode(getFilm(ctx, filmId))).toBe('film_missing');
    expect(await failCode(enter(ctx, filmId, uid()))).toBe('film_missing');
    expect(await failCode(dropFilm(ctx, filmId))).toBe('film_missing');
  });

  it('들어가 살던 삶은 이어서 산다. 내 삶 목록에는 지운 필름의 삶이라고 적힌다', async () => {
    const { ctx, filmId, playId } = await solo();
    const guest = { ...ctx, visitor: OTHER_VISITOR };
    await chooseAs(guest, filmId, { as: 'role' });
    const theirs = await enter(guest, filmId, uid());
    await dropFilm(ctx, filmId);
    const v = await say(ctx, playId, { text: '안녕하세요.', requestId: uid() });
    expect(v.messages.at(-1)!.text).toBe('네.');
    expect((await say(guest, theirs.id, { text: '저도 왔어요.', requestId: uid() })).messages.at(-1)!.text).toBe('네.');
    expect((await listPlays(ctx))[0]).toMatchObject({ id: playId, filmGone: true });
    expect((await ctx.db.first<{ n: number }>('SELECT COUNT(*) AS n FROM personas WHERE film_id = ?', filmId))!.n).toBe(0);
  });
});
