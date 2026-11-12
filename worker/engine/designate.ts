/* 들어가는 사람으로 고른 내 페르소나와, 그 필름에서 쓰는 내 배역을 늘 맞춰 둔다.
   필름 정보에서 페르소나를 고르면 사람과 필름마다의 자리(personas)에 그 페르소나를 적어 둔다(persona_id).
   그 페르소나를 고치면(내 페르소나 화면에서든, 재생 중 내 배역 화면에서든) 그 페르소나로 들어가는 필름마다,
   그 필름에서 살던 삶마다 새 모습이 적힌다. 고른 페르소나는 하나다 — 고친 것이 따로 놀지 않는다. */

import { readFilm } from '../../shared/opening';
import type { Film } from '../../shared/types';
import { q, type Stmt } from '../db';
import { type Ctx, Fail } from './ctx';
import { loadFilm } from './films';
import { applyMine, type Mine } from './persona';

interface PersonaRow {
  id: string;
  name: string;
  line: string;
  face: string;
}

/** 페르소나로 들어갈 때의 내 배역. 사진이나 소개가 비어 있으면 배역의 것을 그대로 쓴다 */
export const fromPersona = (film: Film, p: PersonaRow): Mine => ({ name: p.name, line: p.line || film.persona.line, face: p.face || film.persona.face });

/** 이 필름의 내 배역을 mine으로 적는다: 사람과 필름마다의 자리, 이 사람이 이 필름에서 살던 삶들.
    personaId는 고른 내 페르소나(없으면 null — 배역이거나 따로 고친 것). 캐스트와 같은 이름이면 거절한다 */
export async function designate(ctx: Ctx, filmId: string, film: Film, mine: Mine, personaId: string | null): Promise<void> {
  applyMine(film, mine, true);
  const stmts: Stmt[] = [
    q(
      'INSERT INTO personas (visitor, film_id, name, line, face, updated_at, persona_id) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(visitor, film_id) DO UPDATE SET name = excluded.name, line = excluded.line, face = excluded.face, updated_at = excluded.updated_at, persona_id = excluded.persona_id',
      ctx.visitor,
      filmId,
      mine.name,
      mine.line,
      mine.face,
      ctx.now(),
      personaId,
    ),
  ];
  const plays = await ctx.db.all<{ id: string; film: string }>('SELECT id, film FROM plays WHERE owner = ? AND film_id = ?', ctx.visitor, filmId);
  for (const p of plays) {
    const lived = readFilm(JSON.parse(p.film) as Film);
    if (lived.persona.name === mine.name && lived.persona.line === mine.line && lived.persona.face === mine.face) continue;
    stmts.push(q('UPDATE plays SET film = ? WHERE id = ?', JSON.stringify(applyMine(lived, mine)), p.id));
  }
  await ctx.db.batch(stmts);
}

/** 이 사람이 이 필름에 고른 내 페르소나. 없거나 지워졌으면 null */
export async function chosenPersona(ctx: Ctx, filmId: string): Promise<PersonaRow | null> {
  return ctx.db.first<PersonaRow>(
    'SELECT m.id, m.name, m.line, m.face FROM personas p JOIN mypersonas m ON m.id = p.persona_id AND m.visitor = p.visitor WHERE p.visitor = ? AND p.film_id = ?',
    ctx.visitor,
    filmId,
  );
}

/** 이 필름의 내 배역이 고른 페르소나와 어긋나 있으면 맞춘다(전에 고친 것이 아직 안 적힌 필름). 맞췄으면 참 */
export async function catchUp(ctx: Ctx, filmId: string, film: Film): Promise<boolean> {
  const p = await chosenPersona(ctx, filmId);
  if (!p) return false;
  const want = fromPersona(film, p);
  const row = await ctx.db.first<Mine>('SELECT name, line, face FROM personas WHERE visitor = ? AND film_id = ?', ctx.visitor, filmId);
  if (row && row.name === want.name && row.line === want.line && row.face === want.face) return false;
  try {
    await designate(ctx, filmId, film, want, p.id);
    return true;
  } catch (e) {
    // 캐스트와 이름이 겹치는 필름. 전의 모습 그대로 둔다
    if (e instanceof Fail && e.code === 'persona_taken') return false;
    throw e;
  }
}

/** 내 페르소나를 고쳤다. 그 페르소나로 들어가는 필름마다 맞춘다. 캐스트와 이름이 겹치는 필름은 건너뛴다 */
export async function syncPersona(ctx: Ctx, personaId: string): Promise<void> {
  const rows = await ctx.db.all<{ film_id: string }>('SELECT film_id FROM personas WHERE visitor = ? AND persona_id = ?', ctx.visitor, personaId);
  for (const r of rows) {
    let film: Film;
    try {
      film = (await loadFilm(ctx, r.film_id)).film;
    } catch {
      continue;
    }
    await catchUp(ctx, r.film_id, film);
  }
}
