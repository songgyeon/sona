import { describe, expect, it } from 'vitest';
import { openFeed } from '../../worker/engine/alive';
import { createFilm } from '../../worker/engine/films';
import { skip } from '../../worker/engine/skip';
import { sendText } from '../../worker/engine/text';
import { enter, say } from '../../worker/engine/turn';
import { demoScript } from '../../worker/model/fake';
import type { Purpose } from '../../worker/model/index';
import { TWO_FILM, testCtx, uid } from '../helpers/film';

/* 수위 — 지금은 연령 제한이 없는 서비스라서 수위를 모두 막는다(2026-11-14 사용자).
   대사 모델이 글을 쓰는 자리마다 작가 규칙에 같은 줄이 가야 한다. 필름마다 디렉터가 적는 것과 상관없이, 누가 만든 필름이든. */
const RULE = '선정적인 묘사는 쓰지 않는다';

/** 글을 쓰는 자리. check(한 줄 판정)는 글을 쓰지 않는다 */
const WRITERS: Purpose[] = ['first', 'reply', 'ping', 'text', 'gap', 'aside', 'post', 'past'];

describe('수위', () => {
  it('들어가서 말하고, 피드를 열고, 문자를 보내고, 밤을 넘기는 동안 대사 모델이 쓰는 글마다 수위 줄이 간다', async () => {
    // 로컬 화면용 흉내 — 혼자 보낸 시간에 말거리가 있어야 먼저 거는 연락이 나간다
    const ctx = testCtx(demoScript);
    const { id } = await createFilm(ctx, { ...TWO_FILM, opens: { feed: true, ping: true, aside: true } });
    const v = await enter(ctx, id, uid());
    await say(ctx, v.id, { text: '오늘 회의 몇 시였죠?', requestId: uid() });
    await openFeed(ctx, v.id);
    await sendText(ctx, v.id, { to: 'c2', text: '내일 아침에 잠깐 봬요.', requestId: uid() });
    await skip(ctx, v.id, { kind: 'sleep', requestId: uid() });
    await skip(ctx, v.id, { kind: 'evening', requestId: uid() });

    const writes = ctx.model.calls.filter((c) => WRITERS.includes(c.purpose));
    const seen = new Set(writes.map((c) => c.purpose));
    // 글을 쓰는 자리를 실제로 거쳤는지부터 — 안 거친 자리는 이 시험이 지켜 주지 못한다
    expect([...seen].sort()).toEqual(['aside', 'gap', 'past', 'ping', 'post', 'reply', 'text'].sort());
    for (const c of writes) expect(c.layers.system, c.purpose).toContain(RULE);
  });

  it('장면을 여는 대목(캐스트가 먼저 말하는 첫 장면)에도 간다', async () => {
    const ctx = testCtx();
    const { id } = await createFilm(ctx, { ...TWO_FILM, firstScene: { ...TWO_FILM.firstScene, speaker: 'cast' } });
    await enter(ctx, id, uid());
    const first = ctx.model.calls.filter((c) => c.purpose === 'first');
    expect(first.length).toBeGreaterThan(0);
    for (const c of first) expect(c.layers.system).toContain(RULE);
  });
});
