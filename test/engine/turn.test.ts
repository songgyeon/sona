import { describe, expect, it } from 'vitest';
import { RULES } from '../../shared/rules';
import { Fail } from '../../worker/engine/ctx';
import { createFilm, parseFilm } from '../../worker/engine/films';
import { viewOf } from '../../worker/engine/store';
import { enter, retry, say } from '../../worker/engine/turn';
import { FAKE_DEFAULTS, type Script } from '../../worker/model/fake';
import { DEV_FILM, OTHER_VISITOR, testCtx, uid } from '../helpers/film';

async function setup(script?: Script, film: unknown = DEV_FILM) {
  const ctx = testCtx(script);
  const { id: filmId } = await createFilm(ctx, film);
  const playId = uid();
  const view = await enter(ctx, filmId, playId);
  return { ctx, filmId, playId, view };
}

const send = (ctx: ReturnType<typeof testCtx>, playId: string, text: string, room = 'c1', requestId = uid()) =>
  say(ctx, playId, { room, text, requestId });

async function failCode(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    if (e instanceof Fail) return e.code;
    throw e;
  }
  return 'no-fail';
}

describe('필름 읽기', () => {
  it('캐스트에 이름표를 순서대로 붙인다', () => {
    const film = parseFilm(DEV_FILM);
    expect(film.casts.map((c) => c.key)).toEqual(['c1', 'c2']);
    expect(film.ties[0]).toMatchObject({ from: 'c1', to: 'c2', calls: '형' });
  });

  it('비어 있으면 안 되는 칸을 말해 준다', async () => {
    expect(await failCode(Promise.resolve().then(() => parseFilm({ ...DEV_FILM, title: ' ' })))).toBe('film_invalid');
    expect(await failCode(Promise.resolve().then(() => parseFilm({ ...DEV_FILM, casts: [] })))).toBe('film_invalid');
    expect(
      await failCode(
        Promise.resolve().then(() => parseFilm({ ...DEV_FILM, ties: [{ from: 'c1', to: 'c9', relation: '?', calls: '' }] })),
      ),
    ).toBe('film_invalid');
  });
});

describe('입장', () => {
  it('디렉터가 쓴 첫 마디로 시작한다 — 모델을 부르지 않는다', async () => {
    const { ctx, view } = await setup();
    expect(view.elapsed).toBe(0);
    expect(view.messages).toHaveLength(1);
    expect(view.messages[0]).toMatchObject({ room: 'c1', speaker: 'c1', kind: 'first', at: 0 });
    expect(view.messages[0]!.text).toBe(DEV_FILM.firstScene.firstLine);
    expect(ctx.model.calls).toHaveLength(0);
  });

  it('같은 입장 표로 두 번 들어와도 삶은 하나다', async () => {
    const { ctx, filmId, playId } = await setup();
    const again = await enter(ctx, filmId, playId);
    expect(again.messages).toHaveLength(1);
    const plays = await ctx.db.all('SELECT id FROM plays');
    expect(plays).toHaveLength(1);
  });

  it('첫 마디를 비워 두면 모델이 쓴다', async () => {
    const film = { ...DEV_FILM, firstScene: { ...DEV_FILM.firstScene, firstLine: '' } };
    const { ctx, view } = await setup(() => '어, 왔어요?', film);
    expect(view.messages.map((m) => m.text)).toEqual(['어, 왔어요?']);
    expect(ctx.model.calls.map((c) => c.purpose)).toEqual(['first']);
  });

  it('남의 플레이는 안 읽힌다', async () => {
    const { ctx, playId } = await setup();
    expect(await failCode(viewOf({ ...ctx, visitor: OTHER_VISITOR }, playId))).toBe('play_missing');
  });
});

describe('한 마디', () => {
  it('전송 1건마다 정해진 만큼만 시간이 간다', async () => {
    const { ctx, playId } = await setup();
    for (let i = 1; i <= 5; i++) {
      const v = await send(ctx, playId, `말 ${i}`);
      expect(v.elapsed).toBe(i * RULES.minutesPerSend);
    }
  });

  it('모델이 뭐라고 쓰든 시계는 안 움직인다', async () => {
    const { ctx, playId } = await setup(() => '그렇게 일주일이 지났어요.\n벌써 다음 달이네요.');
    const v = await send(ctx, playId, '안녕');
    expect(v.elapsed).toBe(RULES.minutesPerSend);
    expect(v.ended).toBe(false);
  });

  it('줄바꿈 하나가 말풍선 하나다', async () => {
    const { ctx, playId } = await setup(() => '네.\n\n  그건 제가 할게요.  \n');
    const v = await send(ctx, playId, '이거 어디 둬요?');
    const mine = v.messages.filter((m) => m.kind === 'chat' && m.speaker === 'c1').map((m) => m.text);
    expect(mine).toEqual(['네.', '그건 제가 할게요.']);
  });

  it('같은 전송이 두 번 들어와도 턴은 하나다', async () => {
    const { ctx, playId } = await setup();
    const requestId = uid();
    await send(ctx, playId, '안녕', 'c1', requestId);
    const v = await send(ctx, playId, '안녕', 'c1', requestId);
    expect(v.elapsed).toBe(RULES.minutesPerSend);
    expect(v.messages.filter((m) => m.speaker === 'persona')).toHaveLength(1);
    expect(ctx.model.calls.filter((c) => c.purpose === 'reply')).toHaveLength(1);
  });

  it('한 방에서 한 얘기는 다른 인물의 프롬프트에 안 실린다', async () => {
    const { ctx, playId } = await setup();
    await send(ctx, playId, '이건 한서 씨한테만 하는 얘긴데, 나 다음 달에 그만둬요.', 'c1');
    await send(ctx, playId, '안녕하세요.', 'c2');
    const toJihu = ctx.model.calls.at(-1)!;
    expect(toJihu.layers.cast).toContain('이름: 지후');
    const everything = [toJihu.layers.system, toJihu.layers.cast, toJihu.layers.scene, toJihu.user].join('\n');
    expect(everything).not.toContain('그만둬요');
    // 반대로 그 방의 인물에게는 실린다
    await send(ctx, playId, '아까 한 말 기억하죠?', 'c1');
    expect(ctx.model.calls.at(-1)!.layers.scene).toContain('그만둬요');
  });

  it('보낸 프롬프트를 층별로 남긴다', async () => {
    const { ctx, playId } = await setup();
    await send(ctx, playId, '안녕');
    const row = await ctx.db.first<{ layers: string; accepted: number; purpose: string }>(
      "SELECT layers, accepted, purpose FROM gen_log WHERE play_id = ? AND purpose = 'reply'",
      playId,
    );
    const layers = JSON.parse(row!.layers) as Record<string, string>;
    expect(row).toMatchObject({ accepted: 1, purpose: 'reply' });
    expect(layers.system).toContain('소나');
    expect(layers.cast).toContain('이름: 한서');
    expect(layers.scene).toContain('[지금]');
    expect(layers.user).toBe('안녕');
  });
});

describe('답을 못 받았을 때', () => {
  it('빈 답이면 턴이 멈추고, 다시 받아도 시계는 또 안 간다', async () => {
    let n = 0;
    const { ctx, playId } = await setup((call) =>
      call.purpose !== 'reply' ? FAKE_DEFAULTS[call.purpose] : n++ === 0 ? '   \n ' : '네.',
    );
    const stuck = await send(ctx, playId, '안녕');
    expect(stuck.stuck).toMatchObject({ status: 'failed', failReason: 'empty' });
    expect(stuck.elapsed).toBe(RULES.minutesPerSend);

    // 멈춘 동안에는 새 말을 못 보낸다
    expect(await failCode(send(ctx, playId, '여보세요'))).toBe('stuck');

    const again = await retry(ctx, playId);
    expect(again.stuck).toBeNull();
    expect(again.elapsed).toBe(RULES.minutesPerSend);
    expect(again.messages.at(-1)).toMatchObject({ speaker: 'c1', text: '네.' });

    // 버린 답도 기록에 남는다
    const logs = await ctx.db.all<{ accepted: number; note: string | null }>(
      "SELECT accepted, note FROM gen_log WHERE play_id = ? AND purpose = 'reply' ORDER BY rowid",
      playId,
    );
    expect(logs.map((l) => l.accepted)).toEqual([0, 1]);
    expect(logs[0]!.note).toBe('빈 답');
  });

  it('모델이 넘어져도 각본으로 덮지 않는다', async () => {
    const { ctx, playId } = await setup(() => {
      throw new Error('upstream 503');
    });
    const v = await send(ctx, playId, '안녕');
    expect(v.stuck).toMatchObject({ status: 'failed', failReason: 'model_error' });
    expect(v.messages.filter((m) => m.speaker === 'c1' && m.kind === 'chat')).toHaveLength(0);
  });
});

describe('첫 하루의 끝', () => {
  it('24시간이 되면 끝나고, 더는 못 보낸다', async () => {
    const { ctx, playId } = await setup();
    await ctx.db.run('UPDATE plays SET elapsed = ? WHERE id = ?', RULES.trialMinutes - RULES.minutesPerSend, playId);
    const v = await send(ctx, playId, '마지막 말');
    expect(v.elapsed).toBe(RULES.trialMinutes);
    expect(v.ended).toBe(true);
    // 그 전송까지는 답을 받는다
    expect(v.messages.at(-1)).toMatchObject({ speaker: 'c1' });
    expect(await failCode(send(ctx, playId, '하나만 더'))).toBe('ended');
  });
});
