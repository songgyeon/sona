import { describe, expect, it } from 'vitest';
import { createFilm } from '../../worker/engine/films';
import { Fail } from '../../worker/engine/ctx';
import { dropPlay, listPlays, viewOf } from '../../worker/engine/store';
import { enter, say } from '../../worker/engine/turn';
import { DEV_FILM, OTHER_VISITOR, testCtx, uid } from '../helpers/film';

/* 내 삶 목록 — 한 번에 읽는다. 삶이 들고 있는 필름에서 목록에 보일 칸만 꺼낸다. 삶은 지울 수 있다 */

async function failCode(p: Promise<unknown>): Promise<string | null> {
  try {
    await p;
  } catch (e) {
    if (e instanceof Fail) return e.code;
    throw e;
  }
  return null;
}
describe('내 삶 목록', () => {
  it('제목, 캐스트 이름, 흐른 시간, 마지막으로 오간 말이 선다. 최근에 들어간 삶부터다', async () => {
    const ctx = testCtx();
    const { id: filmId } = await createFilm(ctx, DEV_FILM);
    const first = await enter(ctx, filmId, uid());
    const second = await enter(ctx, filmId, uid());
    await say(ctx, second.id, { text: '안녕하세요.', requestId: uid() });
    const list = await listPlays(ctx);
    expect(list.map((p) => p.id)).toEqual([second.id, first.id]);
    const now = await viewOf(ctx, second.id);
    expect(list[0]).toMatchObject({
      filmId,
      title: DEV_FILM.title,
      logline: DEV_FILM.logline,
      castNames: DEV_FILM.casts.map((c) => c.name),
      elapsed: now.elapsed,
      ended: false,
      lastLine: now.messages.filter((m) => m.speaker !== 'tell').at(-1)!.text,
    });
    expect(list[0]!.elapsed).toBeGreaterThan(0);
  });

  it('남의 삶은 목록에 없다', async () => {
    const ctx = testCtx();
    const { id: filmId } = await createFilm(ctx, DEV_FILM);
    await enter(ctx, filmId, uid());
    expect(await listPlays({ ...ctx, visitor: OTHER_VISITOR })).toEqual([]);
  });

  it('삶을 지우면 그 삶과 딸린 것이 다 없어진다. 다른 삶은 그대로다. 남의 삶은 못 지운다', async () => {
    const ctx = testCtx();
    const { id: filmId } = await createFilm(ctx, DEV_FILM);
    const a = await enter(ctx, filmId, uid());
    const b = await enter(ctx, filmId, uid());
    await say(ctx, a.id, { text: '안녕하세요.', requestId: uid() });
    await say(ctx, b.id, { text: '반가워요.', requestId: uid() });
    expect(await failCode(dropPlay({ ...ctx, visitor: OTHER_VISITOR }, a.id))).toBe('play_missing');
    const left = await dropPlay(ctx, a.id);
    expect(left.map((p) => p.id)).toEqual([b.id]);
    for (const t of ['messages', 'turns', 'events', 'gen_log']) {
      expect((await ctx.db.first<{ n: number }>(`SELECT COUNT(*) AS n FROM ${t} WHERE play_id = ?`, a.id))!.n).toBe(0);
    }
    expect((await ctx.db.first<{ n: number }>('SELECT COUNT(*) AS n FROM messages WHERE play_id = ?', b.id))!.n).toBeGreaterThan(0);
    expect(await failCode(viewOf(ctx, a.id))).toBe('play_missing');
    expect(await failCode(dropPlay(ctx, a.id))).toBe('play_missing');
  });
});
