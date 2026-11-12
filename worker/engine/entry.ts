/* 필름에 들어가기 전 — 누구로 들어가나.
   필름 정보 화면에서 들어가는 사람을 고른다: 디렉터가 정한 배역(여럿이면 그 가운데 하나), 또는 내 페르소나.
   내 페르소나로 들어가도 배역 하나를 맡는다. 「유저 이름」 배역은 내 이름으로 맡는다.
   고른 것은 필름마다 기억하고(personas), 이 필름에서 살던 삶에도 적는다. */

import { rolesOf } from '../../shared/roles';
import type { Film, FilmCard, FilmMine } from '../../shared/types';
import { type Ctx, Fail } from './ctx';
import { loadFilm, screenOf } from './films';
import { myName } from './me';
import { getPersona } from './mypersonas';
import { catchUp, designate, fromPersona, type PersonaRow } from './designate';
import { type Mine, roleMine, type Saved, savedMine } from './persona';

/** 이 사람이 이 필름에 앉은 자리: 기억해 둔 내 배역(맡은 배역까지), 고른 내 페르소나, 내 이름 */
interface Seat {
  saved: Saved | null;
  persona: PersonaRow | null;
  name: string;
}

/** 자리를 한 번에 읽는다 — 따로 물으면 필름 정보 하나에 저장소를 일곱 번 오갔다 */
async function seatOf(ctx: Ctx, filmId: string): Promise<Seat> {
  const r = await ctx.db.first<{
    name: string | null;
    line: string | null;
    face: string | null;
    role: number | null;
    pid: string | null;
    pname: string | null;
    pline: string | null;
    pface: string | null;
    me: string | null;
  }>(
    `SELECT p.name, p.line, p.face, p.role, m.id AS pid, m.name AS pname, m.line AS pline, m.face AS pface,
       (SELECT v.name FROM visitors v WHERE v.id = ?) AS me
     FROM (SELECT 1) AS one
     LEFT JOIN personas p ON p.visitor = ? AND p.film_id = ?
     LEFT JOIN mypersonas m ON m.id = p.persona_id AND m.visitor = p.visitor`,
    ctx.visitor,
    ctx.visitor,
    filmId,
  );
  return {
    saved: r && r.name !== null ? { name: r.name, line: r.line ?? '', face: r.face ?? '', role: r.role ?? 0 } : null,
    persona: r && r.pid ? { id: r.pid, name: r.pname ?? '', line: r.pline ?? '', face: r.pface ?? '' } : null,
    name: r?.me ?? '',
  };
}

/** 이 사람이 이 필름에 들어가면 될 사람. 따로 고친 적이 없으면 디렉터가 정한 배역 그대로다.
    내 페르소나를 골랐으면 그 페르소나다(고른 페르소나가 지워졌으면 그때의 모습 그대로, 따로 고친 것으로 본다) */
function mineOf(film: Film, seat: Seat): FilmMine {
  const { saved, persona, name } = seat;
  const roles = rolesOf(film);
  const role = saved && roles[saved.role] ? saved.role : 0;
  const own = roleMine(roles[role]!, name);
  const base: Mine = saved ? { name: saved.name, line: saved.line, face: saved.face } : own;
  if (persona) return { ...base, as: 'me', personaId: persona.id, role };
  const as = base.name === own.name ? 'role' : name && base.name === name ? 'me' : 'custom';
  return { ...base, as, personaId: null, role };
}

/** 필름 정보 화면에 건네는 것: 필름, 그리고 이 필름에서의 내 배역 */
export async function filmView(ctx: Ctx, filmId: string): Promise<{ card: FilmCard; film: Film; mine: FilmMine }> {
  const { row, film: made } = await loadFilm(ctx, filmId);
  let seat = await seatOf(ctx, filmId);
  // 고른 페르소나를 그 뒤에 고쳤는데 아직 안 적혔으면 지금 맞춘다
  if (await catchUp(ctx, filmId, made, seat)) seat = await seatOf(ctx, filmId);
  return { ...screenOf(row, made, ctx.visitor), mine: mineOf(made, seat) };
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
