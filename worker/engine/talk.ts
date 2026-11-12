/* 장면의 다음 대목을 받는 곳. 모델은 문장만 쓴다. 한 턴에 한 번 부른다.
   채팅은 하나다. 작가 한 사람(대사 모델)이 나오는 사람들을 모두 맡아 쓰고,
   누가 나오고 누가 말할지도 장면에 맞게 정한다. 유저의 인물만은 쓰지 못한다 — 그 사람의 말과 지문은 유저가 쓴다. */

import { trialOver } from '../../shared/clock';
import { josa } from '../../shared/ko';
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
import { overused } from './echo';
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
    「모습 | …」 줄은 대목이 끝났을 때 사람들이 어디에 어떻게 있는지 적은 줄이다. 이것도 흐름에 놓지 않는다(없으면 null).
    유저의 인물 이름으로 시작하는 대사 줄은 받지 않는다 — 그 사람의 말은 유저가 쓴다 */
export function parseScene(raw: string, film: Film): { pieces: Piece[]; personaSpoke: boolean; place: string | null; pose: string | null } {
  const keyOf = new Map(film.casts.map((c) => [c.name, c.key]));
  /** 캐스트가 한 명뿐이면, 이름 없이 따옴표로만 감싼 줄도 그 사람의 말이다 */
  const only = film.casts.length === 1 ? film.casts[0]!.key : null;
  const pieces: Piece[] = [];
  let personaSpoke = false;
  let place: string | null = null;
  let pose: string | null = null;
  for (const line of bubbles(raw)) {
    const where = /^장소\s*[|:：]\s*(.+)$/.exec(line);
    if (where) {
      // 곳 이름으로 보기에 너무 길면 받지 않는다. 잘라 쓰지 않는다
      const name = where[1]!.trim();
      if (name.length <= RULES.limits.place) place = name;
      continue;
    }
    const how = /^[\s*\[(]*모습[\s*\])]*\s*[|:：]\s*(.+)$/.exec(line);
    if (how) {
      // 너무 길면 받지 않는다. 잘라 쓰지 않는다
      const text = how[1]!.trim();
      if (text.length <= RULES.limits.pose) pose = text;
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
  return { pieces, personaSpoke, place, pose };
}

/** 프롬프트에 실을 지나간 장면을 고른다. 뒤에서부터 정해진 글자 수가 찰 때까지 */
export function recent(messages: MessageView[]): MessageView[] {
  let chars = 0;
  let from = messages.length;
  while (from > 0) {
    // 줄마다 이름표와 줄바꿈이 붙는다
    const next = messages[from - 1]!.text.length + 8;
    if (chars + next > RULES.history.chars) break;
    chars += next;
    from -= 1;
  }
  return messages.slice(from);
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

/** 바로 앞 대목들의 모양. 대목마다 지문과 대사가 놓인 차례를 적는다 — 「지문 → 대사」.
    작가는 같은 모양을 되풀이하기 쉽다. 말로만 일러서는 안 고쳐져서, 앞에서 쓴 모양을 그때그때 알려 준다 */
export function lastShapes(messages: MessageView[], count = 2): string[] {
  const shapes: string[][] = [];
  let turn = '';
  for (const m of messages) {
    // 작가가 쓴 대목만 본다. 유저의 말과 폰으로 온 메시지는 치지 않는다
    if (m.speaker === 'persona' || m.kind === 'ping') continue;
    if (m.turnId !== turn) {
      shapes.push([]);
      turn = m.turnId;
    }
    const part = m.speaker === 'tell' ? '지문' : '대사';
    const now = shapes[shapes.length - 1]!;
    // 잇달아 나온 대사는 한 덩이로 친다
    if (now[now.length - 1] !== part) now.push(part);
  }
  return shapes.slice(-count).map((s) => s.join(' → '));
}

/** 대목을 짜는 차례. 여섯 가지다. 네 덩이 아니면 다섯 덩이 — 세 덩이짜리를 두었더니 답이 60자 안팎으로 짧아졌다.
    대사 자리에 누가 말할지, 몇 사람이 말할지는 적지 않는다 */
const RHYTHMS = [
  ['지문', '대사', '지문', '대사'],
  ['대사', '지문', '대사', '지문'],
  ['지문', '대사', '대사', '지문'],
  ['대사', '지문', '대사', '대사'],
  ['지문', '대사', '지문', '대사', '지문'],
  ['대사', '지문', '대사', '지문', '대사'],
] as const;

/** 이번 대목을 어떤 차례로 짤지 고른다. 바로 앞 대목과 열고 닫는 것이 같은 차례는 고르지 않는다.
    「다르게 써라」, 「네 줄에서 여섯 줄」 같은 말만으로는 모델이 한 가지 모양으로 굳고 늘 가장 짧게 쓴다.
    그래서 그때그때 하나를 짚어 준다. 고르는 것은 지문과 대사가 놓이는 차례뿐이다 —
    누가 나오고 무엇을 말할지는 모델이 정한다.
    같은 턴이면 늘 같은 것을 고른다. 다시 받아도 바뀌지 않는다 */
export function rhythmFor(messages: MessageView[], seed: string): string {
  const last = (lastShapes(messages, 1)[0] ?? '').split(' → ').filter(Boolean);
  const pool = RHYTHMS.filter((r) => last.length === 0 || r[0] !== last[0] || r[r.length - 1] !== last[last.length - 1]);
  let n = 0;
  for (const ch of seed) n = (n * 31 + ch.charCodeAt(0)) >>> 0;
  return pool[n % pool.length]!.join(' → ');
}

/** 이번 대목의 모양을 이르는 말. 유저가 쓴 것 바로 뒤에 붙인다 */
export const shapeCue = (messages: MessageView[], seed: string): string =>
  `(이번 대목은 대략 이 차례로 쓴다: ${rhythmFor(messages, seed)}. 지문 한 덩이는 한두 문장이다.)`;

/** 유저가 지문을 썼을 때 붙이는 말. 그 지문에서 자리를 옮겼으면 곳도 따라 옮겨 적게 한다.
    자리를 옮겼는지는 코드가 가리지 않는다 — 읽고 가리는 것은 작가다 */
export const placeCue = (film: Film): string => `(위 지문에서 ${josa(film.persona.name, '이', '가')} 자리를 옮겼으면 첫 줄의 곳을 옮겨 간 곳으로 적는다.)`;

/** 요즘 대목들에 자주 나온 말을 알려 준다. 지문과 대사를 따로 센다.
    같은 말이 돌기 시작하면 모델은 스스로 못 빠져나온다 — 앞에 쓴 것을 보고 또 쓴다.
    대목을 고치지는 않는다. 세어서 알려 줄 뿐이다. 자주 나온 말이 없으면 빈 글자 */
export function echoCue(messages: MessageView[], film: Film): string {
  // 작가가 쓴 것만 본다. 유저의 말과 폰으로 온 메시지는 치지 않는다
  const written = messages.filter((m) => m.speaker !== 'persona' && m.kind !== 'ping');
  // 이름과 부르는 말은 자주 나오는 것이 당연하다
  const names = [film.persona.name, ...film.casts.flatMap((c) => [c.name, c.callsUser]), ...film.ties.map((t) => t.calls)].filter(Boolean);
  const found = (tell: boolean) =>
    overused(
      written
        .filter((m) => (m.speaker === 'tell') === tell)
        .slice(-RULES.echo.window)
        .map((m) => m.text),
      names,
    );
  const list = (label: string, words: string[]) => (words.length > 0 ? `${label}에 자주 나온 말: ${words.map((w) => `「${w}」`).join(', ')}.` : '');
  const told = [list('요즘 지문', found(true)), list('요즘 대사', found(false))].filter(Boolean);
  if (told.length === 0) return '';
  return `(${told.join(' ')} 버릇처럼 붙는 말과 되풀이되는 몸짓이면 이번에는 쓰지 않는다. 이야기에 꼭 있어야 하는 말은 그대로 쓴다.)`;
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
    before = all.filter((m) => m.turnId !== turn.id);
    const moved = mine.some((m) => m.kind === 'act') ? placeCue(film) : '';
    user = [toLines(play, mine).map(lineOf).join('\n'), shapeCue(before, turn.id), moved, echoCue(before, film)].filter(Boolean).join('\n');
  }

  const layers: Layers = {
    system: SCENE_SYSTEM,
    cast: castsLayer(film),
    scene: writerLayer({
      film,
      clock: play,
      ...(await knownTo(ctx, play)),
      history: toLines(play, recent(before)),
      place: play.place,
      pose: play.pose,
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
  // 대목이 끝났을 때의 모습. 작가가 적지 않았으면 비운다 — 묵은 모습을 다음 대목에 건네면 틀린 자세를 잇게 된다
  stmts.push(q('UPDATE plays SET pose = ? WHERE id = ?', read.pose ?? '', play.id));
  stmts.push(q("UPDATE turns SET status = 'done', fail_reason = NULL WHERE id = ?", turn.id));
  stmts.push(logStmt(ctx, play.id, turn.id, call, out, true, read.personaSpoke ? '유저의 인물이 말한 줄은 받지 않음' : null));
  if (trialOver(play.elapsed, play.days)) stmts.push(q('UPDATE plays SET ended = 1 WHERE id = ?', play.id));
  await ctx.db.batch(stmts);
}
