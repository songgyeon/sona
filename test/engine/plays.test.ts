import { describe, expect, it } from 'vitest';
import { createFilm } from '../../worker/engine/films';
import { listPlays, viewOf } from '../../worker/engine/store';
import { enter, say } from '../../worker/engine/turn';
import { DEV_FILM, OTHER_VISITOR, testCtx, uid } from '../helpers/film';

/* 내 삶 목록 — 한 번에 읽는다. 삶이 들고 있는 필름에서 목록에 보일 칸만 꺼낸다 */
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
});
