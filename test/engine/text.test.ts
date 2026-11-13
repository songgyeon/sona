import { describe, expect, it } from 'vitest';
import { RULES } from '../../shared/rules';
import type { MessageView } from '../../shared/types';
import { owed } from '../../worker/engine/alive';
import { Fail } from '../../worker/engine/ctx';
import { createFilm } from '../../worker/engine/films';
import { skip } from '../../worker/engine/skip';
import { viewOf } from '../../worker/engine/store';
import { sendText } from '../../worker/engine/text';
import { enter, retry, say } from '../../worker/engine/turn';
import { FAKE_DEFAULTS } from '../../worker/model/fake';
import type { ModelCall } from '../../worker/model/index';
import { DEV_FILM, testCtx, uid } from '../helpers/film';

/* 유저의 문자 — 캐스트 한 사람에게 폰으로 보낸다. 장면은 멈춰 있다.
   임시 필름(동네 서점): 금요일 16:00에 시작한다. 한서(c1)는 1:00~8:30, 지후(c2)는 2:00~10:00에 잔다. */

async function fail(p: () => unknown): Promise<Fail | null> {
  try {
    await p();
  } catch (e) {
    if (e instanceof Fail) return e;
    throw e;
  }
  return null;
}

const of = (calls: ModelCall[], purpose: string) => calls.filter((c) => c.purpose === purpose);
const mine = (ms: MessageView[]) => ms.filter((m) => m.speaker === 'persona' && m.kind === 'ping');
const from = (ms: MessageView[], key: string) => ms.filter((m) => m.speaker === key && m.kind === 'ping');

describe('유저의 문자', () => {
  it('보내면 받는 사람 방에 적히고 대사 한 번만큼 시간이 흐른다. 깨어 있으면 그 사람이 문자로 답한다. 장면 작가는 부르지 않는다', async () => {
    const ctx = testCtx();
    const { id } = await createFilm(ctx, DEV_FILM);
    const v = await enter(ctx, id, uid());
    const before = ctx.model.calls.length;
    const rid = uid();
    const after = await sendText(ctx, v.id, { to: 'c2', text: '  내일도 와요?  ', requestId: rid });

    expect(after.elapsed).toBe(v.elapsed + RULES.minutesPerSend);
    expect(mine(after.messages)).toMatchObject([{ room: 'c2', text: '내일도 와요?', at: after.elapsed }]);
    // 답장: 줄마다 메시지 하나, 많아야 replyMax 줄
    expect(from(after.messages, 'c2').map((m) => [m.room, m.text, m.at])).toEqual(
      FAKE_DEFAULTS.text.split('\n').slice(0, RULES.text.replyMax).map((t) => ['c2', t, after.elapsed]),
    );
    expect(after.stuck).toBeNull();

    const calls = ctx.model.calls.slice(before);
    expect(calls.map((c) => c.purpose)).toEqual(['text']);
    // 그 사람이 되어 쓴다. 받은 문자를 건넨다
    expect(calls[0]!.layers.cast).toContain('이름: 지후');
    expect(calls[0]!.user).toContain('내일도 와요?');

    // 같은 전송이 또 들어와도 한 번만 처리한다
    const again = await sendText(ctx, v.id, { to: 'c2', text: '내일도 와요?', requestId: rid });
    expect(again.elapsed).toBe(after.elapsed);
    expect(again.messages).toHaveLength(after.messages.length);
    expect(ctx.model.calls).toHaveLength(before + 1);
  });

  it('자고 있으면 답이 없다. 깨어 있게 된 다음 대사 턴에 답한다 — 그 턴에는 먼저 오는 메시지 대신이다', async () => {
    const ctx = testCtx();
    // 9:54에 시작한다. 지후는 10:00에 깬다
    const { id } = await createFilm(ctx, { ...DEV_FILM, startMin: 9 * 60 + 54 });
    const v = await enter(ctx, id, uid());

    const sent = await sendText(ctx, v.id, { to: 'c2', text: '일어나면 연락 줘요.', requestId: uid() });
    expect(of(ctx.model.calls, 'text')).toHaveLength(0);
    expect(from(sent.messages, 'c2')).toHaveLength(0);
    expect(sent.stuck).toBeNull();

    // 10:00. 지후가 깨어 있다
    const next = await say(ctx, v.id, { text: '오늘 날씨 좋네요.', requestId: uid() });
    expect(of(ctx.model.calls, 'text')).toHaveLength(1);
    expect(of(ctx.model.calls, 'text')[0]!.user).toContain('일어나면 연락 줘요.');
    expect(from(next.messages, 'c2').length).toBeGreaterThan(0);
    expect(from(next.messages, 'c2').every((m) => m.at === next.elapsed && m.room === 'c2')).toBe(true);

    // 한 번 답했으면 또 답하지 않는다
    await say(ctx, v.id, { text: '저 책 정리할게요.', requestId: uid() });
    expect(of(ctx.model.calls, 'text')).toHaveLength(1);
  });

  it('자는 동안 온 문자는 시간을 넘긴 사이에 그 사람이 깨고 조금 뒤에 답한다. 그 사람은 그때 먼저 연락하지 않는다', async () => {
    const ctx = testCtx();
    // 새벽 3시에 시작한다. 둘 다 자고 있다
    const { id } = await createFilm(ctx, { ...DEV_FILM, startMin: 3 * 60 });
    const v = await enter(ctx, id, uid());
    await sendText(ctx, v.id, { to: 'c2', text: '자요?', requestId: uid() });

    // 아침 7시로. 지후는 아직 잔다(10시에 깬다)
    const morning = await skip(ctx, v.id, { kind: 'sleep', requestId: uid() });
    expect(of(ctx.model.calls, 'text')).toHaveLength(0);
    expect(from(morning.messages, 'c2')).toHaveLength(0);

    // 저녁으로. 그 사이 10시에 깬다 — 깨고 wakeLagMin 뒤에 답장이 와 있다
    const evening = await skip(ctx, v.id, { kind: 'evening', requestId: uid() });
    const woke = 10 * 60 - 3 * 60;
    const replies = from(evening.messages, 'c2');
    expect(replies.length).toBeGreaterThan(0);
    expect(replies.every((m) => m.at === woke + RULES.text.wakeLagMin)).toBe(true);
    const asked = of(ctx.model.calls, 'text');
    expect(asked).toHaveLength(1);
    // 언제 온 메시지를 지금 보는지 알려 준다. 자리를 비운 사이라 다른 곳에 있다
    expect(asked[0]!.user).toContain('지금 봤다');
    expect(asked[0]!.user).toContain('다른 곳에 있다');
    // 답한 사람은 이번 넘기기에서 먼저 연락하지 않는다
    expect(of(ctx.model.calls, 'ping').some((c) => c.layers.cast.includes('이름: 지후'))).toBe(false);
  });

  it('문자는 보낸 사람과 받은 사람만 안다. 장면 작가에게는 받는 사람과 함께 가고, 다른 캐스트의 혼자 보낸 시간·먼저 거는 연락·한편에는 가지 않는다', async () => {
    const ctx = testCtx((call) =>
      // 한서가 저녁에 건넬 얘깃거리를 하나 남긴다 — 그래야 먼저 연락한다
      call.purpose === 'gap' && call.layers.cast.includes('이름: 한서') ? '18:30 | 말거리 | 새로 들어온 책을 정리했다.' : FAKE_DEFAULTS[call.purpose],
    );
    const { id } = await createFilm(ctx, { ...DEV_FILM, opens: { feed: true, ping: true, aside: true } });
    const v = await enter(ctx, id, uid());
    const secret = '우산은 제가 몰래 챙겨 뒀어요.';
    await sendText(ctx, v.id, { to: 'c2', text: secret, requestId: uid() });

    // 다음 대목: 작가는 문자를 받는 사람과 함께 읽는다
    await say(ctx, v.id, { text: '오늘은 일찍 닫을까요?', requestId: uid() });
    const writer = of(ctx.model.calls, 'reply').at(-1)!.layers.scene;
    expect(writer).toContain(`수아(지후에게 메시지): ${secret}`);
    expect(writer).toContain(`지후(수아에게 메시지): ${FAKE_DEFAULTS.text.split('\n')[0]}`);

    await skip(ctx, v.id, { kind: 'sleep', requestId: uid() });
    const seen = (purpose: string, name: string) =>
      of(ctx.model.calls, purpose)
        .filter((c) => c.layers.cast.includes(`이름: ${name}`))
        .map((c) => JSON.stringify(c));
    // 한서의 혼자 보낸 시간과 먼저 건 연락: 문자를 모른다
    expect(seen('gap', '한서').length).toBeGreaterThan(0);
    expect(seen('gap', '한서').some((c) => c.includes(secret))).toBe(false);
    expect(seen('ping', '한서').length).toBeGreaterThan(0);
    expect(seen('ping', '한서').some((c) => c.includes(secret))).toBe(false);
    // 한편: 장면에서 오간 말이 아니다
    const asides = of(ctx.model.calls, 'aside').map((c) => JSON.stringify(c));
    expect(asides.length).toBeGreaterThan(0);
    expect(asides.some((c) => c.includes(secret))).toBe(false);
    // 받은 사람은 안다
    expect(of(ctx.model.calls, 'text')[0]!.layers.scene).toContain(secret);
  });

  it('답장을 못 받아도 장면은 멈추지 않는다. 답하지 않은 문자로 남아 다음 대사 턴에 답한다', async () => {
    let down = true;
    const ctx = testCtx((call) => {
      if (call.purpose === 'text' && down) throw new Error('잠깐 끊김');
      return FAKE_DEFAULTS[call.purpose];
    });
    const { id } = await createFilm(ctx, DEV_FILM);
    const v = await enter(ctx, id, uid());
    const sent = await sendText(ctx, v.id, { to: 'c1', text: '셔터 열쇠 어디 있어요?', requestId: uid() });
    expect(sent.stuck).toBeNull();
    expect(from(sent.messages, 'c1')).toHaveLength(0);

    down = false;
    const next = await say(ctx, v.id, { text: '먼저 정리하고 있을게요.', requestId: uid() });
    // 그 턴의 장면에 한서가 나오면 문자 답장은 버린다 — 얼굴을 보고 말했다. 가짜 작가는 첫 사람(한서)을 말하게 한다
    expect(of(ctx.model.calls, 'text')).toHaveLength(2);
    expect(from(next.messages, 'c1')).toHaveLength(0);
    expect(next.messages.some((m) => m.speaker === 'c1' && m.kind === 'chat')).toBe(true);
    // 한서가 장면에서 말했으니 더는 답할 문자가 없다
    await say(ctx, v.id, { text: '네.', requestId: uid() });
    expect(of(ctx.model.calls, 'text')).toHaveLength(2);
  });

  it('답장을 받다 끊긴 문자 턴은 다시 받기로 답장만 마저 받는다', async () => {
    const ctx = testCtx();
    const { id } = await createFilm(ctx, DEV_FILM);
    const v = await enter(ctx, id, uid());
    const sent = await sendText(ctx, v.id, { to: 'c2', text: '지금 어디예요?', requestId: uid() });
    // 끊긴 것처럼: 답장을 지우고 턴을 열어 둔다
    await ctx.db.run("DELETE FROM messages WHERE play_id = ? AND speaker = 'c2'", v.id);
    await ctx.db.run("UPDATE turns SET status = 'pending' WHERE play_id = ? AND kind = 'text'", v.id);
    expect((await viewOf(ctx, v.id)).stuck).toMatchObject({ kind: 'text', room: 'c2' });

    const calls = ctx.model.calls.length;
    const back = await retry(ctx, v.id);
    expect(back.stuck).toBeNull();
    expect(back.elapsed).toBe(sent.elapsed);
    expect(from(back.messages, 'c2').length).toBeGreaterThan(0);
    expect(ctx.model.calls.slice(calls).map((c) => c.purpose)).toEqual(['text']);
  });

  it('보낼 수 없는 문자는 까닭을 말하고 거절한다', async () => {
    const ctx = testCtx();
    const { id } = await createFilm(ctx, DEV_FILM);
    const v = await enter(ctx, id, uid());
    const send = (input: { to: unknown; text: unknown; requestId?: unknown }) => fail(() => sendText(ctx, v.id, { requestId: uid(), ...input }));

    expect((await send({ to: 'c9', text: '누구세요?' }))?.code).toBe('bad_to');
    expect((await send({ to: 'persona', text: '나한테?' }))?.code).toBe('bad_to');
    expect((await send({ to: 'c2', text: '   ' }))?.code).toBe('empty_text');
    expect((await send({ to: 'c2', text: '가'.repeat(RULES.limits.text + 1) }))?.code).toBe('long_text');
    expect((await send({ to: 'c2', text: '가', requestId: 'x' }))?.code).toBe('bad_request_id');
    expect(await send({ to: 'c2', text: '가'.repeat(RULES.limits.text) })).toBeNull();

    // 앞 턴이 멈춰 있으면
    await ctx.db.run("UPDATE turns SET status = 'failed' WHERE play_id = ?", v.id);
    expect((await send({ to: 'c2', text: '여보세요?' }))?.code).toBe('stuck');
    await ctx.db.run("UPDATE turns SET status = 'done' WHERE play_id = ?", v.id);

    // 하루가 끝났으면
    await ctx.db.run('UPDATE plays SET ended = 1 WHERE id = ?', v.id);
    expect((await send({ to: 'c2', text: '여보세요?' }))?.code).toBe('ended');
  });

  it('하루의 끝을 문자로 넘기면 하루가 끝난다', async () => {
    const ctx = testCtx();
    const { id } = await createFilm(ctx, DEV_FILM);
    const v = await enter(ctx, id, uid());
    await ctx.db.run('UPDATE plays SET elapsed = ? WHERE id = ?', RULES.trialMinutes - RULES.minutesPerSend, v.id);
    const last = await sendText(ctx, v.id, { to: 'c1', text: '잘 자요.', requestId: uid() });
    expect(last.ended).toBe(true);
  });
});

describe('답하지 않은 문자', () => {
  const m = (speaker: string, kind: MessageView['kind'], room: string, at: number): MessageView => ({ id: `${speaker}${at}`, room, speaker, text: '…', at, kind, turnId: `t${at}` });

  it('그 사람이 마지막으로 말한 뒤에 보낸 문자들이다. 그 뒤 장면에서 말했으면 없다. 남에게 보낸 문자는 치지 않는다', () => {
    const a = m('persona', 'ping', 'c2', 1);
    const b = m('persona', 'ping', 'c2', 2);
    expect(owed([a, b], 'c2')).toEqual([a, b]);
    expect(owed([a, m('c2', 'ping', 'c2', 2), b], 'c2')).toEqual([b]);
    expect(owed([a, b, m('c2', 'chat', 'scene', 3)], 'c2')).toEqual([]);
    expect(owed([a, b], 'c1')).toEqual([]);
    expect(owed([a, m('persona', 'ping', 'c1', 2)], 'c2')).toEqual([a]);
    // 한편의 줄은 유저에게 한 말이 아니다
    expect(owed([a, m('c2', 'aside', 'x', 2)], 'c2')).toEqual([a]);
  });
});
