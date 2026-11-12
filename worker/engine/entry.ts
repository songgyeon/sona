/* 필름에 들어가기 전 — 누구로 들어가나.
   필름 정보 화면에서 「들어가는 이름」을 고른다: 내 이름이나, 디렉터가 정한 배역 이름.
   고른 것은 필름마다 기억하고(personas), 이 필름에서 살던 삶에도 적는다. */

import { readFilm } from '../../shared/opening';
import type { Film, FilmCard, FilmMine } from '../../shared/types';
import { q, type Stmt } from '../db';
import { type Ctx, Fail } from './ctx';
import { getFilm, loadFilm } from './films';
import { myName } from './me';
import { getPersona, listPersonas } from './mypersonas';
import { applyMine, type Mine, savedMine } from './persona';

/** 이 사람이 이 필름에 들어가면 될 사람. 따로 고친 적이 없으면 디렉터가 정한 배역 그대로다 */
async function mineFor(ctx: Ctx, filmId: string, film: Film): Promise<FilmMine> {
  const saved = await savedMine(ctx.db, ctx.visitor, filmId);
  const base: Mine = saved ?? { name: film.persona.name, line: film.persona.line, face: film.persona.face };
  const name = await myName(ctx.db, ctx.visitor);
  // 내 페르소나 가운데 이름이 같은 것이 있으면 그 페르소나로 들어가는 것이다
  const persona = (await listPersonas(ctx)).find((p) => p.name === base.name) ?? null;
  const as = base.name === film.persona.name ? 'role' : persona || (name && base.name === name) ? 'me' : 'custom';
  return { ...base, as, personaId: as === 'role' ? null : (persona?.id ?? null) };
}

/** 필름 정보 화면에 건네는 것: 필름, 그리고 이 필름에서의 내 배역 */
export async function filmView(ctx: Ctx, filmId: string): Promise<{ card: FilmCard; film: Film; mine: FilmMine }> {
  const { card, film } = await getFilm(ctx, filmId);
  const { film: made } = await loadFilm(ctx, filmId);
  return { card, film, mine: await mineFor(ctx, filmId, made) };
}

/** 들어가는 사람을 고른다. role = 디렉터가 정한 배역, persona = 내 페르소나 가운데 하나(id), me = 입장권의 내 이름.
    페르소나는 이름과 사진과 소개를 다 가져간다. 배역과 내 이름은 이름만 바꾼다.
    이 필름에서 살던 삶에도 적는다 — 캐스트에게 그 사람은 처음부터 이 이름이다 */
export async function chooseAs(ctx: Ctx, filmId: string, input: unknown): Promise<{ card: FilmCard; film: Film; mine: FilmMine }> {
  const o = (input && typeof input === 'object' ? input : {}) as { as?: unknown; id?: unknown };
  if (o.as !== 'me' && o.as !== 'role' && o.as !== 'persona') throw new Fail(400, 'bad_as', '들어가는 이름을 골라 주세요.');
  const { film } = await loadFilm(ctx, filmId);
  const saved = await savedMine(ctx.db, ctx.visitor, filmId);
  const base: Mine = saved ?? { name: film.persona.name, line: film.persona.line, face: film.persona.face };
  let mine: Mine;
  if (o.as === 'persona') {
    const persona = typeof o.id === 'string' ? await getPersona(ctx, o.id) : null;
    if (!persona) throw new Fail(404, 'persona_missing', '페르소나를 찾을 수 없어요.');
    // 페르소나에 사진이나 소개가 비어 있으면 배역의 것을 그대로 쓴다
    mine = { name: persona.name, line: persona.line || film.persona.line, face: persona.face || film.persona.face };
  } else if (o.as === 'role') {
    mine = { name: film.persona.name, line: film.persona.line, face: film.persona.face };
  } else {
    const name = await myName(ctx.db, ctx.visitor);
    if (!name) throw new Fail(400, 'no_name', '먼저 내 이름을 정해 주세요.');
    mine = { name, line: base.line, face: base.face };
  }
  // 캐스트와 같은 이름이면 여기서 거절된다
  applyMine(film, mine, true);

  const stmts: Stmt[] = [
    q(
      'INSERT INTO personas (visitor, film_id, name, line, face, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(visitor, film_id) DO UPDATE SET name = excluded.name, line = excluded.line, face = excluded.face, updated_at = excluded.updated_at',
      ctx.visitor,
      filmId,
      mine.name,
      mine.line,
      mine.face,
      ctx.now(),
    ),
  ];
  const plays = await ctx.db.all<{ id: string; film: string }>('SELECT id, film FROM plays WHERE owner = ? AND film_id = ?', ctx.visitor, filmId);
  for (const p of plays) {
    const lived = readFilm(JSON.parse(p.film) as Film);
    if (lived.persona.name === mine.name && lived.persona.line === mine.line && lived.persona.face === mine.face) continue;
    stmts.push(q('UPDATE plays SET film = ? WHERE id = ?', JSON.stringify(applyMine(lived, mine)), p.id));
  }
  await ctx.db.batch(stmts);
  return filmView(ctx, filmId);
}
