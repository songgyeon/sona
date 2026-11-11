/* 필름 — 디렉터가 쓴 것을 받아 확인하고 저장한다. */

import { RULES } from '../../shared/rules';
import type { Cast, Film, FilmCard, Tie } from '../../shared/types';
import { newId } from '../db';
import { isUuid } from '../guard';
import { type Ctx, Fail } from './ctx';

const L = RULES.limits;

function text(v: unknown, max: number, name: string, required = false): string {
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
function image(v: unknown, name: string): string {
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
      speech: text(c.speech, L.short, '말투'),
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

  const stills = (Array.isArray(f.stills) ? f.stills : []).map((s) => image(s, '컷')).filter((s) => s.length > 0);
  if (stills.length > L.stills) throw new Fail(400, 'film_invalid', `컷은 ${L.stills}장까지 넣을 수 있어요.`);

  return {
    title: text(f.title, L.title, '제목', true),
    logline: text(f.logline, L.logline, '한 줄 소개'),
    poster: image(f.poster, '포스터'),
    stills,
    setting: text(f.setting, L.setting, '배경'),
    startDow: int(f.startDow ?? 5, 0, 6, '시작 요일'),
    startMin: int(f.startMin ?? 16 * 60, 0, 1439, '시작 시각'),
    opens: { feed: opens.feed !== false, ping: opens.ping !== false },
    persona: {
      name: text(persona.name, 20, '내 배역의 이름', true),
      line: text(persona.line, L.short, '내 배역 설명'),
    },
    casts,
    ties,
    firstScene: {
      place: text(fs.place, 40, '첫 장면의 장소'),
      situation: text(fs.situation, L.opening, '첫 장면'),
      room,
      speaker: fs.speaker === 'cast' ? 'cast' : 'persona',
      firstLine: text(fs.firstLine, 200, '첫 대사'),
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

function card(row: FilmRow, visitor: string): FilmCard {
  const film = JSON.parse(row.data) as Film;
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

/** 내가 만든 필름과, 모두에게 보이게 걸어 둔 필름 */
export async function listFilms(ctx: Ctx): Promise<FilmCard[]> {
  const rows = await ctx.db.all<FilmRow>(
    'SELECT id, owner, title, logline, featured, data FROM films WHERE owner = ? OR featured = 1 ORDER BY featured DESC, created_at DESC',
    ctx.visitor,
  );
  return rows.map((r) => card(r, ctx.visitor));
}

/** 필름 하나. 주소를 아는 사람은 누구나 읽는다 — 링크를 받은 사람이 바로 들어올 수 있게.
    목록(listFilms)에는 여전히 만든 사람의 것만 나온다 */
export async function getFilm(ctx: Ctx, id: string): Promise<{ card: FilmCard; film: Film }> {
  const row = await ctx.db.first<FilmRow>('SELECT id, owner, title, logline, featured, data FROM films WHERE id = ?', id);
  if (!row) throw new Fail(404, 'film_missing', '필름을 찾을 수 없어요.');
  return { card: card(row, ctx.visitor), film: JSON.parse(row.data) as Film };
}
