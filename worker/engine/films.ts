/* 필름 — 디렉터가 쓴 것을 받아 확인하고 저장한다. */

import { RULES } from '../../shared/rules';
import { readFilm } from '../../shared/opening';
import type { Beat, Cast, Film, FilmCard, Tie } from '../../shared/types';
import { newId } from '../db';
import { isUuid } from '../guard';
import { type Ctx, Fail } from './ctx';

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

/** 화면에서 온 것을 필름으로 읽는다. 맞지 않으면 어느 칸인지 말하고 거절한다 */
export function parseFilm(input: unknown): Film {
  const f = obj(input);
  const persona = obj(f.persona);
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
    };
  });
  const names = new Set(casts.map((c) => c.name));
  if (names.size !== casts.length) throw new Fail(400, 'film_invalid', '캐스트 이름이 겹쳐요.');
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
    if (fs.beats.length > L.beats) throw new Fail(400, 'film_invalid', `오프닝은 ${L.beats}칸까지 쌓을 수 있어요.`);
    for (const raw of fs.beats) {
      const b = obj(raw);
      if (b.kind === 'cut') {
        const img = image(b.image, '컷');
        if (img) beats.push({ kind: 'cut', image: img });
      } else if (b.kind === 'tell') {
        const t = text(b.text, L.opening, '오프닝의 지문');
        if (t) beats.push({ kind: 'tell', text: t });
      } else if (b.kind === 'say') {
        const t = text(b.text, L.line, '오프닝의 대사');
        const who = text(b.cast, 4, '오프닝의 대사') || room;
        if (!keys.has(who)) throw new Fail(400, 'film_invalid', '오프닝에서 말하는 캐스트가 캐스트에 없어요.');
        if (t) beats.push({ kind: 'say', cast: who, text: t });
      } else {
        throw new Fail(400, 'film_invalid', '오프닝의 칸이 올바르지 않아요.');
      }
    }
    const total = beats.reduce((n, b) => n + (b.kind === 'cut' ? 0 : b.text.length), 0);
    if (total > L.opening) throw new Fail(400, 'film_invalid', `오프닝은 모두 합쳐 ${L.opening}자까지 쓸 수 있어요.`);
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
    startDow: int(f.startDow ?? 5, 0, 6, '시작 요일'),
    startMin: int(f.startMin ?? 16 * 60, 0, 1439, '시작 시각'),
    // 한편은 서로 볼 캐스트가 둘은 있어야 한다
    opens: { feed: opens.feed !== false, ping: opens.ping !== false, aside: opens.aside === true && casts.length > 1 },
    persona: {
      name: text(persona.name, 20, '내 배역의 이름', true),
      line: text(persona.line, L.persona, '내 배역 설명'),
      face: image(persona.face, '내 배역'),
    },
    casts,
    ties,
    firstScene: {
      place: text(fs.place, 40, '첫 장면의 장소'),
      beats,
      room,
      speaker: fs.speaker === 'cast' ? 'cast' : 'persona',
      firstLine,
    },
  };
}

interface FilmRow {
  id: string;
  owner: string;
  title: string;
  logline: string;
  featured: number;
  data: string;
}

export async function createFilm(ctx: Ctx, input: unknown): Promise<{ id: string }> {
  const film = parseFilm(input);
  const id = newId();
  await ctx.db.run(
    'INSERT INTO films (id, owner, title, logline, featured, data, created_at) VALUES (?, ?, ?, ?, 0, ?, ?)',
    id,
    ctx.visitor,
    film.title,
    film.logline,
    JSON.stringify(film),
    ctx.now(),
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
  await ctx.db.run('UPDATE films SET title = ?, logline = ?, data = ? WHERE id = ?', film.title, film.logline, JSON.stringify(film), id);
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
  };
}

/** 화면으로 보내는 필름. 성격부터 비밀까지는 디렉터만 보는 칸이라, 만든 사람이 고칠 때가 아니면 비워서 보낸다.
    대사 모델에게 건네는 필름은 서버에 있는 그대로다 */
export function forScreen(film: Film): Film {
  return { ...film, casts: film.casts.map((c) => ({ ...c, nature: '', habit: '', trauma: '', lack: '', secret: '' })) };
}

/** 개봉한 필름들. 누구에게나 보인다 — 어느 기기, 어느 길로 들어와도 같은 목록이다.
    시험하느라 만든 필름(제목으로 가린다)만 만든 사람에게만 보인다. 최근에 개봉한 것부터 */
export async function listFilms(ctx: Ctx): Promise<FilmCard[]> {
  const rows = await ctx.db.all<FilmRow>(
    'SELECT id, owner, title, logline, featured, data FROM films ORDER BY featured DESC, created_at DESC LIMIT 300',
  );
  const unlisted = (title: string) => RULES.unlisted.some((head) => title.startsWith(head));
  return rows.filter((r) => r.owner === ctx.visitor || !unlisted(r.title)).map((r) => card(r, ctx.visitor));
}

/** 필름 하나. 누구나 읽는다 */
export async function getFilm(ctx: Ctx, id: string): Promise<{ card: FilmCard; film: Film }> {
  const { row, film } = await loadFilm(ctx, id);
  // 고치는 화면은 만든 사람만 쓴다. 그 사람에게만 다 보낸다
  return { card: card(row, ctx.visitor), film: row.owner === ctx.visitor ? film : forScreen(film) };
}

/** 서버가 쓰는 필름. 디렉터가 쓴 그대로다 — 삶은 이것을 들고 간다. 화면으로 보내지 않는다 */
export async function loadFilm(ctx: Ctx, id: string): Promise<{ row: FilmRow; film: Film }> {
  const row = await ctx.db.first<FilmRow>('SELECT id, owner, title, logline, featured, data FROM films WHERE id = ?', id);
  if (!row) throw new Fail(404, 'film_missing', '필름을 찾을 수 없어요.');
  return { row, film: readFilm(JSON.parse(row.data) as Film) };
}
