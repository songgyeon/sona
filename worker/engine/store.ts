/* 플레이를 읽는 곳. 화면에 내보내는 모양도 여기서 만든다. */

import type { Clock } from '../../shared/clock';
import { readFilm, sceneOf } from '../../shared/opening';
import type { AsideView, Film, MessageView, PlayCard, PlayView, PostView, TurnView } from '../../shared/types';
import type { Db } from '../db';
import { type Ctx, Fail } from './ctx';
import { forScreen } from './films';

export interface Play extends Clock {
  id: string;
  filmId: string;
  owner: string;
  film: Film;
  ended: boolean;
  /** 지금까지 열어 둔 날 수 */
  days: number;
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

/** 한자리에서 오간 말들. 이 캐스트와 같이 있는 캐스트들의 방을 한데 모은다 — 작중 시각 순, 같은 시각이면 들어온 순.
    같이 있는 사람이 없으면 이 캐스트와 둘이 나눈 말뿐이다 */
export async function sceneMessages(db: Db, play: Play, castKey: string): Promise<MessageView[]> {
  const rooms = sceneOf(play.film, castKey);
  if (rooms.length === 1) return messagesOf(db, play.id, castKey);
  return (await messagesOf(db, play.id)).filter((m) => rooms.includes(m.room));
}

export async function postsOf(db: Db, playId: string): Promise<PostView[]> {
  const rows = await db.all<{ id: string; cast_key: string; text: string; at: number }>(
    'SELECT id, cast_key, text, at FROM posts WHERE play_id = ? ORDER BY at, rowid',
    playId,
  );
  return rows.map((r) => ({ id: r.id, cast: r.cast_key, text: r.text, at: r.at }));
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
    mine: maker?.owner === ctx.visitor,
    messages,
    posts,
    asides,
    stuck: last && last.status !== 'done' ? last : null,
  };
}

export async function listPlays(ctx: Ctx): Promise<PlayCard[]> {
  const rows = await ctx.db.all<PlayRow>(
    'SELECT * FROM plays WHERE owner = ? ORDER BY created_at DESC LIMIT 20',
    ctx.visitor,
  );
  const out: PlayCard[] = [];
  for (const r of rows) {
    const p = toPlay(r);
    const last = await ctx.db.first<{ text: string }>(
      // 한편의 줄은 내가 나눈 말이 아니다
      "SELECT text FROM messages WHERE play_id = ? AND speaker != 'tell' AND kind != 'aside' ORDER BY at DESC, rowid DESC LIMIT 1",
      p.id,
    );
    out.push({
      id: p.id,
      filmId: p.filmId,
      title: p.film.title,
      logline: p.film.logline,
      poster: p.film.poster ?? '',
      castNames: p.film.casts.map((c) => c.name),
      elapsed: p.elapsed,
      startDow: p.startDow,
      startMin: p.startMin,
      ended: p.ended,
      // 아직 오간 말이 없으면 오프닝의 마지막 대사를 보인다
      lastLine: last?.text ?? p.film.firstScene.beats.flatMap((b) => (b.kind === 'say' ? [b.text] : [])).pop() ?? '',
    });
  }
  return out;
}
