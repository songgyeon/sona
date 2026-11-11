/* 인물의 답을 받는 곳. 모델은 문장만 쓴다. 한 턴에 한 번 부른다. */

import { trialOver } from '../../shared/clock';
import { hasLines, sceneOf } from '../../shared/opening';
import { RULES } from '../../shared/rules';
import type { Cast, Film, MessageView, TurnView } from '../../shared/types';
import { newId, q, type Stmt } from '../db';
import { spend } from '../guard';
import type { Layers, ModelCall, ModelOut, Purpose } from '../model/index';
import { castLayer } from '../prompt/cast';
import { sceneLayer, type SceneEvent, type SceneLine } from '../prompt/scene';
import { SCENE_SYSTEM } from '../prompt/system';
import { type Ctx, Fail } from './ctx';
import { asNow } from './persona';
import { type Play, sceneMessages } from './store';

/** 줄바꿈 하나가 메시지 하나다. 줄을 지우거나 고치지 않는다 — 빈 줄만 걷는다 */
export function bubbles(raw: string): string[] {
  return raw
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export interface Piece {
  kind: 'tell' | 'say';
  text: string;
}

const OPEN = '"“「『';
const CLOSE = '"”」』';

/** 모델이 쓴 대목을 지문과 대사로 가른다. 줄 전체가 따옴표로 감싸인 줄이 대사고, 나머지는 지문이다.
    글자를 지우거나 고치지 않는다 — 대사 줄을 감싼 따옴표만 벗긴다. 이어지는 지문 줄은 한 덩이로 둔다. */
export function pieces(raw: string): Piece[] {
  const out: Piece[] = [];
  for (const line of bubbles(raw)) {
    const quoted = line.length > 2 && OPEN.includes(line[0]!) && CLOSE.includes(line[line.length - 1]!);
    const inner = quoted ? line.slice(1, -1).trim() : '';
    if (quoted && inner.length > 0) {
      out.push({ kind: 'say', text: inner });
      continue;
    }
    const last = out[out.length - 1];
    if (last?.kind === 'tell') last.text += `\n${line}`;
    else out.push({ kind: 'tell', text: line });
  }
  return out;
}

/** 지나간 장면을 프롬프트에 적을 모양으로 바꾼다. 한자리에 여럿이 있었으면 누가 한 말인지 이름으로 적힌다 */
export function toLines(play: Play, messages: MessageView[]): SceneLine[] {
  const nameOf = (key: string) => play.film.casts.find((c) => c.key === key)?.name ?? key;
  // 내 배역의 이름을 바꾸기 전에 오간 말에는 전의 이름이 남아 있다. 캐스트에게는 지금 이름으로 건넨다
  const now = asNow(play.film);
  return messages.map((m) => {
    if (m.speaker === 'tell') return { kind: 'tell', speaker: '', text: now(m.text), mine: false, at: m.at };
    const mine = m.speaker === 'persona';
    return { kind: m.kind === 'ping' ? 'msg' : 'say', speaker: mine ? play.film.persona.name : nameOf(m.speaker), text: now(m.text), mine, at: m.at };
  });
}

/** 이 캐스트와 한자리에 있는 다른 캐스트들 */
export const othersHere = (film: Film, cast: Cast): Cast[] =>
  sceneOf(film, cast.key)
    .filter((key) => key !== cast.key)
    .flatMap((key) => film.casts.filter((c) => c.key === key));

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
export async function eventsFor(ctx: Ctx, play: Play, castKey: string, upTo = Infinity, withScene = true): Promise<SceneEvent[]> {
  const rows = await ctx.db.all<{ at: number; kind: string; actor: string; text: string; known_by: string }>(
    'SELECT at, kind, actor, text, known_by FROM events WHERE play_id = ? ORDER BY at, rowid',
    play.id,
  );
  const nameOf = (key: string) => play.film.casts.find((c) => c.key === key)?.name ?? key;
  const now = asNow(play.film);
  return rows
    .filter((r) => withScene || r.kind !== 'scene')
    .filter((r) => r.at <= upTo && (JSON.parse(r.known_by) as string[]).includes(castKey))
    .map((r) => {
      if (r.kind !== 'post') return { at: r.at, text: now(r.text) };
      return {
        at: r.at,
        text: r.actor === castKey ? `피드에 올렸다: 「${now(r.text)}」` : `${nameOf(r.actor)}의 피드에서 봤다: 「${now(r.text)}」`,
      };
    });
}

const FIRST_CUE = '(이야기가 지금 시작된다. 이 장면을 네가 연다.)';
/** 디렉터가 오프닝을 써 둔 필름: 그 뒤를 잇는다 */
const AFTER_OPENING_CUE = '(위에 적힌 시작 장면에 바로 이어서, 네가 먼저 움직이고 말한다. 이미 적힌 것을 되풀이하지 않는다.)';

/** 한자리에 있는 다른 사람의 차례. 낄 까닭이 없으면 넘긴다 */
const JOIN_CUE =
  '(위의 장면을 너도 그 자리에서 보고 들었다. 네가 할 말이나 행동이 있으면 이어서 쓴다. 이미 나온 말을 되풀이하지 않는다. 지금 끼어들 까닭이 없으면 「…」 한 줄만 쓴다.)';
/** 넘긴다는 표시. 이 글자뿐이면 아무 말도 하지 않은 것이다 */
const PASS = ['…', '...', '「…」', '「...」', '"…"', '"..."', '(…)', '(...)'];

/** 한자리에 있는 다른 캐스트가 이번에 낄 차례인가. 모델이 아니라 코드가 정한다 —
    방금 오간 말에 그 사람이 불렸거나, 내 말이 잇달아 이어지는 동안 한마디도 못 했으면 낀다 */
export function takesTurn(film: Film, cast: Cast, scene: MessageView[], heard: string[]): boolean {
  // 한 글자짜리 이름은 다른 낱말 속에도 흔해서 불렸다고 보지 않는다
  const names = [cast.name, ...cast.aliases, ...film.ties.filter((t) => t.to === cast.key).map((t) => t.calls)].filter((n) => n.length >= 2);
  if (heard.some((text) => names.some((n) => text.includes(n)))) return true;
  let quiet = 0;
  for (let i = scene.length - 1; i >= 0; i--) {
    const m = scene[i]!;
    // 이 사람이 마지막으로 말하거나 움직인 데까지만 센다
    if (m.speaker === cast.key || (m.speaker === 'tell' && m.room === cast.key)) break;
    if (m.speaker === 'persona') quiet += 1;
  }
  return quiet >= RULES.scene.quietTurns;
}

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
  if (!cast) throw new Fail(500, 'room_missing', '이 장면의 인물을 찾을 수 없어요.');

  // 한자리에 여럿이 있으면 그 자리에서 오간 말을 모두 듣는다
  const all = await sceneMessages(ctx.db, play, cast.key);

  let purpose: Purpose;
  let user: string;
  let before = all;
  if (turn.kind === 'enter') {
    purpose = 'first';
    user = hasLines(film) ? AFTER_OPENING_CUE : FIRST_CUE;
  } else {
    const last = all[all.length - 1];
    if (!last || last.speaker !== 'persona') throw new Fail(500, 'no_user_line', '답할 대사를 찾을 수 없어요.');
    purpose = 'reply';
    user = last.text;
    before = all.slice(0, -1);
  }

  const layers: Layers = {
    system: SCENE_SYSTEM,
    cast: castLayer(film, cast),
    scene: sceneLayer({
      film,
      cast,
      clock: play,
      // 첫 장면은 [이야기가 시작된 자리]에 통째로 실린다. 같은 일을 두 번 싣지 않는다
      events: await eventsFor(ctx, play, cast.key, Infinity, false),
      history: toLines(play, before.slice(-RULES.historyLines)),
      here: othersHere(film, cast).map((c) => c.name),
    }),
  };
  const call: ModelCall = { purpose, layers, user, temperature: 0.8, maxTokens: 600 };

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

  const parts = pieces(out.text);
  if (parts.length === 0) {
    await fail('empty', out, '빈 답');
    return;
  }

  const stmts: Stmt[] = parts.map((part) =>
    q(
      'INSERT INTO messages (id, play_id, turn_id, room, speaker, text, at, kind, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      newId(),
      play.id,
      turn.id,
      cast.key,
      // 지문에는 말한 사람이 없다
      part.kind === 'tell' ? 'tell' : cast.key,
      part.text,
      play.elapsed,
      turn.kind === 'enter' ? 'first' : 'chat',
      ctx.now(),
    ),
  );
  stmts.push(q("UPDATE turns SET status = 'done', fail_reason = NULL WHERE id = ?", turn.id));
  stmts.push(logStmt(ctx, play.id, turn.id, call, out, true, null));
  if (trialOver(play.elapsed, play.days)) stmts.push(q('UPDATE plays SET ended = 1 WHERE id = ?', play.id));
  await ctx.db.batch(stmts);

  // 내 말에 한 사람이 답했다. 같이 있는 다른 사람에게도 차례가 간다
  if (turn.kind === 'say') await joinIn(ctx, play, turn, cast, [user, ...parts.map((p) => p.text)]);
}

/** 한자리에 있는 다른 캐스트의 차례. 낄지 말지는 코드가 정하고, 끼면 그 사람이 제 말로 쓴다.
    못 받아도 턴은 이미 끝났다 — 그 사람이 이번에 아무 말도 안 한 것으로 남는다 */
async function joinIn(ctx: Ctx, play: Play, turn: TurnView, spoke: Cast, heard: string[]): Promise<void> {
  const film = play.film;
  for (const cast of othersHere(film, spoke)) {
    // 방금 답까지 들어 있다. 앞사람이 낀 말도 뒷사람은 듣는다
    const scene = await sceneMessages(ctx.db, play, cast.key);
    if (!takesTurn(film, cast, scene, heard)) continue;

    const call: ModelCall = {
      purpose: 'join',
      layers: {
        system: SCENE_SYSTEM,
        cast: castLayer(film, cast),
        scene: sceneLayer({
          film,
          cast,
          clock: play,
          events: await eventsFor(ctx, play, cast.key, Infinity, false),
          history: toLines(play, scene.slice(-RULES.historyLines)),
          here: othersHere(film, cast).map((c) => c.name),
        }),
      },
      user: JOIN_CUE,
      temperature: 0.8,
      maxTokens: 400,
    };
    let out: ModelOut;
    try {
      out = await ask(ctx, call);
    } catch (e) {
      await ctx.db.batch([logStmt(ctx, play.id, turn.id, call, null, false, `끼는 말을 못 받음: ${errText(e)}`)]);
      continue;
    }
    const parts = PASS.includes(out.text.trim()) ? [] : pieces(out.text);
    const stmts: Stmt[] = parts.map((part) =>
      q(
        'INSERT INTO messages (id, play_id, turn_id, room, speaker, text, at, kind, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        newId(),
        play.id,
        turn.id,
        cast.key,
        part.kind === 'tell' ? 'tell' : cast.key,
        part.text,
        play.elapsed,
        'chat',
        ctx.now(),
      ),
    );
    stmts.push(logStmt(ctx, play.id, turn.id, call, out, parts.length > 0, parts.length > 0 ? null : '끼지 않고 넘김'));
    await ctx.db.batch(stmts);
    heard = [...heard, ...parts.map((p) => p.text)];
  }
}
