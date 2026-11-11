/* 자리 비우기. 유저가 떠났다가 돌아오는 사이에 세계가 흐른다.
   시계는 접수할 때 간다. 그 사이의 일을 못 만들어도 시계는 돌아가지 않는다 —
   그 구간은 조용한 구간으로 남는다. */

import { nextWake, trialOver } from '../../shared/clock';
import { RULES } from '../../shared/rules';
import type { Cast, PlayView } from '../../shared/types';
import { isUniqueError, newId, q, type Stmt } from '../db';
import { isUuid } from '../guard';
import type { ModelCall } from '../model/index';
import { castLayer } from '../prompt/cast';
import { sceneLayer, when } from '../prompt/scene';
import { SYSTEM_LAYER } from '../prompt/system';
import { type Ctx, Fail } from './ctx';
import { GAP_CUE, type GapItem, gapLayers, parseGap, parsePresent, presentLayers, presentUser } from './gap';
import { pingHeld, pingSlots } from './ping';
import { lastTurn, loadPlay, messagesOf, type Play, viewOf } from './store';
import { ask, bubbles, errText, eventsFor, logStmt } from './talk';

export type SkipKind = 'short' | 'errand' | 'sleep';

export async function skip(ctx: Ctx, playId: string, input: { kind: unknown; requestId: unknown }): Promise<PlayView> {
  if (!isUuid(input.requestId)) throw new Fail(400, 'bad_request_id', '전송 표가 맞지 않아.');
  const kind = input.kind;
  if (kind !== 'short' && kind !== 'errand' && kind !== 'sleep') {
    throw new Fail(400, 'bad_skip', '그렇게는 자리를 비울 수 없어.');
  }
  const play = await loadPlay(ctx, playId);

  const dup = await ctx.db.first<{ id: string }>(
    'SELECT id FROM turns WHERE play_id = ? AND request_id = ?',
    playId,
    input.requestId,
  );
  if (dup) return viewOf(ctx, playId);
  if (play.ended) throw new Fail(409, 'ended', '이 필름에서의 첫 하루가 끝났어.');
  const last = await lastTurn(ctx.db, playId);
  if (last && last.status !== 'done') {
    throw new Fail(409, 'stuck', '앞의 말에 답을 아직 못 받았어. 다시 받기를 눌러 줘.');
  }

  const from = play.elapsed;
  const want =
    kind === 'short' ? from + RULES.skip.short : kind === 'errand' ? from + RULES.skip.errand : nextWake(play);
  // 첫 하루를 넘겨서 건너뛰지 않는다
  const to = Math.min(want, RULES.trialMinutes);
  const turnId = newId();
  const turnNo = (last?.no ?? 0) + 1;

  try {
    await ctx.db.batch([
      q(
        'INSERT INTO turns (id, play_id, turn_no, request_id, kind, room, status, elapsed_before, elapsed_after, created_at) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)',
        turnId,
        playId,
        turnNo,
        input.requestId,
        'skip',
        'pending',
        from,
        to,
        ctx.now(),
      ),
      q('UPDATE plays SET elapsed = ? WHERE id = ?', to, playId),
    ]);
  } catch (e) {
    if (isUniqueError(e)) return viewOf(ctx, playId);
    throw e;
  }

  await settle(ctx, { ...play, elapsed: to }, turnId, from, to);
  return viewOf(ctx, playId);
}

/** 접수된 자리 비우기를 마무리한다. 만들다 끊긴 구간은 조용한 구간으로 닫는다 */
export async function settle(ctx: Ctx, play: Play, turnId: string, from: number, to: number): Promise<void> {
  const stmts: Stmt[] = [];
  try {
    await between(ctx, play, turnId, from, to, stmts);
  } catch (e) {
    // 그 사이의 일을 못 만들었다. 시계는 이미 갔고, 돌아가지 않는다
    console.warn('조용한 구간', errText(e));
  }
  stmts.push(q("UPDATE turns SET status = 'done', fail_reason = NULL WHERE id = ?", turnId));
  if (trialOver(to)) stmts.push(q('UPDATE plays SET ended = 1 WHERE id = ?', play.id));
  await ctx.db.batch(stmts);
}

async function between(ctx: Ctx, play: Play, turnId: string, from: number, to: number, stmts: Stmt[]): Promise<void> {
  const film = play.film;
  if (to - from < RULES.gap.minSpanMin || (!film.opens.feed && !film.opens.ping)) return;

  const everyone = ['persona', ...film.casts.map((c) => c.key)];

  for (const cast of film.casts) {
    const items = await lived(ctx, play, turnId, cast, from, to, stmts);

    for (const it of items) {
      if (it.kind === 'daily') {
        // 혼자 한 일은 그 사람만 안다
        stmts.push(eventStmt(ctx, play.id, turnId, it.at, 'daily', cast.key, it.text, [cast.key]));
      } else if (it.kind === 'post' && film.opens.feed) {
        // 피드에 올린 글은 모두가 본다
        stmts.push(
          q(
            'INSERT INTO posts (id, play_id, turn_id, cast_key, text, at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
            newId(),
            play.id,
            turnId,
            cast.key,
            it.text,
            it.at,
            ctx.now(),
          ),
        );
        stmts.push(eventStmt(ctx, play.id, turnId, it.at, 'post', cast.key, it.text, everyone));
      }
    }

    await reachOut(ctx, play, turnId, cast, from, to, items, stmts);
  }
}

function eventStmt(
  ctx: Ctx,
  playId: string,
  turnId: string,
  at: number,
  kind: string,
  actor: string,
  text: string,
  knownBy: string[],
): Stmt {
  return q(
    'INSERT INTO events (id, play_id, turn_id, at, kind, actor, text, known_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    newId(),
    playId,
    turnId,
    at,
    kind,
    actor,
    text,
    JSON.stringify(knownBy),
    ctx.now(),
  );
}

/** 이 사람이 그 사이에 보낸 시간. 못 만들면 빈 채로 돌려준다 */
async function lived(
  ctx: Ctx,
  play: Play,
  turnId: string,
  cast: Cast,
  from: number,
  to: number,
  stmts: Stmt[],
): Promise<GapItem[]> {
  const film = play.film;
  const room = await messagesOf(ctx.db, play.id, cast.key);
  const nameOf = (speaker: string) => (speaker === 'persona' ? film.persona.name : cast.name);
  const call: ModelCall = {
    purpose: 'gap',
    layers: gapLayers(
      film,
      cast,
      play,
      from,
      to,
      await eventsFor(ctx, play, cast.key, from),
      room.slice(-6).map((m) => ({ speaker: nameOf(m.speaker), text: m.text })),
    ),
    user: GAP_CUE,
    temperature: 0.8,
    maxTokens: 400,
  };

  let raw: string;
  try {
    const out = await ask(ctx, call);
    raw = out.text;
    stmts.push(logStmt(ctx, play.id, turnId, call, out, true, null));
  } catch (e) {
    stmts.push(logStmt(ctx, play.id, turnId, call, null, false, `그 사이를 못 만듦: ${errText(e)}`));
    return [];
  }

  const { items } = parseGap(raw, play, from, to, cast);
  const kept: GapItem[] = [];
  for (const it of items) {
    // 유저가 없는 자리에는 유저가 없는 일만 일어난다.
    // 유저의 이름이 나오는 「일상」 줄만 따로 묻는다: 유저가 그 자리에 있는가
    if (it.kind !== 'daily' || !it.text.includes(film.persona.name)) {
      kept.push(it);
      continue;
    }
    const check: ModelCall = {
      purpose: 'check',
      layers: presentLayers(),
      user: presentUser(cast.name, film.persona.name, it.text),
      temperature: 0,
      maxTokens: 20,
    };
    let present: boolean | null = null;
    try {
      const out = await ask(ctx, check);
      present = parsePresent(out.text);
      stmts.push(logStmt(ctx, play.id, turnId, check, out, present !== null, present === true ? '유저가 나와서 그 줄을 버림' : null));
    } catch (e) {
      stmts.push(logStmt(ctx, play.id, turnId, check, null, false, `확인 호출 실패: ${errText(e)}`));
    }
    // 못 읽었으면 버린다 — 유저를 대신 움직이는 쪽으로는 틀리지 않는다
    if (present === false) kept.push(it);
  }
  return kept;
}

/** 먼저 연락할지 정하고, 정해지면 문장을 받는다 */
async function reachOut(
  ctx: Ctx,
  play: Play,
  turnId: string,
  cast: Cast,
  from: number,
  to: number,
  items: GapItem[],
  stmts: Stmt[],
): Promise<void> {
  const film = play.film;
  const room = await messagesOf(ctx.db, play.id, cast.key);
  const nameOf = (speaker: string) => (speaker === 'persona' ? film.persona.name : cast.name);
  let lastContact = room.length > 0 ? room[room.length - 1]!.at : null;
  let sent = false;

  for (const slot of pingSlots(play, cast, from, to)) {
    const before = items.filter((i) => i.at <= slot);
    const hook = before.filter((i) => i.kind === 'hook').at(-1) ?? before.filter((i) => i.kind === 'daily').at(-1) ?? null;
    const held = pingHeld({
      opens: film.opens.ping,
      clock: play,
      cast,
      slot,
      lastContact,
      hasHook: hook !== null,
      alreadySent: sent,
    });
    if (held !== null || hook === null) continue;

    // 보내기로 정해졌다. 이제야 모델이 문장을 쓴다
    const clockAt = { ...play, elapsed: slot };
    const call: ModelCall = {
      purpose: 'ping',
      layers: {
        system: SYSTEM_LAYER,
        cast: castLayer(film, cast),
        scene: sceneLayer({
          film,
          cast,
          clock: clockAt,
          events: [
            ...(await eventsFor(ctx, play, cast.key, slot)),
            ...before.filter((i) => i.kind === 'daily').map((i) => ({ at: i.at, text: i.text })),
          ],
          history: room.slice(-RULES.historyLines).map((m) => ({ speaker: nameOf(m.speaker), text: m.text })),
        }),
      },
      user: `(${when(clockAt, slot)}. ${film.persona.name}에게서 온 말은 없다. 네가 먼저 연락한다. 얘깃거리: ${hook.text})`,
      temperature: 0.8,
      maxTokens: 300,
    };

    let texts: string[];
    try {
      const out = await ask(ctx, call);
      texts = bubbles(out.text);
      stmts.push(logStmt(ctx, play.id, turnId, call, out, texts.length > 0, texts.length > 0 ? null : '빈 답'));
    } catch (e) {
      stmts.push(logStmt(ctx, play.id, turnId, call, null, false, `먼저 건 말을 못 받음: ${errText(e)}`));
      continue;
    }
    if (texts.length === 0) continue;

    for (const text of texts) {
      stmts.push(
        q(
          'INSERT INTO messages (id, play_id, turn_id, room, speaker, text, at, kind, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          newId(),
          play.id,
          turnId,
          cast.key,
          cast.key,
          text,
          // 돌아와서 보면 이미 와 있는 연락이다. 그때의 시각으로 찍는다
          slot,
          'ping',
          ctx.now(),
        ),
      );
    }
    sent = true;
    lastContact = slot;
  }
}
