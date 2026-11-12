/* 피드 — 캐스트의 하루 한 조각: 본 영화·드라마, 들은 노래, 일기, 사진, 검색어, 본 영상.
   - 캐스트마다 작중 하루(새벽 5시에 바뀐다)에 많아야 하나. 디렉터가 켜 둔 것 가운데서.
   - 언제 남길지는 코드가 정한다(slotOf): 그날 깨어 있는 때 가운데 하나. 그 시각이 지나면 남길지 묻는다.
   - 무엇을 남길지, 남기지 않을지는 대사 모델이 고른다. 사진은 디렉터가 붙인 것만, 한 장은 한 번만.
   - 그 자리에 있는 캐스트는 남기지 않는다. 장면에서 빠진 뒤에, 그날이 가기 전에 남긴다.
     유저가 자리를 비우면 그 사이에 남긴다(feedSpan) — 늘 같이 있는 필름에서도 비운 사이에는 남는다.
   - 사진은 모두가 본다. 나머지(본 것, 들은 것, 일기, 검색어)는 그 사람만 안다.
     유저는 피드에서 읽을 수 있어도 유저의 인물은 모른다.
   - 들어갈 때 이야기 전 며칠 치를 채워 둔다(pastFeed). 그 글은 피드에만 두고 작가에게 건네지 않는다. */

import { type Clock, DAY, inSpan, worldAt } from '../../shared/clock';
import { feedLine, kindsNow, parseFeed, postLabel } from '../../shared/feed';
import { RULES } from '../../shared/rules';
import type { Cast, FeedKind, FeedPhoto, MessageView, PostData } from '../../shared/types';
import { newId, q, type Stmt } from '../db';
import type { ModelCall } from '../model/index';
import { castLayer } from '../prompt/cast';
import { lineOf, when } from '../prompt/scene';
import { feedSystem } from '../prompt/system';
import type { Ctx } from './ctx';
import type { Play } from './store';
import { ask, bubbles, errText, eventsFor, logStmt, toLines } from './talk';

const F = RULES.feed;

/** 이 사람이 그때 깨어 있나 */
const awake = (play: Clock, cast: Cast, at: number): boolean => !inSpan(worldAt(play, at).min, cast.sleepFrom, cast.sleepTo);

/** 이야기가 시작된 날의 번호(시작한 날 0시를 기준으로 센 날, 새벽 5시에 바뀐다) */
const baseDay = (c: Clock) => Math.floor((c.startMin - RULES.dayBoundaryMin) / DAY);

/** 몇째 날인가. 이야기가 시작된 날이 0, 그 전날이 -1 */
export function dayOf(c: Clock, at: number): number {
  return Math.floor((c.startMin + at - RULES.dayBoundaryMin) / DAY) - baseDay(c);
}

/** k째 날이 시작되는 때(흐른 분). 0째 날은 이야기가 시작되기 전부터다 */
export function dayStarts(c: Clock, k: number): number {
  return (baseDay(c) + k) * DAY + RULES.dayBoundaryMin - c.startMin;
}

/** 같은 삶, 같은 사람, 같은 날이면 늘 같은 수 */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/** k째 날에 이 사람이 피드에 남길 때. 그날 깨어 있는 때 가운데 하나. 이야기가 시작된 날은 시작하고 조금 지나서부터.
    깨어 있는 때가 없으면 null */
export function slotOf(play: Play, cast: Cast, k: number): number | null {
  const start = k === 0 ? Math.max(dayStarts(play, 0), F.calmMin) : dayStarts(play, k);
  const end = dayStarts(play, k + 1);
  const can: number[] = [];
  for (let t = Math.ceil(start / F.stepMin) * F.stepMin; t < end; t += F.stepMin) if (awake(play, cast, t)) can.push(t);
  return can.length === 0 ? null : can[hash(`${play.id}:${cast.key}:${k}`) % can.length]!;
}

interface Done {
  cast: string;
  day: number;
}

/** 이 사람이 이미 올린 사진들 */
const usedPhotos = async (ctx: Ctx, play: Play, cast: Cast): Promise<Set<string>> =>
  new Set(
    (await ctx.db.all<{ data: string }>("SELECT data FROM posts WHERE play_id = ? AND cast_key = ? AND kind = 'photo'", play.id, cast.key)).map(
      (r) => (JSON.parse(r.data) as { photo?: string }).photo ?? '',
    ),
  );

/** 지금 남길 수 있는 것과 고를 수 있는 사진 */
async function choices(ctx: Ctx, play: Play, cast: Cast): Promise<{ kinds: FeedKind[]; photos: FeedPhoto[] }> {
  const used = await usedPhotos(ctx, play, cast);
  const photos = (cast.photos ?? []).filter((p) => !used.has(p.id));
  return { kinds: kindsNow(cast.feed ?? [], photos.length), photos };
}

/** 그 사람이 있던 대목들의 말. 말했거나 지문에 이름이 나온 대목만. 최근 것부터 정해진 글자 수까지 */
function seenBy(play: Play, cast: Cast, before: MessageView[], upTo: number, chars = 4000): string[] {
  const names = [cast.name, ...cast.aliases].filter((n) => n.length > 0);
  const turns = new Set(
    before.filter((m) => m.at <= upTo && (m.speaker === cast.key || (m.speaker === 'tell' && names.some((n) => m.text.includes(n))))).map((m) => m.turnId),
  );
  const lines = toLines(play, before.filter((m) => m.at <= upTo && turns.has(m.turnId) && m.kind !== 'aside' && m.kind !== 'ping')).map(lineOf);
  const out: string[] = [];
  let n = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    n += lines[i]!.length + 1;
    if (n > chars) break;
    out.unshift(lines[i]!);
  }
  return out;
}

/** [요즘 남긴 것] — 같은 종류만 잇달아 고르지 않게 */
async function lately(ctx: Ctx, play: Play, cast: Cast): Promise<string[]> {
  const rows = await ctx.db.all<{ at: number; kind: string; data: string }>(
    'SELECT at, kind, data FROM posts WHERE play_id = ? AND cast_key = ? ORDER BY at DESC, rowid DESC LIMIT 3',
    play.id,
    cast.key,
  );
  return rows.map((r) => `- ${when(play, r.at)}: ${r.kind === 'text' ? '한 줄 글' : postLabel(JSON.parse(r.data) as PostData)}`);
}

/** 모델에게 건넬 시나리오: 그때, 그 사람이 아는 일, 그 사람이 있던 장면, 올릴 수 있는 사진, 요즘 남긴 것 */
async function feedScene(ctx: Ctx, play: Play, cast: Cast, at: number, photos: FeedPhoto[], before: MessageView[]): Promise<string> {
  const out: string[] = ['[지금]', `${when(play, at)}.`, `자는 시간: ${hhmm(cast.sleepFrom)} ~ ${hhmm(cast.sleepTo)}`];
  const events = await eventsFor(ctx, play, cast.key, at);
  if (events.length > 0) {
    out.push('', '[네가 아는 일]');
    for (const e of events.slice(-20)) out.push(`- (${when(play, e.at)}) ${e.text}`);
  }
  const seen = seenBy(play, cast, before, at);
  if (seen.length > 0) out.push('', '[오늘 있었던 장면]', ...seen);
  if (photos.length > 0) {
    out.push('', '[올릴 수 있는 사진]');
    photos.forEach((p, i) => out.push(`${i + 1}. ${p.about || '무슨 사진인지 적혀 있지 않다'}`));
  }
  const last = await lately(ctx, play, cast);
  if (last.length > 0) out.push('', '[요즘 남긴 것]', ...last);
  return out.join('\n');
}

const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

/** 남긴 것을 적는 문장들: 피드 글, 그날을 치렀다는 표시, 그리고 아는 일(이야기가 시작된 뒤의 것만) */
function feedStmts(ctx: Ctx, play: Play, turnId: string, cast: Cast, day: number, at: number, data: PostData | null, photos: FeedPhoto[]): Stmt[] {
  const mark = q(
    'INSERT OR IGNORE INTO feed_days (play_id, cast_key, day, at, kind, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    play.id,
    cast.key,
    day,
    at,
    data?.kind ?? '',
    ctx.now(),
  );
  if (!data) return [mark];
  const about = data.kind === 'photo' ? (photos.find((p) => p.id === data.photo)?.about ?? '') : '';
  const text = feedLine(data, cast.name, about);
  const out = [
    mark,
    q('INSERT INTO posts (id, play_id, turn_id, cast_key, text, at, created_at, kind, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', newId(), play.id, turnId, cast.key, text, at, ctx.now(), data.kind, JSON.stringify(data)),
  ];
  if (at < 0) return out;
  // 사진은 피드에 올린 것이라 모두가 본다. 나머지는 그 사람만 안다
  const knownBy = data.kind === 'photo' ? ['persona', ...play.film.casts.map((c) => c.key)] : [cast.key];
  out.push(
    q(
      'INSERT INTO events (id, play_id, turn_id, at, kind, actor, text, known_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      newId(),
      play.id,
      turnId,
      at,
      'feed',
      cast.key,
      text,
      JSON.stringify(knownBy),
      ctx.now(),
    ),
  );
  return out;
}

/** 받은 것과 그 기록. 적을지 버릴지는 나중에 정한다(답에 그 사람이 나오면 버린다) */
export interface FeedGot {
  cast: Cast;
  stmts: Stmt[];
  log: (dropped: string | null) => Stmt;
}

/** 한 사람의 한 날을 묻는다. 모양이 틀리면 그날은 남기지 않은 것으로 친다 — 다시 묻지 않는다 */
async function askDay(ctx: Ctx, play: Play, turnId: string, cast: Cast, day: number, at: number, before: MessageView[]): Promise<FeedGot | null> {
  const { kinds, photos } = await choices(ctx, play, cast);
  if (kinds.length === 0) return null;
  const call: ModelCall = {
    purpose: 'post',
    layers: { system: feedSystem(kinds), cast: castLayer(play.film, cast), scene: await feedScene(ctx, play, cast, at, photos, before) },
    user: `(${when(play, at)}. 오늘 하루의 한 조각을 피드에 남길지 정한다.)`,
    temperature: 0.9,
    maxTokens: 300,
  };
  try {
    const out = await ask(ctx, call);
    const line = bubbles(out.text)[0] ?? '';
    const read = parseFeed(line, kinds, photos);
    const data = read === 'none' || read === null ? null : read;
    const stmts = feedStmts(ctx, play, turnId, cast, day, at, data, photos);
    return { cast, stmts, log: (dropped) => logStmt(ctx, play.id, turnId, call, out, !!data && !dropped, dropped ?? (read === null ? '모양이 틀림' : data ? null : '없음')) };
  } catch (e) {
    // 못 받았다. 그날은 아직 치르지 않은 것으로 둔다 — 다음에 다시 묻는다
    return { cast, stmts: [], log: () => logStmt(ctx, play.id, turnId, call, null, false, errText(e)) };
  }
}

const doneSet = async (ctx: Ctx, play: Play): Promise<Set<string>> =>
  new Set((await ctx.db.all<Done>('SELECT cast_key AS cast, day FROM feed_days WHERE play_id = ?', play.id)).map((d) => `${d.cast}:${d.day}`));

const feeds = (play: Play) => (play.film.opens.feed ? play.film.casts.filter((c) => (c.feed ?? []).length > 0) : []);

/** 채팅하는 동안: 오늘 남길 때가 지났고, 아직 안 남겼고, 지금 장면에 없는 사람 하나. 때가 가장 이른 사람부터 */
export async function feedDue(ctx: Ctx, play: Play, turnId: string, before: MessageView[], here: Set<string>): Promise<FeedGot | null> {
  const now = play.elapsed;
  const k = dayOf(play, now);
  const done = await doneSet(ctx, play);
  const due = feeds(play)
    .filter((c) => !here.has(c.key) && !done.has(`${c.key}:${k}`) && awake(play, c, now))
    .map((c) => ({ c, at: slotOf(play, c, k) }))
    .filter((x): x is { c: Cast; at: number } => x.at !== null && x.at <= now)
    .sort((a, b) => a.at - b.at)[0];
  if (!due) return null;
  // 장면에서 빠져 있다가 남기는 것이면 지금 남긴 것이다
  return askDay(ctx, play, turnId, due.c, k, now, before);
}

/** 유저가 자리를 비운 사이(from, to]: 그 사이에 든 날마다 남길 때가 오면 남긴다.
    그날 남길 때가 비우기 전에 지났는데 그 자리에 있어서 못 남겼으면, 비우자마자(깨어 있는 첫 때) 남긴다 */
export async function feedSpan(ctx: Ctx, play: Play, turnId: string, from: number, to: number, before: MessageView[]): Promise<Stmt[]> {
  const done = await doneSet(ctx, play);
  const out: Stmt[] = [];
  for (const cast of feeds(play)) {
    for (let k = dayOf(play, from); k <= dayOf(play, to); k++) {
      if (done.has(`${cast.key}:${k}`)) continue;
      const slot = slotOf(play, cast, k);
      if (slot === null || slot > to) continue;
      let at = slot;
      if (slot <= from) {
        const end = Math.min(to, dayStarts(play, k + 1) - 1);
        let t = Math.ceil((from + 1) / F.stepMin) * F.stepMin;
        while (t <= end && !awake(play, cast, t)) t += F.stepMin;
        if (t > end) continue;
        at = t;
      }
      const got = await askDay(ctx, play, turnId, cast, k, at, before);
      if (got) out.push(...got.stmts, got.log(null));
    }
  }
  return out;
}

/** 이야기가 시작되기 전 며칠 치. 캐스트마다 한 번 묻고, 날마다 한 줄을 받는다. 다 적으면 삶에 적었다고 표시한다.
    남길 때는 코드가 정해 둔다 — 모델은 무엇을 남길지만 고른다 */
export async function pastFeed(ctx: Ctx, play: Play, turnId: string): Promise<Stmt[]> {
  const done = q('UPDATE plays SET past = 1 WHERE id = ?', play.id);
  const each = feeds(play).map(async (cast): Promise<Stmt[]> => {
    const { kinds, photos } = await choices(ctx, play, cast);
    if (kinds.length === 0) return [];
    const days = Array.from({ length: F.pastDays }, (_, i) => F.pastDays - i).map((n) => ({ n, at: slotOf(play, cast, -n) }));
    const open = days.filter((d): d is { n: number; at: number } => d.at !== null);
    if (open.length === 0) return [];
    const scene = [
      '[이야기가 시작되는 때]',
      when(play, 0),
      '',
      '[남길 날]',
      ...open.map((d) => `- ${d.n}일 전 (${when(play, d.at)})`),
      ...(photos.length > 0 ? ['', '[올릴 수 있는 사진]', ...photos.map((p, i) => `${i + 1}. ${p.about || '무슨 사진인지 적혀 있지 않다'}`)] : []),
    ].join('\n');
    const call: ModelCall = {
      purpose: 'past',
      layers: { system: feedSystem(kinds, true), cast: castLayer(play.film, cast), scene },
      user: '(이야기가 시작되기 전, 남길 날마다 한 줄씩 적는다.)',
      temperature: 0.9,
      maxTokens: 500,
    };
    try {
      const out = await ask(ctx, call);
      const stmts: Stmt[] = [];
      const left = [...photos];
      const seen = new Set<number>();
      for (const line of bubbles(out.text)) {
        const m = /^([1-9])\s*일\s*전\s*[|｜]\s*(.+)$/.exec(line);
        const day = m ? open.find((d) => d.n === Number(m[1])) : undefined;
        if (!m || !day || seen.has(day.n)) continue;
        seen.add(day.n);
        const read = parseFeed(m[2]!, kindsNow(cast.feed ?? [], left.length), left);
        if (read === 'none' || read === null) continue;
        if (read.kind === 'photo') left.splice(left.findIndex((p) => p.id === read.photo), 1);
        stmts.push(...feedStmts(ctx, play, turnId, cast, -day.n, day.at, read, photos));
      }
      return [...stmts, logStmt(ctx, play.id, turnId, call, out, stmts.length > 0, stmts.length > 0 ? null : '남긴 것이 없음')];
    } catch (e) {
      return [logStmt(ctx, play.id, turnId, call, null, false, errText(e))];
    }
  });
  return [...(await Promise.all(each)).flat(), done];
}
