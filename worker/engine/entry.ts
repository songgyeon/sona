/* 필름에 들어가기 전 — 누구로 들어가나.
   필름 정보 화면에서 들어가는 사람을 고른다: 디렉터가 정한 배역(여럿이면 그 가운데 하나), 또는 내 페르소나.
   내 페르소나로 들어가도 배역 하나를 맡는다. 「유저 이름」 배역은 내 이름으로 맡는다.
   고른 것은 필름마다 기억하고(personas), 이 필름에서 살던 삶에도 적는다. */

import { rolesOf } from '../../shared/roles';
import type { Film, FilmCard, FilmMine } from '../../shared/types';
import { type Ctx, Fail } from './ctx';
import { getFilm, loadFilm } from './films';
import { myName } from './me';
import { getPersona } from './mypersonas';
import { catchUp, chosenPersona, designate, fromPersona } from './designate';
import { type Mine, roleMine, savedMine } from './persona';

/** 이 사람이 이 필름에 들어가면 될 사람. 따로 고친 적이 없으면 디렉터가 정한 배역 그대로다.
    내 페르소나를 골랐으면 그 페르소나다(고른 페르소나가 지워졌으면 그때의 모습 그대로, 따로 고친 것으로 본다) */
async function mineFor(ctx: Ctx, filmId: string, film: Film): Promise<FilmMine> {
  const saved = await savedMine(ctx.db, ctx.visitor, filmId);
  const roles = rolesOf(film);
  const role = saved && roles[saved.role] ? saved.role : 0;
  const name = await myName(ctx.db, ctx.visitor);
  const own = roleMine(roles[role]!, name);
  const base: Mine = saved ? { name: saved.name, line: saved.line, face: saved.face } : own;
  const persona = await chosenPersona(ctx, filmId);
  if (persona) return { ...base, as: 'me', personaId: persona.id, role };
  const as = base.name === own.name ? 'role' : name && base.name === name ? 'me' : 'custom';
  return { ...base, as, personaId: null, role };
}

/** 필름 정보 화면에 건네는 것: 필름, 그리고 이 필름에서의 내 배역 */
export async function filmView(ctx: Ctx, filmId: string): Promise<{ card: FilmCard; film: Film; mine: FilmMine }> {
  const { card, film } = await getFilm(ctx, filmId);
  const { film: made } = await loadFilm(ctx, filmId);
  // 고른 페르소나를 그 뒤에 고쳤는데 아직 안 적혔으면 지금 맞춘다
  await catchUp(ctx, filmId, made);
  return { card, film, mine: await mineFor(ctx, filmId, made) };
}

/** 들어가는 사람을 고른다. role = 디렉터가 정한 배역, persona = 내 페르소나 가운데 하나(id), me = 입장권의 내 이름.
    배역이 여럿이면 role 칸에 맡을 배역의 차례를 준다(없으면 전에 맡던 배역).
    페르소나는 이름과 사진과 소개를 다 가져가고, 맡은 배역의 덧붙인 칸을 쓴다. 「유저 이름」 배역은 내 이름으로 맡는다.
    이 필름에서 살던 삶에도 적는다 — 캐스트에게 그 사람은 처음부터 이 이름이다 */
export async function chooseAs(ctx: Ctx, filmId: string, input: unknown): Promise<{ card: FilmCard; film: Film; mine: FilmMine }> {
  const o = (input && typeof input === 'object' ? input : {}) as { as?: unknown; id?: unknown; role?: unknown };
  if (o.as !== 'me' && o.as !== 'role' && o.as !== 'persona') throw new Fail(400, 'bad_as', '들어가는 이름을 골라 주세요.');
  const { film } = await loadFilm(ctx, filmId);
  const roles = rolesOf(film);
  const saved = await savedMine(ctx.db, ctx.visitor, filmId);
  const asked = typeof o.role === 'number' && Number.isInteger(o.role) ? o.role : -1;
  const role = roles[asked] ? asked : saved && roles[saved.role] ? saved.role : 0;
  const cast = roles[role]!;
  const name = await myName(ctx.db, ctx.visitor);
  let mine: Mine;
  let personaId: string | null = null;
  if (o.as === 'persona') {
    const persona = typeof o.id === 'string' ? await getPersona(ctx, o.id) : null;
    if (!persona) throw new Fail(404, 'persona_missing', '페르소나를 찾을 수 없어요.');
    mine = fromPersona(cast, persona);
    personaId = persona.id;
  } else if (o.as === 'role') {
    if (cast.player && !name) throw new Fail(400, 'no_name', '먼저 내 이름을 정해 주세요.');
    mine = roleMine(cast, name);
  } else {
    if (!name) throw new Fail(400, 'no_name', '먼저 내 이름을 정해 주세요.');
    const base: Mine = saved ?? roleMine(cast, name);
    mine = { name, line: base.line, face: base.face };
  }
  // 캐스트와 같은 이름이면 여기서 거절된다
  await designate(ctx, filmId, film, mine, personaId, role);
  return filmView(ctx, filmId);
}
