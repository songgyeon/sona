/* 장면의 다음 대목을 받는 곳. 모델은 문장만 쓴다. 한 턴에 한 번 부른다.
   채팅은 하나다. 작가 한 사람(대사 모델)이 나오는 사람들을 모두 맡아 쓰고,
   누가 나오고 누가 말할지도 장면에 맞게 정한다. 유저의 인물만은 쓰지 못한다 — 그 사람의 말과 지문은 유저가 쓴다. */

import { trialOver } from '../../shared/clock';
import { hasLines } from '../../shared/opening';
import { RULES } from '../../shared/rules';
import type { Film, MessageView, TurnView } from '../../shared/types';
import { newId, q, type Stmt } from '../db';
import { spend } from '../guard';
import type { Layers, ModelCall, ModelOut, Purpose } from '../model/index';
import { castsLayer } from '../prompt/cast';
import { lineOf, type SceneEvent, type SceneLine, writerLayer } from '../prompt/scene';
import { SCENE_SYSTEM } from '../prompt/system';
import { type Ctx, Fail } from './ctx';
import { asNow } from './persona';
import { type Play, SCENE, sceneMessages } from './store';

/** 줄바꿈 하나가 메시지 하나다. 줄을 지우거나 고치지 않는다 — 빈 줄만 걷는다 */
export function bubbles(raw: string): string[] {
  return raw
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** 장면의 한 조각. 지문이거나, 캐스트 한 사람의 대사다 */
export interface Piece {
  /** 캐스트의 이름표. 지문이면 'tell' */
  speaker: string;
  text: string;
}

const OPEN = '"“「『';
const CLOSE = '"”」』';
/** 따옴표로 통째로 감싼 말이면 따옴표를 벗긴다. 아니면 그대로 */
const unquote = (t: string) => (t.length > 2 && OPEN.includes(t[0]!) && CLOSE.includes(t[t.length - 1]!) ? t.slice(1, -1).trim() : t);

/** 모델이 쓴 대목을 읽는다. 「이름: "대사"」 줄은 그 캐스트의 대사고, 나머지는 지문이다.
    글자를 지우거나 고치지 않는다 — 대사를 감싼 따옴표만 벗긴다. 이어지는 지문 줄은 한 덩이로 둔다.
    「장소 | 곳」 줄은 장면이 벌어지는 곳을 알리는 줄이다. 흐름에 놓지 않고 곳으로 읽는다(없으면 null).
    유저의 인물 이름으로 시작하는 대사 줄은 받지 않는다 — 그 사람의 말은 유저가 쓴다 */
export function parseScene(raw: string, film: Film): { pieces: Piece[]; personaSpoke: boolean; place: string | null } {
  const keyOf = new Map(film.casts.map((c) => [c.name, c.key]));
  /** 캐스트가 한 명뿐이면, 이름 없이 따옴표로만 감싼 줄도 그 사람의 말이다 */
  const only = film.casts.length === 1 ? film.casts[0]!.key : null;
  const pieces: Piece[] = [];
  let personaSpoke = false;
  let place: string | null = null;
  for (const line of bubbles(raw)) {
    const where = /^장소\s*[|:：]\s*(.+)$/.exec(line);
    if (where) {
      // 곳 이름으로 보기에 너무 길면 받지 않는다. 잘라 쓰지 않는다
      const name = where[1]!.trim();
      if (name.length <= RULES.limits.place) place = name;
      continue;
    }
    const m = /^([^:：]{1,24}?)\s*[:：]\s*(.+)$/.exec(line);
    // 이름표를 꾸민 기호(**이름**, [이름])는 떼고 견준다
    const who = m ? m[1]!.replace(/^[\s*\[(「『]+|[\s*\])」』]+$/g, '') : '';
    if (m && who === film.persona.name) {
      personaSpoke = true;
      continue;
    }
    const key = m ? keyOf.get(who) : undefined;
    if (m && key) {
      const text = unquote(m[2]!.trim());
      if (text.length > 0) pieces.push({ speaker: key, text });
      continue;
    }
    const bare = unquote(line);
    if (only && bare !== line && bare.length > 0) {
      pieces.push({ speaker: only, text: bare });
      continue;
    }
    const last = pieces[pieces.length - 1];
    if (last?.speaker === 'tell') last.text += `\n${line}`;
    else pieces.push({ speaker: 'tell', text: line });
  }
  return { pieces, personaSpoke, place };
}

/** 지나간 장면을 프롬프트에 적을 모양으로 바꾼다. 누가 한 말인지 이름으로 적힌다 */
export function toLines(play: Play, messages: MessageView[]): SceneLine[] {
  const nameOf = (key: string) => play.film.casts.find((c) => c.key === key)?.name ?? key;
  // 내 배역의 이름을 바꾸기 전에 오간 말에는 전의 이름이 남아 있다. 지금 이름으로 건넨다
  const now = asNow(play.film);
  return messages.map((m) => {
    if (m.speaker === 'tell') return { kind: 'tell', speaker: '', text: now(m.text), mine: false, at: m.at };
    const mine = m.speaker === 'persona';
    const kind = m.kind === 'ping' ? 'msg' : mine && m.kind === 'act' ? 'act' : 'say';
    return { kind, speaker: mine ? play.film.persona.name : nameOf(m.speaker), text: now(m.text), mine, at: m.at };
  });
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

/** 장면을 쓰는 작가에게 건넬 「누가 무엇을 아는가」. 모두 아는 일과, 몇 사람만 아는 일을 가른다.
    오프닝에서 있었던 일은 [이야기가 시작된 자리]에 통째로 실리니 여기서는 뺀다 */
export async function knownTo(ctx: Ctx, play: Play): Promise<{ shared: SceneEvent[]; only: { who: string[]; events: SceneEvent[] }[] }> {
  const film = play.film;
  const rows = await ctx.db.all<{ at: number; kind: string; actor: string; text: string; known_by: string }>(
    'SELECT at, kind, actor, text, known_by FROM events WHERE play_id = ? ORDER BY at, rowid',
    play.id,
  );
  const nameOf = (key: string) => film.casts.find((c) => c.key === key)?.name ?? key;
  const now = asNow(film);
  const shared: SceneEvent[] = [];
  const groups = new Map<string, { who: string[]; events: SceneEvent[] }>();
  for (const r of rows) {
    if (r.kind === 'scene') continue;
    const known = JSON.parse(r.known_by) as string[];
    const casts = film.casts.filter((c) => known.includes(c.key));
    if (casts.length === 0) continue;
    const text = r.kind === 'post' ? `${nameOf(r.actor)}의 피드에 올라온 글: 「${now(r.text)}」` : now(r.text);
    // 나오는 사람 모두와 유저의 인물까지 아는 일만 「모두 아는 일」이다
    if (casts.length === film.casts.length && known.includes('persona')) {
      shared.push({ at: r.at, text });
      continue;
    }
    const id = casts.map((c) => c.key).join('+');
    const group = groups.get(id) ?? { who: casts.map((c) => c.name), events: [] };
    group.events.push({ at: r.at, text });
    groups.set(id, group);
  }
  return { shared, only: [...groups.values()] };
}

const FIRST_CUE = '(이야기가 지금 시작된다. 이 장면을 연다.)';
/** 디렉터가 오프닝을 써 둔 필름: 그 뒤를 잇는다 */
const AFTER_OPENING_CUE = '(위에 적힌 시작 장면에 바로 이어서 다음 대목을 쓴다. 이미 적힌 것을 되풀이하지 않는다.)';

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
  const all = await sceneMessages(ctx.db, play);

  let purpose: Purpose;
  let user: string;
  let before = all;
  if (turn.kind === 'enter') {
    purpose = 'first';
    user = hasLines(film) ? AFTER_OPENING_CUE : FIRST_CUE;
  } else {
    // 이 턴에 유저가 쓴 것: 지문과 대사. 받은 그대로 건넨다
    const mine = all.filter((m) => m.turnId === turn.id && m.speaker === 'persona');
    if (mine.length === 0) throw new Fail(500, 'no_user_line', '답할 대사를 찾을 수 없어요.');
    purpose = 'reply';
    user = toLines(play, mine).map(lineOf).join('\n');
    before = all.filter((m) => m.turnId !== turn.id);
  }

  const layers: Layers = {
    system: SCENE_SYSTEM,
    cast: castsLayer(film),
    scene: writerLayer({
      film,
      clock: play,
      ...(await knownTo(ctx, play)),
      history: toLines(play, before.slice(-RULES.historyLines)),
      place: play.place,
    }),
  };
  const call: ModelCall = { purpose, layers, user, temperature: 0.8, maxTokens: 700 };

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

  const read = parseScene(out.text, film);
  if (read.pieces.length === 0) {
    await fail('empty', out, read.personaSpoke ? '유저의 인물이 말한 줄뿐이라 버림' : '빈 답');
    return;
  }

  const stmts: Stmt[] = read.pieces.map((piece) =>
    q(
      'INSERT INTO messages (id, play_id, turn_id, room, speaker, text, at, kind, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      newId(),
      play.id,
      turn.id,
      SCENE,
      // 지문에는 말한 사람이 없다
      piece.speaker,
      piece.text,
      play.elapsed,
      turn.kind === 'enter' ? 'first' : 'chat',
      ctx.now(),
    ),
  );
  // 장면이 벌어지는 곳. 작가가 적어 주었을 때만 바꾼다
  if (read.place !== null) stmts.push(q('UPDATE plays SET place = ? WHERE id = ?', read.place, play.id));
  stmts.push(q("UPDATE turns SET status = 'done', fail_reason = NULL WHERE id = ?", turn.id));
  stmts.push(logStmt(ctx, play.id, turn.id, call, out, true, read.personaSpoke ? '유저의 인물이 말한 줄은 받지 않음' : null));
  if (trialOver(play.elapsed, play.days)) stmts.push(q('UPDATE plays SET ended = 1 WHERE id = ?', play.id));
  await ctx.db.batch(stmts);
}
