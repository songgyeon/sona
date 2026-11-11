/* 인물의 답을 받는 곳. 모델은 문장만 쓴다. 한 턴에 한 번 부른다. */

import { trialOver } from '../../shared/clock';
import { RULES } from '../../shared/rules';
import type { TurnView } from '../../shared/types';
import { newId, q, type Stmt } from '../db';
import { spend } from '../guard';
import type { Layers, ModelCall, ModelOut, Purpose } from '../model/index';
import { castLayer } from '../prompt/cast';
import { sceneLayer, type SceneEvent } from '../prompt/scene';
import { SYSTEM_LAYER } from '../prompt/system';
import { type Ctx, Fail } from './ctx';
import { messagesOf, type Play } from './store';

/** 줄바꿈 하나가 말풍선 하나다. 줄을 지우거나 고치지 않는다 — 빈 줄만 걷는다 */
export function bubbles(raw: string): string[] {
  return raw
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** 모델을 부른 일을 남긴다. 화면에는 안 보이고, 답이 이상할 때 까닭을 찾는 데 쓴다 */
export function logStmt(
  ctx: Ctx,
  playId: string,
  turnId: string,
  call: ModelCall,
  out: ModelOut | null,
  accepted: boolean,
  note: string | null,
): Stmt {
  return q(
    'INSERT INTO gen_log (id, play_id, turn_id, purpose, model, layers, raw, thinking, accepted, note, ms, tokens_in, tokens_out, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    newId(),
    playId,
    turnId,
    call.purpose,
    ctx.model.id,
    JSON.stringify({ ...call.layers, user: call.user }),
    out?.text ?? '',
    out?.thinking ?? null,
    accepted ? 1 : 0,
    note,
    out?.ms ?? 0,
    out?.tokensIn ?? null,
    out?.tokensOut ?? null,
    ctx.now(),
  );
}

/** 이 인물이 아는 일만 고른다. 같은 일도 누가 읽느냐에 따라 다르게 적힌다 —
    제 피드 글은 "올렸다", 남의 피드 글은 "피드에서 봤다"다. */
export async function eventsFor(ctx: Ctx, play: Play, castKey: string, upTo = Infinity): Promise<SceneEvent[]> {
  const rows = await ctx.db.all<{ at: number; kind: string; actor: string; text: string; known_by: string }>(
    'SELECT at, kind, actor, text, known_by FROM events WHERE play_id = ? ORDER BY at, rowid',
    play.id,
  );
  const nameOf = (key: string) => play.film.casts.find((c) => c.key === key)?.name ?? key;
  return rows
    .filter((r) => r.at <= upTo && (JSON.parse(r.known_by) as string[]).includes(castKey))
    .map((r) => {
      if (r.kind !== 'post') return { at: r.at, text: r.text };
      return {
        at: r.at,
        text: r.actor === castKey ? `피드에 올렸다: 「${r.text}」` : `${nameOf(r.actor)}의 피드에서 봤다: 「${r.text}」`,
      };
    });
}

const FIRST_CUE = '(이야기가 지금 시작된다. 네가 먼저 말을 건다.)';

/** 하루 몫에서 덜고 모델을 부른다 */
export async function ask(ctx: Ctx, call: ModelCall): Promise<ModelOut> {
  await spend(ctx.db, ctx.now());
  return ctx.model.run(call);
}

export const errText = (e: unknown) => String((e as Error)?.message ?? e).slice(0, 300);

/** 이 턴의 답을 받는다. 받으면 턴을 done으로, 못 받으면 failed로 남긴다.
    못 받아도 시계는 이미 갔다 — 다시 받기는 시계를 또 밀지 않는다. */
export async function answer(ctx: Ctx, play: Play, turn: TurnView): Promise<void> {
  const film = play.film;
  const cast = film.casts.find((c) => c.key === turn.room);
  if (!cast) throw new Fail(500, 'room_missing', '이 방의 인물을 못 찾았어.');

  const all = await messagesOf(ctx.db, play.id, cast.key);
  const nameOf = (speaker: string) => (speaker === 'persona' ? film.persona.name : cast.name);

  let purpose: Purpose;
  let user: string;
  let before = all;
  if (turn.kind === 'enter') {
    purpose = 'first';
    user = FIRST_CUE;
  } else {
    const last = all[all.length - 1];
    if (!last || last.speaker !== 'persona') throw new Fail(500, 'no_user_line', '답할 말을 못 찾았어.');
    purpose = 'reply';
    user = last.text;
    before = all.slice(0, -1);
  }

  const layers: Layers = {
    system: SYSTEM_LAYER,
    cast: castLayer(film, cast),
    scene: sceneLayer({
      film,
      cast,
      clock: play,
      events: await eventsFor(ctx, play, cast.key),
      history: before.slice(-RULES.historyLines).map((m) => ({ speaker: nameOf(m.speaker), text: m.text })),
    }),
  };
  const call: ModelCall = { purpose, layers, user, temperature: 0.8, maxTokens: 400 };

  const fail = async (reason: string, out: ModelOut | null, note: string) => {
    await ctx.db.batch([
      q("UPDATE turns SET status = 'failed', fail_reason = ? WHERE id = ?", reason, turn.id),
      logStmt(ctx, play.id, turn.id, call, out, false, note),
    ]);
  };

  let out: ModelOut;
  try {
    out = await ask(ctx, call);
  } catch (e) {
    // 각본으로 덮지 않는다. 못 받았다고 보여주고, 까닭을 알려 준다
    if (e instanceof Fail) {
      await fail(e.code, null, e.message);
      throw e;
    }
    await fail('model_error', null, errText(e));
    return;
  }

  const lines = bubbles(out.text);
  if (lines.length === 0) {
    await fail('empty', out, '빈 답');
    return;
  }

  const stmts: Stmt[] = lines.map((text) =>
    q(
      'INSERT INTO messages (id, play_id, turn_id, room, speaker, text, at, kind, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      newId(),
      play.id,
      turn.id,
      cast.key,
      cast.key,
      text,
      play.elapsed,
      turn.kind === 'enter' ? 'first' : 'chat',
      ctx.now(),
    ),
  );
  stmts.push(q("UPDATE turns SET status = 'done', fail_reason = NULL WHERE id = ?", turn.id));
  stmts.push(logStmt(ctx, play.id, turn.id, call, out, true, null));
  if (trialOver(play.elapsed)) stmts.push(q('UPDATE plays SET ended = 1 WHERE id = ?', play.id));
  await ctx.db.batch(stmts);
}
