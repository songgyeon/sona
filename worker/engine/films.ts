/* 필름 — 디렉터가 쓴 것을 받아 확인하고 저장한다. */

import { RULES } from '../../shared/rules';
import { readFilm } from '../../shared/opening';
import { FEED_KINDS } from '../../shared/feed';
import { fontOf } from '../../shared/fonts';
import type { Beat, Cast, Extra, FeedKind, FeedPhoto, Film, FilmCard, Persona, Reel, ReelClip, ReelText, Tie } from '../../shared/types';
import { newId, q } from '../db';
import { isUuid } from '../guard';
import { type Ctx, Fail } from './ctx';
import { type MediaType, mediaType } from './media';

const L = RULES.limits;

export function text(v: unknown, max: number, name: string, required = false): string {
  const s = typeof v === 'string' ? v.trim() : '';
  if (required && s.length === 0) throw new Fail(400, 'film_invalid', `${name} 칸을 채워 주세요.`);
  if (s.length > max) throw new Fail(400, 'film_invalid', `${name} 칸은 ${max}자까지 쓸 수 있어요.`);
  return s;
}

function int(v: unknown, min: number, max: number, name: string): number {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new Fail(400, 'film_invalid', `${name} 값이 올바르지 않아요.`);
  }
  return n;
}

function list(v: unknown, maxItems: number, maxLen: number, name: string): string[] {
  if (v == null) return [];
  if (!Array.isArray(v)) throw new Fail(400, 'film_invalid', `${name} 칸이 올바르지 않아요.`);
  const out = v.map((x) => text(x, maxLen, name)).filter((s) => s.length > 0);
  if (out.length > maxItems) throw new Fail(400, 'film_invalid', `${name}: ${maxItems}개까지 넣을 수 있어요.`);
  return out;
}

/** 올려 둔 그림을 가리키는 값. 비어 있어도 된다 */
export function image(v: unknown, name: string): string {
  if (v == null || v === '') return '';
  if (!isUuid(v)) throw new Fail(400, 'film_invalid', `${name} 그림이 올바르지 않아요.`);
  return v;
}

const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' ? (v as Record<string, unknown>) : {};

/** 덧붙이는 칸들. 내용이 빈 칸은 버린다. 항목 이름을 비우면 「메모」로 둔다 */
function extras(v: unknown, where: string): Extra[] {
  if (!Array.isArray(v)) return [];
  const out: Extra[] = [];
  for (const e of v) {
    const o = obj(e);
    const label = text(o.label, RULES.extras.label, `${where}의 덧붙인 항목`);
    const body = text(o.text, RULES.extras.text, `${where}의 덧붙인 내용`);
    if (!body) continue;
    out.push({ label: label || '메모', text: body });
  }
  if (out.length > RULES.extras.max) throw new Fail(400, 'film_invalid', `${where}에 덧붙이는 칸은 ${RULES.extras.max}개까지예요.`);
  return out;
}

/** 올려 둔 소리나 영상을 가리키는 값. 비어 있어도 된다 */
function media(v: unknown, name: string): string {
  if (v == null || v === '') return '';
  if (!isUuid(v)) throw new Fail(400, 'film_invalid', `${name} 파일이 올바르지 않아요.`);
  return v;
}

/** 소수도 되는 수. 0.1 단위로 둔다 */
function num(v: unknown, min: number, max: number, name: string): number {
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) throw new Fail(400, 'film_invalid', `${name} 값이 올바르지 않아요.`);
  return Math.round(n * 10) / 10;
}

const pickOf = <T extends string>(v: unknown, all: readonly T[], or: T): T => (all.includes(v as T) ? (v as T) : or);

/** 오프닝 영상. 컷이 없으면 없는 것이다 */
/** 컷 위의 글자들. 비운 글자는 버린다. 모르는 글꼴은 첫 글꼴로 */
function textsOf(raw: unknown[]): ReelText[] {
  const R = RULES.reel;
  if (raw.length > R.texts) throw new Fail(400, 'film_invalid', `컷 하나에 글자는 ${R.texts}개까지예요.`);
  return raw
    .map((x) => {
      const o = obj(x);
      return {
        text: text(o.text, R.text, '컷의 글자'),
        font: fontOf(typeof o.font === 'string' ? o.font : '').key,
        size: num(o.size ?? R.textSize, R.textMin, R.textMax, '글자 크기'),
        x: num(o.x ?? 50, 0, 100, '글자 자리'),
        y: num(o.y ?? 50, 0, 100, '글자 자리'),
        align: pickOf(o.align, ['left', 'center', 'right'] as const, 'center'),
        color: pickOf(o.color, ['white', 'black'] as const, 'white'),
      };
    })
    .filter((t) => t.text.length > 0);
}

function reelOf(v: unknown): Reel | null {
  if (v == null) return null;
  const o = obj(v);
  const R = RULES.reel;
  const raw = Array.isArray(o.clips) ? o.clips : [];
  if (raw.length > R.clips) throw new Fail(400, 'film_invalid', `오프닝 영상의 컷은 ${R.clips}개까지예요.`);
  const clips: ReelClip[] = raw.map((x) => {
    const c = obj(x);
    const kind = pickOf(c.kind, ['image', 'video', 'black'] as const, 'black');
    const src = kind === 'image' ? image(c.src, '오프닝 영상의') : kind === 'video' ? media(c.src, '오프닝 영상의 영상') : '';
    if (kind !== 'black' && !src) throw new Fail(400, 'film_invalid', '오프닝 영상의 컷에 그림이나 영상이 없어요.');
    return {
      kind,
      src,
      dur: num(c.dur, R.minDur, R.maxDur, '컷의 길이'),
      from: kind === 'video' ? num(c.from ?? 0, 0, 3600, '영상의 시작 지점') : 0,
      motion: pickOf(c.motion, ['none', 'in', 'out', 'left', 'right'] as const, 'none'),
      enter: pickOf(c.enter, ['cut', 'fade', 'black'] as const, 'cut'),
      text: text(c.text, R.text, '컷의 글자'),
      style: pickOf(c.style, ['title', 'sub', 'credit'] as const, 'title'),
      sound: kind === 'video' && c.sound !== false,
      ...(kind === 'video' && c.len != null ? { len: num(c.len, 0, 3600, '영상의 길이') } : {}),
      ...(Array.isArray(c.texts) ? { texts: textsOf(c.texts) } : {}),
    };
  });
  if (clips.length === 0) return null;
  if (clips.reduce((n, c) => n + c.dur, 0) > R.total) throw new Fail(400, 'film_invalid', `오프닝 영상은 ${R.total / 60}분까지예요.`);
  return {
    ratio: pickOf(o.ratio, ['tall', 'wide', 'cine'] as const, 'tall'),
    clips,
    music: media(o.music, '오프닝 영상의 음악'),
    musicName: text(o.musicName, 80, '음악 이름'),
    musicFrom: num(o.musicFrom ?? 0, 0, 3600, '음악의 시작 지점'),
    ...(o.musicLen != null ? { musicLen: num(o.musicLen, 0, 3600, '음악의 길이') } : {}),
  };
}

/** 필름에 건 소리와 영상이 정말 다 올라가 있는가, 종류가 맞는가 */
async function checkMedia(ctx: Ctx, film: Film): Promise<void> {
  const want: [string, MediaType, string][] = [];
  if (film.bgm) want.push([film.bgm, 'audio', '배경 음악']);
  if (film.reel?.music) want.push([film.reel.music, 'audio', '오프닝 영상의 음악']);
  for (const c of film.reel?.clips ?? []) if (c.kind === 'video') want.push([c.src, 'video', '오프닝 영상의 영상']);
  for (const [id, type, name] of want) {
    if ((await mediaType(ctx.db, id)) !== type) throw new Fail(400, 'film_invalid', `${name}을 다시 올려 주세요.`);
  }
}

/** 피드에 남기는 것 가운데 켜 둔 것. 안 보냈으면 다 켠 것이다. 모르는 종류는 버린다 */
function feedKinds(v: unknown): FeedKind[] {
  if (!Array.isArray(v)) return [...FEED_KINDS];
  return FEED_KINDS.filter((k) => v.includes(k));
}

/** 피드에 올릴 사진. 무슨 사진인지 적는 칸은 비워도 된다 */
function feedPhotos(v: unknown): FeedPhoto[] {
  if (v == null) return [];
  if (!Array.isArray(v)) throw new Fail(400, 'film_invalid', '피드 사진이 올바르지 않아요.');
  const out = v
    .map((x) => {
      const o = obj(x);
      return { id: image(o.id, '피드 사진'), about: text(o.about, RULES.feed.about, '무슨 사진') };
    })
    .filter((p) => p.id.length > 0);
  if (out.length > RULES.feed.photos) throw new Fail(400, 'film_invalid', `피드 사진은 캐스트마다 ${RULES.feed.photos}장까지예요.`);
  return out;
}

/** 내 배역 하나. 「유저 이름」 배역은 이름 칸을 비워도 된다 — 그때는 글에 대신 쓰는 이름(RULES.playerName)이다 */
function role(v: unknown, i: number): Persona {
  const p = obj(v);
  const player = p.player === true;
  const what = i === 0 ? '내 배역' : `내 배역 ${i + 1}`;
  return {
    name: text(p.name, 20, `${what}의 이름`, !player) || RULES.playerName,
    line: text(p.line, L.persona, `${what} 설명`),
    face: image(p.face, what),
    extras: extras(p.extras, what),
    ...(player ? { player: true } : {}),
  };
}

/** 화면에서 온 것을 필름으로 읽는다. 맞지 않으면 어느 칸인지 말하고 거절한다 */
export function parseFilm(input: unknown): Film {
  const f = obj(input);
  const persona = role(f.persona, 0);
  const rawRoles = Array.isArray(f.roles) ? f.roles : [];
  if (rawRoles.length > L.roles - 1) throw new Fail(400, 'film_invalid', `내 배역은 ${L.roles}개까지 넣을 수 있어요.`);
  const roles = rawRoles.map((r, i) => role(r, i + 1));
  const opens = obj(f.opens);
  const fs = obj(f.firstScene);

  const rawCasts = Array.isArray(f.casts) ? f.casts : [];
  if (rawCasts.length < 1) throw new Fail(400, 'film_invalid', '캐스트가 한 명은 있어야 해요.');
  if (rawCasts.length > L.casts) throw new Fail(400, 'film_invalid', `캐스트는 ${L.casts}명까지 넣을 수 있어요.`);

  const casts: Cast[] = rawCasts.map((raw, i) => {
    const c = obj(raw);
    return {
      key: `c${i + 1}`,
      name: text(c.name, 20, '캐스트 이름', true),
      face: image(c.face, '캐스트'),
      aliases: list(c.aliases, 6, 20, '불리는 이름'),
      role: text(c.role, L.short, '캐스트와의 관계'),
      intro: text(c.intro, L.intro, '소개'),
      callsUser: text(c.callsUser, 20, '나를 부르는 말'),
      speech: text(c.speech, L.speech, '말투'),
      nature: text(c.nature, L.trait, '성격'),
      habit: text(c.habit, L.trait, '습관'),
      trauma: text(c.trauma, L.trait, '트라우마'),
      lack: text(c.lack, L.trait, '결핍'),
      secret: text(c.secret, L.trait, '비밀'),
      samples: list(c.samples, 3, L.sample, '예시 대사'),
      sleepFrom: int(c.sleepFrom ?? 0, 0, 1439, '자는 시간'),
      sleepTo: int(c.sleepTo ?? 420, 0, 1439, '일어나는 시간'),
      dayPlace: text(c.dayPlace, 40, '낮에 있는 곳'),
      extras: extras(c.extras, '캐스트'),
      feed: feedKinds(c.feed),
      photos: feedPhotos(c.photos),
    };
  });
  const names = new Set(casts.map((c) => c.name));
  if (names.size !== casts.length) throw new Fail(400, 'film_invalid', '캐스트 이름이 겹쳐요.');
  // 배역의 이름이 캐스트와 같으면 누가 말했는지 가를 수 없다
  const taken = [persona, ...roles].find((r) => names.has(r.name));
  if (taken) throw new Fail(400, 'film_invalid', `캐스트와 이름이 같은 내 배역이 있어요: ${taken.name}`);
  const keys = new Set(casts.map((c) => c.key));

  // 화면은 캐스트를 순서(c1, c2 …)로 가리킨다
  const ties: Tie[] = (Array.isArray(f.ties) ? f.ties : [])
    .map((raw) => {
      const t = obj(raw);
      return {
        from: text(t.from, 4, '사이'),
        to: text(t.to, 4, '사이'),
        relation: text(t.relation, L.short, '어떤 사이'),
        calls: text(t.calls, 20, '부르는 말'),
      };
    })
    .filter((t) => t.relation.length > 0 || t.calls.length > 0);
  for (const t of ties) {
    if (!keys.has(t.from) || !keys.has(t.to) || t.from === t.to) {
      throw new Fail(400, 'film_invalid', '캐스트끼리의 사이가 올바르지 않아요.');
    }
  }

  const room = text(fs.room, 4, '첫 장면의 상대') || casts[0]!.key;
  if (!keys.has(room)) throw new Fail(400, 'film_invalid', '첫 장면의 상대가 캐스트에 없어요.');

  // 오프닝. 화면은 컷·지문·대사를 쌓은 칸으로 보낸다. 예전 모양(장면 글 한 덩이와 첫 마디)도 받는다
  let beats: Beat[] = [];
  let stills: string[];
  let firstLine = '';
  if (Array.isArray(fs.beats)) {
    if (fs.beats.length > L.beats) throw new Fail(400, 'film_invalid', `첫 장면은 ${L.beats}칸까지 쌓을 수 있어요.`);
    for (const raw of fs.beats) {
      const b = obj(raw);
      if (b.kind === 'cut') {
        const img = image(b.image, '컷');
        if (img) beats.push({ kind: 'cut', image: img });
      } else if (b.kind === 'tell') {
        const t = text(b.text, L.opening, '첫 장면의 지문');
        if (t) beats.push({ kind: 'tell', text: t });
      } else if (b.kind === 'say') {
        const t = text(b.text, L.line, '첫 장면의 대사');
        const who = text(b.cast, 4, '첫 장면의 대사') || room;
        if (!keys.has(who)) throw new Fail(400, 'film_invalid', '첫 장면에서 말하는 캐스트가 캐스트에 없어요.');
        if (t) beats.push({ kind: 'say', cast: who, text: t });
      } else {
        throw new Fail(400, 'film_invalid', '첫 장면의 칸이 올바르지 않아요.');
      }
    }
    const total = beats.reduce((n, b) => n + (b.kind === 'cut' ? 0 : b.text.length), 0);
    if (total > L.opening) throw new Fail(400, 'film_invalid', `첫 장면은 모두 합쳐 ${L.opening}자까지 쓸 수 있어요.`);
    // 필름의 컷은 오프닝에 건 컷들이다
    stills = [...new Set(beats.flatMap((b) => (b.kind === 'cut' ? [b.image] : [])))];
  } else {
    stills = (Array.isArray(f.stills) ? f.stills : []).map((s) => image(s, '컷')).filter((s) => s.length > 0);
    const situation = text(fs.situation, L.opening, '첫 장면');
    if (stills[0]) beats.push({ kind: 'cut', image: stills[0] });
    if (situation) beats.push({ kind: 'tell', text: situation });
    firstLine = text(fs.firstLine, L.line, '첫 대사');
  }
  if (stills.length > L.stills) throw new Fail(400, 'film_invalid', `컷은 ${L.stills}장까지 넣을 수 있어요.`);

  return {
    title: text(f.title, L.title, '제목', true),
    logline: text(f.logline, L.logline, '한 줄 소개'),
    poster: image(f.poster, '포스터'),
    stills,
    setting: text(f.setting, L.setting, '배경'),
    extras: extras(f.extras, '세계관'),
    startDow: int(f.startDow ?? 5, 0, 6, '시작 요일'),
    startMin: int(f.startMin ?? 16 * 60, 0, 1439, '시작 시각'),
    // 한편은 서로 볼 캐스트가 둘은 있어야 한다
    opens: { feed: opens.feed !== false, ping: opens.ping !== false, aside: opens.aside === true && casts.length > 1 },
    persona,
    roles,
    casts,
    ties,
    bgm: media(f.bgm, '배경 음악'),
    bgmName: text(f.bgmName, 80, '배경 음악 이름'),
    reel: reelOf(f.reel),
    firstScene: {
      place: text(fs.place, 40, '첫 장면의 장소'),
      beats,
      room,
      speaker: fs.speaker === 'cast' ? 'cast' : 'persona',
      firstLine,
    },
  };
}

export interface FilmRow {
  id: string;
  owner: string;
  title: string;
  logline: string;
  featured: number;
  data: string;
  /** 1이면 비공개 — 만든 사람만 목록에서 보고 들어간다 */
  private: number;
}

/** 비공개로 개봉하는가. 필름의 내용이 아니라 목록에 거는 방식이라, 필름(삶이 들고 가는 것)에는 넣지 않는다 */
const privateOf = (input: unknown): boolean => !!input && typeof input === 'object' && (input as { private?: unknown }).private === true;

const COLS = 'id, owner, title, logline, featured, data, private';

export async function createFilm(ctx: Ctx, input: unknown): Promise<{ id: string }> {
  const film = parseFilm(input);
  await checkMedia(ctx, film);
  const id = newId();
  await ctx.db.run(
    'INSERT INTO films (id, owner, title, logline, featured, data, created_at, private) VALUES (?, ?, ?, ?, 0, ?, ?, ?)',
    id,
    ctx.visitor,
    film.title,
    film.logline,
    JSON.stringify(film),
    ctx.now(),
    privateOf(input) ? 1 : 0,
  );
  return { id };
}

/** 개봉한 필름을 고친다. 만든 사람만 고친다.
    살고 있던 삶은 들어갈 때의 필름을 들고 있어서 그대로 간다 — 고친 내용은 새로 들어갈 때부터다 */
export async function updateFilm(ctx: Ctx, id: string, input: unknown): Promise<{ id: string }> {
  const row = await ctx.db.first<{ owner: string }>('SELECT owner FROM films WHERE id = ?', id);
  if (!row) throw new Fail(404, 'film_missing', '필름을 찾을 수 없어요.');
  if (row.owner !== ctx.visitor) throw new Fail(403, 'not_owner', '만든 사람만 고칠 수 있어요.');
  const film = parseFilm(input);
  await checkMedia(ctx, film);
  await ctx.db.run('UPDATE films SET title = ?, logline = ?, data = ? WHERE id = ?', film.title, film.logline, JSON.stringify(film), id);
  // 공개 범위는 보냈을 때만 바꾼다. 그 칸이 없던 때의 화면이 고치면 그대로 둔다
  const reach = input && typeof input === 'object' ? (input as { private?: unknown }).private : undefined;
  if (typeof reach === 'boolean') await ctx.db.run('UPDATE films SET private = ? WHERE id = ?', reach ? 1 : 0, id);
  return { id };
}

function card(row: FilmRow, visitor: string): FilmCard {
  const film = readFilm(JSON.parse(row.data) as Film);
  return {
    id: row.id,
    title: row.title,
    logline: row.logline,
    poster: film.poster ?? '',
    castNames: film.casts.map((c) => c.name),
    personaName: film.persona.name,
    personaLine: film.persona.line,
    mine: row.owner === visitor,
    featured: row.featured === 1,
    private: row.private === 1,
  };
}

/** 화면으로 보내는 필름. 성격부터 비밀까지, 덧붙이는 칸, 피드 사진(무슨 사진인지 적은 메모)은 디렉터만 보는 칸이라, 만든 사람이 고칠 때가 아니면 비워서 보낸다.
    대사 모델에게 건네는 필름은 서버에 있는 그대로다 */
export function forScreen(film: Film): Film {
  return {
    ...film,
    extras: [],
    persona: { ...film.persona, extras: [] },
    roles: (film.roles ?? []).map((r) => ({ ...r, extras: [] })),
    casts: film.casts.map((c) => ({ ...c, nature: '', habit: '', trauma: '', lack: '', secret: '', extras: [], photos: [] })),
  };
}

/** 개봉한 필름들. 누구에게나 보인다 — 어느 기기, 어느 길로 들어와도 같은 목록이다.
    비공개 필름과 시험하느라 만든 필름(제목으로 가린다)만 만든 사람에게만 보인다. 최근에 개봉한 것부터 */
export async function listFilms(ctx: Ctx): Promise<FilmCard[]> {
  // 남에게 안 보이는 필름(비공개, 시험하느라 만든 것)은 내용을 읽지도 않는다. 예전에는 다 읽고 걸러서 목록이 1초 넘게 걸렸다
  const hide = RULES.unlisted.map(() => 'title NOT LIKE ?').join(' AND ');
  const rows = await ctx.db.all<FilmRow>(
    `SELECT ${COLS} FROM films WHERE owner = ? OR (private = 0 AND ${hide}) ORDER BY featured DESC, created_at DESC LIMIT 300`,
    ctx.visitor,
    ...RULES.unlisted.map((head) => `${head}%`),
  );
  const unlisted = (title: string) => RULES.unlisted.some((head) => title.startsWith(head));
  return rows.filter((r) => r.owner === ctx.visitor || (r.private !== 1 && !unlisted(r.title))).map((r) => card(r, ctx.visitor));
}

/** 필름 하나. 누구나 읽는다 */
export async function getFilm(ctx: Ctx, id: string): Promise<{ card: FilmCard; film: Film }> {
  const { row, film } = await loadFilm(ctx, id);
  return screenOf(row, film, ctx.visitor);
}

/** 화면으로 보내는 필름과 그 카드. 고치는 화면은 만든 사람만 쓴다. 그 사람에게만 다 보낸다 */
export function screenOf(row: FilmRow, film: Film, visitor: string): { card: FilmCard; film: Film } {
  return { card: card(row, visitor), film: row.owner === visitor ? film : forScreen(film) };
}

/** 서버가 쓰는 필름. 디렉터가 쓴 그대로다 — 삶은 이것을 들고 간다. 화면으로 보내지 않는다.
    비공개 필름은 만든 사람이 아니면 없는 필름이다. 링크로 와도 보이지 않고 들어가지도 못한다 */
export async function loadFilm(ctx: Ctx, id: string): Promise<{ row: FilmRow; film: Film }> {
  const row = await ctx.db.first<FilmRow>(`SELECT ${COLS} FROM films WHERE id = ?`, id);
  if (!row || (row.private === 1 && row.owner !== ctx.visitor)) throw new Fail(404, 'film_missing', '필름을 찾을 수 없어요.');
  return { row, film: readFilm(JSON.parse(row.data) as Film) };
}

/** 필름을 지운다. 만든 사람만. 목록과 필름 정보에서 사라지고, 새로 들어갈 수 없다.
    이미 들어가 살던 삶은 그대로 이어진다 — 삶은 들어갈 때의 필름을 들고 간다. 그래서 그림과 소리도 지우지 않는다.
    만든 내용을 남기려면 화면이 지우기 전에 이 기기의 임시저장에 옮긴다 */
export async function dropFilm(ctx: Ctx, id: string): Promise<{ ok: true }> {
  const row = await ctx.db.first<{ owner: string }>('SELECT owner FROM films WHERE id = ?', id);
  if (!row || row.owner !== ctx.visitor) throw new Fail(404, 'film_missing', '필름을 찾을 수 없어요.');
  // 사람마다 이 필름에 고른 들어가는 사람도 이제 쓸 데가 없다
  await ctx.db.batch([q('DELETE FROM personas WHERE film_id = ?', id), q('DELETE FROM films WHERE id = ?', id)]);
  return { ok: true };
}
