/* 자리 비우기. 유저가 떠났다가 돌아오는 사이에 세계가 흐른다.
   시계는 접수할 때 간다. 그 사이의 일을 못 만들어도 시계는 돌아가지 않는다 —
   그 구간은 조용한 구간으로 남는다. */

import { dayEnd, nextEvening, nextWake, trialOver } from '../../shared/clock';
import { sceneOf } from '../../shared/opening';
import { RULES } from '../../shared/rules';
import type { Cast, MessageView, PlayView } from '../../shared/types';
import { isUniqueError, newId, q, type Stmt } from '../db';
import { isUuid } from '../guard';
import type { ModelCall, ModelOut } from '../model/index';
import { castLayer } from '../prompt/cast';
import { sceneLayer, when } from '../prompt/scene';
import { PING_SYSTEM } from '../prompt/system';
import { ASIDE_CUE, asideLayers, asideMemory, asideSlot, parseAside, pickPair } from './aside';
import { type Ctx, Fail } from './ctx';
import { GAP_CUE, type GapItem, gapLayers, parseGap, parsePresent, presentLayers, presentUser } from './gap';
import { pingHeld, pingSlots } from './ping';
import { lastTurn, loadPlay, messagesOf, type Play, sceneMessages, viewOf } from './store';
import { ask, bubbles, errText, eventsFor, logStmt, toLines } from './talk';

export type SkipKind = 'short' | 'errand' | 'evening' | 'sleep';

export async function skip(ctx: Ctx, playId: string, input: { kind: unknown; requestId: unknown }): Promise<PlayView> {
  if (!isUuid(input.requestId)) throw new Fail(400, 'bad_request_id', '요청이 올바르지 않아요.');
  const kind = input.kind;
  if (kind !== 'short' && kind !== 'errand' && kind !== 'evening' && kind !== 'sleep') {
    throw new Fail(400, 'bad_skip', '그렇게는 시간을 넘길 수 없어요.');
  }
  const play = await loadPlay(ctx, playId);

  const dup = await ctx.db.first<{ id: string }>(
    'SELECT id FROM turns WHERE play_id = ? AND request_id = ?',
    playId,
    input.requestId,
  );
  if (dup) return viewOf(ctx, playId);
  if (play.ended) throw new Fail(409, 'ended', '하루가 끝났어요. 다음 날로 이어 살 수 있어요.');
  const last = await lastTurn(ctx.db, playId);
  if (last && last.status !== 'done') {
    throw new Fail(409, 'stuck', '앞의 대사를 아직 받지 못했어요. 다시 받기를 눌러 주세요.');
  }

  const from = play.elapsed;
  const want =
    kind === 'short'
      ? from + RULES.skip.short
      : kind === 'errand'
        ? from + RULES.skip.errand
        : kind === 'evening'
          ? nextEvening(play)
          : nextWake(play);
  // 열어 둔 날의 끝을 넘겨서 건너뛰지 않는다
  const to = Math.min(want, dayEnd(play.days));
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
  if (trialOver(to, play.days)) stmts.push(q('UPDATE plays SET ended = 1 WHERE id = ?', play.id));
  await ctx.db.batch(stmts);
}

async function between(ctx: Ctx, play: Play, turnId: string, from: number, to: number, stmts: Stmt[]): Promise<void> {
  await alone(ctx, play, turnId, from, to, stmts);
  await meanwhile(ctx, play, turnId, from, to, stmts);
}

/** 캐스트마다 혼자 보낸 시간: 일상, 피드, 먼저 건 연락 */
async function alone(ctx: Ctx, play: Play, turnId: string, from: number, to: number, stmts: Stmt[]): Promise<void> {
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

/** 한편: 유저가 없는 사이에 서로 아는 두 사람이 만난다. 한 번 비운 동안 한 장면까지.
    누가 언제 만나는지는 코드가 정하고, 모델은 장면만 쓴다 */
async function meanwhile(ctx: Ctx, play: Play, turnId: string, from: number, to: number, stmts: Stmt[]): Promise<void> {
  const film = play.film;
  if (!film.opens.aside || to - from < RULES.aside.minSpanMin) return;

  const had = await ctx.db.all<{ cast_a: string; cast_b: string; n: number }>(
    'SELECT cast_a, cast_b, COUNT(*) AS n FROM asides WHERE play_id = ? GROUP BY cast_a, cast_b',
    play.id,
  );
  const pair = pickPair(film, new Map(had.map((r) => [`${r.cast_a}+${r.cast_b}`, r.n])));
  if (!pair) return;
  const [a, b] = pair;
  const at = asideSlot(play, a, b, from, to);
  if (at === null) return;

  // 아는 것의 주인을 가른다: 둘 다 아는 일과 한 사람만 아는 일. 피드의 글은 누가 읽어도 같은 말로 적는다
  const rows = await ctx.db.all<{ at: number; kind: string; actor: string; text: string; known_by: string }>(
    'SELECT at, kind, actor, text, known_by FROM events WHERE play_id = ? AND at <= ? ORDER BY at, rowid',
    play.id,
    at,
  );
  const nameOf = (key: string) => film.casts.find((c) => c.key === key)?.name ?? key;
  const knows = (r: { known_by: string }, who: Cast) => (JSON.parse(r.known_by) as string[]).includes(who.key);
  const told = (r: { at: number; kind: string; actor: string; text: string }) => ({
    at: r.at,
    text: r.kind === 'post' ? `${nameOf(r.actor)}의 피드에 올라온 글: 「${r.text}」` : r.text,
  });
  const said = (lines: MessageView[]) =>
    lines
      .filter((m) => m.speaker !== 'tell' && m.at <= at)
      .slice(-6)
      .map((m) => ({ speaker: m.speaker === 'persona' ? film.persona.name : nameOf(m.speaker), text: m.text }));
  const talked = async (who: Cast) => said(await messagesOf(ctx.db, play.id, who.key));
  // 두 사람이 유저의 인물과 한자리에 있던 사이라면, 그 자리에서 오간 말은 둘 다 들었다
  const sameScene = sceneOf(film, a.key).includes(b.key);
  const call: ModelCall = {
    purpose: 'aside',
    layers: asideLayers(film, a, b, play, at, {
      shared: rows.filter((r) => knows(r, a) && knows(r, b)).map(told),
      only: [rows.filter((r) => knows(r, a) && !knows(r, b)).map(told), rows.filter((r) => knows(r, b) && !knows(r, a)).map(told)],
      recent: sameScene ? [[], []] : [await talked(a), await talked(b)],
      together: sameScene ? said(await sceneMessages(ctx.db, play, a.key)) : null,
    }),
    user: ASIDE_CUE,
    temperature: 0.8,
    maxTokens: 700,
  };

  let out: ModelOut;
  try {
    out = await ask(ctx, call);
  } catch (e) {
    stmts.push(logStmt(ctx, play.id, turnId, call, null, false, `한편을 못 받음: ${errText(e)}`));
    return;
  }

  const read = parseAside(out.text, film, a, b);
  const says = read.pieces.filter((p) => p.speaker !== 'tell');
  let dropped: string | null = null;
  if (read.personaSpoke) dropped = '유저의 인물이 말해서 장면을 버림';
  else if (says.length < RULES.aside.minSays) dropped = '대사가 모자라서 장면을 버림';
  else if (read.pieces.some((p) => p.text.includes(film.persona.name))) {
    // 유저의 이름이 나온다. 얘기만 하는 것인지, 그 자리에 있는 것인지 묻는다
    const check: ModelCall = {
      purpose: 'check',
      layers: presentLayers(),
      user: presentUser(`${a.name}, ${b.name}`, film.persona.name, read.pieces.map((p) => p.text).join('\n')),
      temperature: 0,
      maxTokens: 20,
    };
    let present: boolean | null = null;
    try {
      const judged = await ask(ctx, check);
      present = parsePresent(judged.text);
      stmts.push(logStmt(ctx, play.id, turnId, check, judged, present !== null, present === true ? '유저가 그 자리에 있어서 장면을 버림' : null));
    } catch (e) {
      stmts.push(logStmt(ctx, play.id, turnId, check, null, false, `확인 호출 실패: ${errText(e)}`));
    }
    // 못 읽었으면 버린다 — 유저를 대신 움직이는 쪽으로는 틀리지 않는다
    if (present !== false) dropped = '유저가 그 자리에 있어서 장면을 버림';
  }
  stmts.push(logStmt(ctx, play.id, turnId, call, out, dropped === null, dropped));
  if (dropped) return;

  const id = newId();
  stmts.push(
    q(
      'INSERT INTO asides (id, play_id, turn_id, at, place, cast_a, cast_b, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      id,
      play.id,
      turnId,
      at,
      read.place,
      a.key,
      b.key,
      ctx.now(),
    ),
  );
  for (const piece of read.pieces) {
    stmts.push(
      q(
        'INSERT INTO messages (id, play_id, turn_id, room, speaker, text, at, kind, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        newId(),
        play.id,
        turnId,
        // 이 장면만의 자리다. 누구와의 방에도 섞이지 않는다
        id,
        piece.speaker,
        piece.text,
        at,
        'aside',
        ctx.now(),
      ),
    );
  }
  // 그 일은 두 사람만 안다. 유저가 장면을 읽어도 유저의 인물은 모른다
  stmts.push(eventStmt(ctx, play.id, turnId, at, 'aside', a.key, asideMemory(film, a, b, read), [a.key, b.key]));
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
  // 한자리에 여럿이 있었으면 그 자리에서 오간 말이다
  const room = await sceneMessages(ctx.db, play, cast.key);
  const nameOf = (speaker: string) => (speaker === 'persona' ? film.persona.name : (film.casts.find((c) => c.key === speaker)?.name ?? speaker));
  const call: ModelCall = {
    purpose: 'gap',
    layers: gapLayers(
      film,
      cast,
      play,
      from,
      to,
      await eventsFor(ctx, play, cast.key, from),
      room
        .filter((m) => m.speaker !== 'tell')
        .slice(-6)
        .map((m) => ({ speaker: nameOf(m.speaker), text: m.text })),
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
  const room = await sceneMessages(ctx.db, play, cast.key);
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
      until: dayEnd(play.days),
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
        system: PING_SYSTEM,
        cast: castLayer(film, cast),
        scene: sceneLayer({
          film,
          cast,
          clock: clockAt,
          events: [
            ...(await eventsFor(ctx, play, cast.key, slot)),
            ...before.filter((i) => i.kind === 'daily').map((i) => ({ at: i.at, text: i.text })),
          ],
          history: toLines(play, room.slice(-RULES.historyLines)),
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
