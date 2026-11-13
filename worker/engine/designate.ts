/* 들어가는 사람으로 고른 내 페르소나와, 그 필름에서 쓰는 내 배역을 늘 맞춰 둔다.
   필름 정보에서 페르소나를 고르면 사람과 필름마다의 자리(personas)에 그 페르소나를 적어 둔다(persona_id).
   그 페르소나를 고치면(내 페르소나 화면에서든, 재생 중 내 배역 화면에서든) 그 페르소나로 들어가는 필름마다,
   그 필름에서 살던 삶마다 새 모습이 적힌다. 고른 페르소나는 하나다 — 고친 것이 따로 놀지 않는다. */

import { renameIn } from '../../shared/ko';
import { readFilm } from '../../shared/opening';
import { rolesOf, withRole } from '../../shared/roles';
import type { Film, Persona } from '../../shared/types';
import { q, type Stmt } from '../db';
import { type Ctx, Fail } from './ctx';
import { loadFilm } from './films';
import { applyMine, type Mine, type Saved, savedMine } from './persona';

export interface PersonaRow {
  id: string;
  name: string;
  line: string;
  face: string;
}

/** 페르소나로 배역을 맡을 때의 내 배역. 사진이나 소개가 비어 있으면 배역의 것을 그대로 쓴다 */
export const fromPersona = (role: Persona, p: PersonaRow): Mine => ({ name: p.name, line: p.line || role.line, face: p.face || role.face });

/** 맡을 배역의 덧붙인 칸. 글 속의 배역 이름을 내 이름으로 읽는다 */
const roleExtras = (film: Film, role: Persona, name: string) =>
  (role.extras ?? []).map((e) => ({ ...e, text: renameIn(e.text, role.name, name, film.casts.map((c) => c.name)) }));

/** 이 필름의 내 배역을 mine으로 적는다: 사람과 필름마다의 자리, 이 사람이 이 필름에서 살던 삶들.
    personaId는 고른 내 페르소나(없으면 null — 배역이거나 따로 고친 것). role은 맡은 배역(0 = 첫째 배역).
    맡은 배역이 바뀌면 살던 삶에도 그 배역의 덧붙인 칸이 간다. 캐스트와 같은 이름이면 거절한다 */
export async function designate(ctx: Ctx, filmId: string, film: Film, mine: Mine, personaId: string | null, role = 0): Promise<void> {
  const r = rolesOf(film)[role] ? role : 0;
  applyMine(withRole(film, r), mine, true);
  const before = await savedMine(ctx.db, ctx.visitor, filmId);
  const moved = (before?.role ?? 0) !== r;
  // 맡은 배역이 바뀌면 그 배역의 덧붙인 칸과 나이·직업·대표 대사가 간다
  const to = rolesOf(film)[r]!;
  const next: Mine = moved ? { ...mine, extras: roleExtras(film, to, mine.name), age: to.age ?? '', job: to.job ?? '', quote: to.quote ?? '' } : mine;
  const stmts: Stmt[] = [
    q(
      'INSERT INTO personas (visitor, film_id, name, line, face, updated_at, persona_id, role) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(visitor, film_id) DO UPDATE SET name = excluded.name, line = excluded.line, face = excluded.face, updated_at = excluded.updated_at, persona_id = excluded.persona_id, role = excluded.role',
      ctx.visitor,
      filmId,
      mine.name,
      mine.line,
      mine.face,
      ctx.now(),
      personaId,
      r,
    ),
  ];
  const plays = await ctx.db.all<{ id: string; film: string }>('SELECT id, film FROM plays WHERE owner = ? AND film_id = ?', ctx.visitor, filmId);
  for (const p of plays) {
    const lived = readFilm(JSON.parse(p.film) as Film);
    if (!moved && lived.persona.name === mine.name && lived.persona.line === mine.line && lived.persona.face === mine.face) continue;
    stmts.push(q('UPDATE plays SET film = ? WHERE id = ?', JSON.stringify(applyMine(lived, next)), p.id));
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

/** 이 필름의 내 배역이 고른 페르소나와 어긋나 있으면 맞춘다(전에 고친 것이 아직 안 적힌 필름). 맞췄으면 참.
    known은 이미 읽어 둔 고른 페르소나와 기억해 둔 내 배역이다 — 주면 다시 읽지 않는다 */
export async function catchUp(ctx: Ctx, filmId: string, film: Film, known?: { persona: PersonaRow | null; saved: Saved | null }): Promise<boolean> {
  const p = known ? known.persona : await chosenPersona(ctx, filmId);
  if (!p) return false;
  const row = known ? known.saved : await savedMine(ctx.db, ctx.visitor, filmId);
  const role = row && rolesOf(film)[row.role] ? row.role : 0;
  const want = fromPersona(rolesOf(film)[role]!, p);
  if (row && row.name === want.name && row.line === want.line && row.face === want.face) return false;
  try {
    await designate(ctx, filmId, film, want, p.id, role);
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
