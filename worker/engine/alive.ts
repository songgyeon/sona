/* 같이 사는 느낌 — 캐스트에게도 저마다의 하루가 있다.
   - 피드: 캐스트마다 작중 하루에 많아야 하나. 본 영화·드라마, 들은 노래, 일기, 사진, 검색어, 본 영상 가운데서(feed.ts).
     그 자리에 있는 사람은 남기지 않는다 — 말하다가 피드를 올리는 사람은 없다.
   - 여럿이 나오는 필름에서, 자리에 없는 캐스트는 가끔 먼저 메시지를 보낸다(chatPing).
   누가 언제 남기고 보낼지는 코드가 정한다. 모델은 무엇을 남길지 고르고 글만 쓴다. 답이 늦어지지 않게 답과 같이 부른다. */

import { inSpan, worldAt } from '../../shared/clock';
import { josa } from '../../shared/ko';
import { wasThere } from '../../shared/opening';
import { RULES } from '../../shared/rules';
import { feedLine } from '../../shared/feed';
import type { Cast, MessageView, PlayView, PostData } from '../../shared/types';
import { newId, q, type Stmt } from '../db';
import type { ModelCall } from '../model/index';
import { castLayer } from '../prompt/cast';
import { sceneLayer, when } from '../prompt/scene';
import { PING_SYSTEM } from '../prompt/system';
import { type Ctx, Fail } from './ctx';
import { feedDue, type FeedGot, pastFeed } from './feed';
import { dataOf, lastTurn, loadPlay, type Play, viewOf } from './store';
import { ask, bubbles, errText, eventsFor, logStmt, recent, toLines } from './talk';

/** 이 사람이 그때 깨어 있나 */
const awake = (play: Play, cast: Cast, at: number): boolean => !inSpan(worldAt(play, at).min, cast.sleepFrom, cast.sleepTo);

const named = (text: string, c: Cast) => [c.name, ...c.aliases].some((n) => n.length > 0 && text.includes(n));

/** 한 대목에 나온 캐스트: 말한 사람, 지문에 나온 사람, 그리고 대목이 끝났을 때의 모습에 이름이 나온 사람 */
export function inPassage(play: Play, pieces: { speaker: string; text: string }[], pose: string): Set<string> {
  const here = new Set<string>();
  for (const c of play.film.casts) {
    if (pose && named(pose, c)) here.add(c.key);
    for (const p of pieces) if (p.speaker === c.key || (p.speaker === 'tell' && named(p.text, c))) here.add(c.key);
  }
  return here;
}

/** 지금 장면에 있는 캐스트. 바로 앞 대목에서 말했거나, 그 대목이 끝났을 때의 모습(「모습」 줄)에 이름이 나온 사람이다.
    모습 줄이 없으면 지문에 이름이 나온 사람도 친다. 아직 대목이 없으면(첫 대목 전) 오프닝 자리에 있던 사람이다 */
export function presentCasts(play: Play, before: MessageView[]): Set<string> {
  const film = play.film;
  const written = before.filter((m) => m.speaker !== 'persona' && m.kind !== 'ping' && m.kind !== 'aside');
  const last = written[written.length - 1]?.turnId;
  if (!last && !play.pose) return new Set(film.casts.filter((c) => wasThere(film, c.key)).map((c) => c.key));
  const pieces = last ? written.filter((w) => w.turnId === last) : [];
  // 모습 줄이 있으면 지문은 보지 않는다 — 지문에는 나가는 사람도 나온다. 말한 사람은 그대로 친다
  return inPassage(play, play.pose ? pieces.filter((p) => p.speaker !== 'tell') : pieces, play.pose);
}

/** 이번에 먼저 메시지를 보낼 사람. 없으면 null.
    여럿이 나오는 필름에서만. 지금 장면에 없고, 깨어 있고, 그 사람과 마지막으로 말을 나눈 지 chatMin이 지났어야 한다 */
export function pinger(play: Play, before: MessageView[], here: Set<string>, busy: Cast | null): Cast | null {
  const film = play.film;
  if (!film.opens.ping || film.casts.length < 2) return null;
  const now = play.elapsed;
  const lastOf = (key: string) => Math.max(0, ...before.filter((m) => m.speaker === key && m.kind !== 'aside').map((m) => m.at));
  const can = film.casts.filter((c) => c.key !== busy?.key && !here.has(c.key) && awake(play, c, now) && now - lastOf(c.key) >= RULES.ping.chatMin);
  can.sort((a, b) => lastOf(a.key) - lastOf(b.key));
  return can[0] ?? null;
}

/** 받은 글과 그 기록. 글은 적을지 버릴지 나중에 정한다(drop) */
interface Got {
  stmts: Stmt[];
  log: (dropped: string | null) => Stmt;
}

/** 모델을 부르고, 못 받으면 까닭만 남긴다. 같이 사는 느낌의 글은 못 받아도 장면은 그대로 간다 */
async function tryAsk(ctx: Ctx, play: Play, turnId: string, call: ModelCall, use: (text: string) => Stmt[]): Promise<Got> {
  try {
    const out = await ask(ctx, call);
    const stmts = use(out.text);
    return { stmts, log: (dropped) => logStmt(ctx, play.id, turnId, call, out, stmts.length > 0 && !dropped, dropped ?? (stmts.length > 0 ? null : '쓸 줄이 없음')) };
  } catch (e) {
    return { stmts: [], log: () => logStmt(ctx, play.id, turnId, call, null, false, errText(e)) };
  }
}

const keep = (g: Got): Stmt[] => [...g.stmts, g.log(null)];

/** 자리에 없는 사람이 먼저 메시지를 보낸다 */
async function chatPing(ctx: Ctx, play: Play, cast: Cast, turnId: string, before: MessageView[]): Promise<Got> {
  const film = play.film;
  const call: ModelCall = {
    purpose: 'ping',
    layers: {
      system: PING_SYSTEM,
      cast: castLayer(film, cast),
      scene: sceneLayer({ film, cast, clock: play, events: await eventsFor(ctx, play, cast.key), history: toLines(play, recent(before)) }),
    },
    user: `(${when(play, play.elapsed)}. ${josa(film.persona.name, '은', '는')} 지금 너와 다른 곳에 있다. 네가 먼저 메시지를 보낸다.)`,
    temperature: 0.8,
    maxTokens: 300,
  };
  return tryAsk(ctx, play, turnId, call, (text) =>
    bubbles(text)
      .slice(0, 2)
      .map((line) =>
        q(
          'INSERT INTO messages (id, play_id, turn_id, room, speaker, text, at, kind, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          newId(),
          play.id,
          turnId,
          cast.key,
          cast.key,
          line,
          play.elapsed,
          'ping',
          ctx.now(),
        ),
      ),
  );
}

/** 이번 턴에 같이 사는 느낌으로 일어날 일. 답과 같이 부르고, 답을 받으면 함께 적는다.
    돌려주는 것은 「이번 대목에 나온 사람」을 받아 적을 문장을 내주는 함수다 —
    피드와 메시지는 답과 같이 받으니, 이번 대목에 그 사람이 나왔으면(들어와서 말했으면) 버린다.
    말하다가 피드를 남기는 사람은 없다. 버린 피드는 그날이 가기 전에 다시 묻는다 */
export async function lifeWork(ctx: Ctx, play: Play, turnId: string, before: MessageView[]): Promise<(appeared: Set<string>) => Stmt[]> {
  // 이 기능이 생기기 전에 들어간 삶은 이야기 전의 피드가 없다. 다음 대목 때 적는다
  const past = play.film.opens.feed && !play.past ? pastFeed(ctx, play, turnId) : Promise.resolve([] as Stmt[]);
  const here = presentCasts(play, before);
  const feed = feedDue(ctx, play, turnId, before, here);
  const caller = pinger(play, before, here, null);
  const [pastStmts, post, ping] = await Promise.all([past, feed, caller ? chatPing(ctx, play, caller, turnId, before) : null]);
  const settle = (got: Got | FeedGot | null, cast: Cast | null, appeared: Set<string>): Stmt[] => {
    if (!got || !cast) return [];
    if (appeared.has(cast.key)) return [got.log('이번 대목에 나와서 버림')];
    return keep(got);
  };
  return (appeared) => [...pastStmts, ...settle(post, post?.cast ?? null, appeared), ...settle(ping, caller, appeared)];
}

/** 피드를 열 때. 이 기능이 생기기 전에 들어간 삶은 이야기 전의 피드가 없다 — 그때 적는다 */
export async function openFeed(ctx: Ctx, playId: string): Promise<PlayView> {
  const play = await loadPlay(ctx, playId);
  if (play.film.opens.feed && !play.past) {
    const turn = await lastTurn(ctx.db, playId);
    await ctx.db.batch(await pastFeed(ctx, play, turn?.id ?? playId));
  }
  return viewOf(ctx, playId);
}

/** 내 피드에 글을 올린다. 캐스트도 본다 — 다음 대목부터 「모두 아는 일」로 건네진다. 시간은 흐르지 않는다 */
export async function postMine(ctx: Ctx, playId: string, input: unknown): Promise<PlayView> {
  const play = await loadPlay(ctx, playId);
  if (!play.film.opens.feed) throw new Fail(400, 'feed_closed', '이 필름은 피드를 열지 않았어요.');
  const raw = input && typeof input === 'object' ? (input as { text?: unknown }).text : undefined;
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (!text) throw new Fail(400, 'empty_post', '올릴 글을 써 주세요.');
  if (text.length > RULES.feed.length) throw new Fail(400, 'long_post', `피드 글은 ${RULES.feed.length}자까지 쓸 수 있어요.`);
  const turn = await lastTurn(ctx.db, playId);
  const everyone = ['persona', ...play.film.casts.map((c) => c.key)];
  await ctx.db.batch([
    q('INSERT INTO posts (id, play_id, turn_id, cast_key, text, at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', newId(), playId, turn?.id ?? playId, 'persona', text, play.elapsed, ctx.now()),
    q(
      'INSERT INTO events (id, play_id, turn_id, at, kind, actor, text, known_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      newId(),
      playId,
      turn?.id ?? playId,
      play.elapsed,
      'post',
      'persona',
      text,
      JSON.stringify(everyone),
      ctx.now(),
    ),
  ]);
  return viewOf(ctx, playId);
}

/** 피드 글을 고치거나 지울 수 있는가. 내 글은 그 삶의 주인이, 캐스트의 글은 그 필름을 만든 사람만(2026-11-12 사용자 지시: 「캐스트 글만 제작자 전용」).
    필름을 지웠으면 만든 사람을 알 수 없어서 캐스트의 글은 아무도 못 고친다 */
async function mayTouch(ctx: Ctx, play: Play, castKey: string): Promise<void> {
  if (castKey === 'persona') return;
  const maker = await ctx.db.first<{ owner: string }>('SELECT owner FROM films WHERE id = ?', play.filmId);
  if (maker?.owner !== ctx.visitor) throw new Fail(403, 'not_maker', '캐스트의 피드는 필름을 만든 사람만 고치거나 지울 수 있어요.');
}

interface PostRow {
  cast_key: string;
  text: string;
  at: number;
  kind: string;
  data: string;
}

/** 내 삶의 피드 글 하나. 없으면 거절한다 */
async function postOf(ctx: Ctx, playId: string, postId: string): Promise<PostRow> {
  const post = await ctx.db.first<PostRow>('SELECT cast_key, text, at, kind, data FROM posts WHERE id = ? AND play_id = ?', postId, playId);
  if (!post) throw new Fail(404, 'post_missing', '글을 찾을 수 없어요.');
  return post;
}

/** 글과 그 글을 올린 일(아는 일)은 같은 때, 같은 사람, 같은 글로 적혀 있다 */
const eventOf = "play_id = ? AND kind IN ('feed', 'post') AND actor = ? AND at = ? AND text = ?";

/** 피드 글을 지운다. 그 글을 올린 일(아는 일)도 같이 지운다: 다음 대목부터 캐스트는 그 글을 모른다.
    그날은 치른 날로 남는다 — 바로 다른 글이 올라오지 않는다 */
export async function dropPost(ctx: Ctx, playId: string, postId: string): Promise<PlayView> {
  const play = await loadPlay(ctx, playId);
  const post = await postOf(ctx, playId, postId);
  await mayTouch(ctx, play, post.cast_key);
  await ctx.db.batch([
    q(`DELETE FROM events WHERE ${eventOf}`, playId, post.cast_key, post.at, post.text),
    q('DELETE FROM posts WHERE id = ? AND play_id = ?', postId, playId),
  ]);
  return viewOf(ctx, playId);
}

/** 고친 글을 읽는다. 종류는 바꾸지 못한다 — 그 종류의 칸만 고친다. 길이는 대사 모델이 쓸 때와 같다. 맞지 않으면 어느 칸인지 말하고 거절한다 */
function readEdit(old: PostData, input: unknown): PostData {
  const o = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const F = RULES.feed;
  const str = (k: string, max: number, name: string, must = false): string => {
    const v = typeof o[k] === 'string' ? (o[k] as string).trim() : '';
    if (must && !v) throw new Fail(400, 'bad_post', `${josa(name, '을', '를')} 적어 주세요.`);
    if (v.length > max) throw new Fail(400, 'bad_post', `${josa(name, '은', '는')} ${max}자까지예요.`);
    return v;
  };
  const list = (k: string): string[] => (Array.isArray(o[k]) ? (o[k] as unknown[]).filter((x): x is string => typeof x === 'string').map((x) => x.trim()).filter((x) => x.length > 0) : []);
  switch (old.kind) {
    case 'watch':
      return { ...old, title: str('title', F.title, '제목', true), ep: old.form === 'drama' ? str('ep', F.ep, '회차') : '', note: str('note', F.note, '한마디') };
    case 'song':
      return { ...old, title: str('title', F.title, '곡명', true), artist: str('artist', F.artist, '부른 사람'), note: str('note', F.note, '한마디') };
    case 'book':
      return { ...old, title: str('title', F.title, '제목', true), author: str('author', F.artist, '지은이'), note: str('note', F.note, '한마디') };
    case 'diary':
      return { kind: 'diary', text: str('text', F.diary, '일기', true) };
    case 'photo':
      return { ...old, note: str('note', F.note, '한마디') };
    case 'search': {
      const queries = list('queries');
      if (queries.length === 0) throw new Fail(400, 'bad_post', '검색어를 적어 주세요.');
      if (queries.length > F.items || queries.some((x) => x.length > F.query)) throw new Fail(400, 'bad_post', `검색어는 ${F.items}개까지, 하나에 ${F.query}자까지예요.`);
      return { kind: 'search', queries };
    }
    case 'tube': {
      const items = list('items').map((x) => {
        const m = /^(.*?)\s*[(（]\s*(\d{1,2}:\d{2}(?::\d{2})?)\s*[)）]$/.exec(x);
        return m ? { title: m[1]!.trim(), length: m[2]! } : { title: x, length: '' };
      });
      if (items.length === 0) throw new Fail(400, 'bad_post', '본 영상을 적어 주세요.');
      if (items.length > F.items || items.some((x) => !x.title || x.title.length > F.title)) throw new Fail(400, 'bad_post', `본 영상은 ${F.items}개까지, 제목은 ${F.title}자까지예요.`);
      return { kind: 'tube', items };
    }
    default:
      return old;
  }
}

/** 피드 글을 고친다. 내 글과 예전 한 줄 글은 글을, 그 밖에는 그 종류의 칸을.
    그 글을 올린 일(아는 일)도 고친 글로 바꾼다 — 다음 대목부터 캐스트는 고친 글로 안다. 만든 사람이 고친 작품은 목록과 견주지 않는다 */
export async function editPost(ctx: Ctx, playId: string, postId: string, input: unknown): Promise<PlayView> {
  const play = await loadPlay(ctx, playId);
  const post = await postOf(ctx, playId, postId);
  await mayTouch(ctx, play, post.cast_key);
  const old = dataOf(post.kind, post.data);
  let text: string;
  let data = '';
  if (old.kind === 'text') {
    const raw = input && typeof input === 'object' ? (input as { text?: unknown }).text : undefined;
    text = typeof raw === 'string' ? raw.trim() : '';
    if (!text) throw new Fail(400, 'empty_post', '글을 써 주세요.');
    if (text.length > RULES.feed.length) throw new Fail(400, 'long_post', `피드 글은 ${RULES.feed.length}자까지 쓸 수 있어요.`);
  } else {
    const next = readEdit(old, input);
    const cast = play.film.casts.find((c) => c.key === post.cast_key);
    const about = next.kind === 'photo' ? (cast?.photos ?? []).find((p) => p.id === next.photo)?.about ?? '' : '';
    text = feedLine(next, cast?.name ?? '', about);
    data = JSON.stringify(next);
  }
  await ctx.db.batch([
    q(`UPDATE events SET text = ? WHERE ${eventOf}`, text, playId, post.cast_key, post.at, post.text),
    data ? q('UPDATE posts SET text = ?, data = ? WHERE id = ? AND play_id = ?', text, data, postId, playId) : q('UPDATE posts SET text = ? WHERE id = ? AND play_id = ?', text, postId, playId),
  ]);
  return viewOf(ctx, playId);
}
