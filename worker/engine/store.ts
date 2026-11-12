/* 플레이를 읽는 곳. 화면에 내보내는 모양도 여기서 만든다. */

import type { Clock } from '../../shared/clock';
import { readFilm } from '../../shared/opening';
import type { AsideView, Film, MessageView, PlayCard, PlayView, PostData, PostView, TurnView } from '../../shared/types';
import { type Db, q } from '../db';
import { type Ctx, Fail } from './ctx';
import { forScreen } from './films';
import { relabel } from './speakers';

export interface Play extends Clock {
  id: string;
  filmId: string;
  owner: string;
  film: Film;
  ended: boolean;
  /** 지금까지 열어 둔 날 수 */
  days: number;
  /** 지금 장면이 벌어지는 곳. 모르면 빈 글자 */
  place: string;
  /** 바로 앞 대목이 끝났을 때 사람들의 모습 — 누가 어디에 어떤 자세로 있고 무엇을 들었나. 모르면 빈 글자.
      다음 대목을 쓰는 작가에게만 건넨다. 화면에는 보내지 않는다 */
  pose: string;
  /** 이야기 전에 올려 둔 피드 글을 적었나 */
  past: boolean;
}

interface PlayRow {
  id: string;
  film_id: string;
  owner: string;
  film: string;
  start_dow: number;
  start_min: number;
  elapsed: number;
  ended: number;
  days: number | null;
  place: string | null;
  pose: string | null;
  past: number | null;
}

function toPlay(r: PlayRow): Play {
  return {
    id: r.id,
    filmId: r.film_id,
    owner: r.owner,
    film: readFilm(JSON.parse(r.film) as Film),
    startDow: r.start_dow,
    startMin: r.start_min,
    elapsed: r.elapsed,
    ended: r.ended === 1,
    days: r.days ?? 1,
    place: r.place ?? '',
    pose: r.pose ?? '',
    past: r.past === 1,
  };
}

/** 내 플레이만 읽힌다 */
export async function loadPlay(ctx: Ctx, id: string): Promise<Play> {
  const row = await ctx.db.first<PlayRow>('SELECT * FROM plays WHERE id = ? AND owner = ?', id, ctx.visitor);
  if (!row) throw new Fail(404, 'play_missing', '살고 있던 필름을 찾을 수 없어요.');
  return toPlay(row);
}

interface TurnRow {
  id: string;
  turn_no: number;
  kind: TurnView['kind'];
  room: string | null;
  status: TurnView['status'];
  fail_reason: string | null;
}

const toTurn = (r: TurnRow): TurnView => ({
  id: r.id,
  no: r.turn_no,
  kind: r.kind,
  room: r.room,
  status: r.status,
  failReason: r.fail_reason,
});

export async function lastTurn(db: Db, playId: string): Promise<TurnView | null> {
  const r = await db.first<TurnRow>(
    'SELECT id, turn_no, kind, room, status, fail_reason FROM turns WHERE play_id = ? ORDER BY turn_no DESC LIMIT 1',
    playId,
  );
  return r ? toTurn(r) : null;
}

interface MessageRow {
  id: string;
  room: string;
  speaker: string;
  text: string;
  at: number;
  kind: MessageView['kind'];
  turn_id: string;
}

const toMessage = (r: MessageRow): MessageView => ({
  id: r.id,
  room: r.room,
  speaker: r.speaker,
  text: r.text,
  at: r.at,
  kind: r.kind,
  turnId: r.turn_id,
});

/** 작중 시각 순. 같은 시각이면 들어온 순 */
export async function messagesOf(db: Db, playId: string, room?: string): Promise<MessageView[]> {
  const rows = room
    ? await db.all<MessageRow>(
        'SELECT id, room, speaker, text, at, kind, turn_id FROM messages WHERE play_id = ? AND room = ? ORDER BY at, rowid',
        playId,
        room,
      )
    : await db.all<MessageRow>(
        'SELECT id, room, speaker, text, at, kind, turn_id FROM messages WHERE play_id = ? ORDER BY at, rowid',
        playId,
      );
  return rows.map(toMessage);
}

/** 채팅은 하나다. 새로 적는 말은 이 이름표의 방에 적는다.
    캐스트마다 방이 따로이던 때의 말(room이 캐스트의 이름표)도 읽을 때는 한 흐름으로 모은다 */
export const SCENE = 'scene';

/** 본편에서 오간 말들 — 유저의 말과 지문, 캐스트의 말, 지문, 폰으로 온 메시지. 작중 시각 순, 같은 시각이면 들어온 순.
    한편(유저가 없는 자리의 장면)의 줄은 들지 않는다 */
export async function sceneMessages(db: Db, play: Play): Promise<MessageView[]> {
  return relabel((await messagesOf(db, play.id)).filter((m) => m.kind !== 'aside'), play.film);
}

/** 피드 글의 속. 한 줄 글이거나 못 읽으면 한 줄 글로 둔다 */
function dataOf(kind: string, data: string): PostData {
  if (kind === 'text' || !data) return { kind: 'text' };
  try {
    return JSON.parse(data) as PostData;
  } catch {
    return { kind: 'text' };
  }
}

export async function postsOf(db: Db, playId: string): Promise<PostView[]> {
  const rows = await db.all<{ id: string; cast_key: string; text: string; at: number; kind: string; data: string }>(
    'SELECT id, cast_key, text, at, kind, data FROM posts WHERE play_id = ? ORDER BY at, rowid',
    playId,
  );
  return rows.map((r) => ({ id: r.id, cast: r.cast_key, text: r.text, at: r.at, data: dataOf(r.kind, r.data) }));
}

export async function asidesOf(db: Db, playId: string): Promise<AsideView[]> {
  const rows = await db.all<{ id: string; at: number; place: string; cast_a: string; cast_b: string }>(
    'SELECT id, at, place, cast_a, cast_b FROM asides WHERE play_id = ? ORDER BY at, rowid',
    playId,
  );
  return rows.map((r) => ({ id: r.id, at: r.at, place: r.place, casts: [r.cast_a, r.cast_b] }));
}

export async function viewOf(ctx: Ctx, playId: string): Promise<PlayView> {
  const play = await loadPlay(ctx, playId);
  const [messages, posts, asides, last, maker] = await Promise.all([
    messagesOf(ctx.db, playId),
    postsOf(ctx.db, playId),
    asidesOf(ctx.db, playId),
    lastTurn(ctx.db, playId),
    ctx.db.first<{ owner: string }>('SELECT owner FROM films WHERE id = ?', play.filmId),
  ]);
  return {
    id: play.id,
    filmId: play.filmId,
    // 재생하는 화면은 디렉터만 보는 칸을 들고 다니지 않는다
    film: forScreen(play.film),
    elapsed: play.elapsed,
    ended: play.ended,
    day: play.days,
    place: play.place,
    mine: maker?.owner === ctx.visitor,
    // 예전 대목에서 지문에 섞여 들어간 대사는 대사로 세워 보인다
    messages: relabel(messages, play.film),
    posts,
    asides,
    stuck: last && last.status !== 'done' ? last : null,
  };
}

/** 내 삶 목록. 한 번에 읽는다 — 삶이 들고 있는 필름은 통째로 꺼내지 않고 목록에 보일 칸만 꺼낸다.
    예전에는 삶마다 마지막 말을 따로 물어서, 삶이 많으면 목록 하나에 1초를 넘겼다 */
export async function listPlays(ctx: Ctx): Promise<PlayCard[]> {
  const rows = await ctx.db.all<{
    id: string;
    film_id: string;
    elapsed: number;
    start_dow: number;
    start_min: number;
    ended: number;
    title: string | null;
    logline: string | null;
    poster: string | null;
    casts: string | null;
    said: string | null;
    last: string | null;
    live: number;
  }>(
    `SELECT p.id, p.film_id, p.elapsed, p.start_dow, p.start_min, p.ended,
       json_extract(p.film, '$.title') AS title,
       json_extract(p.film, '$.logline') AS logline,
       json_extract(p.film, '$.poster') AS poster,
       (SELECT json_group_array(json_extract(c.value, '$.name')) FROM json_each(p.film, '$.casts') c) AS casts,
       (SELECT json_extract(b.value, '$.text') FROM json_each(p.film, '$.firstScene.beats') b WHERE json_extract(b.value, '$.kind') = 'say' ORDER BY b.key DESC LIMIT 1) AS said,
       (SELECT m.text FROM messages m WHERE m.play_id = p.id AND m.speaker != 'tell' AND m.kind != 'aside' ORDER BY m.at DESC, m.rowid DESC LIMIT 1) AS last,
       (SELECT COUNT(*) FROM films f WHERE f.id = p.film_id) AS live
     FROM plays p WHERE p.owner = ? ORDER BY p.created_at DESC LIMIT 200`,
    ctx.visitor,
  );
  return rows.map((r) => ({
    id: r.id,
    filmId: r.film_id,
    title: r.title ?? '',
    logline: r.logline ?? '',
    poster: r.poster ?? '',
    castNames: r.casts ? (JSON.parse(r.casts) as string[]) : [],
    elapsed: r.elapsed,
    startDow: r.start_dow,
    startMin: r.start_min,
    ended: r.ended === 1,
    // 한편의 줄은 내가 나눈 말이 아니다. 아직 오간 말이 없으면 오프닝의 마지막 대사를 보인다
    lastLine: r.last ?? r.said ?? '',
    filmGone: r.live === 0,
  }));
}

/** 삶 하나에 딸린 것이 있는 표 */
const OF_PLAY = ['turns', 'messages', 'posts', 'feed_days', 'asides', 'saves', 'events', 'gen_log'] as const;

/** 삶을 지운다. 내 삶만 지운다. 오간 말, 피드, 한편, 저장한 장면까지 다 지운다 — 되돌릴 수 없어서 화면이 한 번 묻는다.
    남은 내 삶 목록을 돌려준다 */
export async function dropPlay(ctx: Ctx, id: string): Promise<PlayCard[]> {
  const row = await ctx.db.first<{ id: string }>('SELECT id FROM plays WHERE id = ? AND owner = ?', id, ctx.visitor);
  if (!row) throw new Fail(404, 'play_missing', '살고 있던 필름을 찾을 수 없어요.');
  await ctx.db.batch([...OF_PLAY.map((t) => q(`DELETE FROM ${t} WHERE play_id = ?`, id)), q('DELETE FROM plays WHERE id = ?', id)]);
  return listPlays(ctx);
}
