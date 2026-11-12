/* 내 배역 — 필름에 배역이 여럿일 수 있다. 들어가는 사람이 그 가운데 하나를 맡는다. 계산뿐이다.
   「유저 이름」 배역은 들어가는 사람의 이름이 그 배역의 이름이 된다.
   디렉터는 그 배역을 글(오프닝, 배경, 캐스트 카드)에 대신 쓰는 이름으로 적는다 — 비워 두면 RULES.playerName이다. */

import { RULES } from './rules';
import type { Film, Persona } from './types';

/** 필름의 배역 전부. 첫째가 film.persona다 */
export const rolesOf = (film: Film): Persona[] => [film.persona, ...(film.roles ?? [])];

/** r번째 배역을 맡은 필름. 없는 배역이면 첫째 배역이다. 다른 배역은 뺀다 — 삶에는 맡은 배역 하나만 간다 */
export function withRole(film: Film, r: number): Film {
  const role = rolesOf(film)[r] ?? film.persona;
  return { ...film, persona: role, roles: [] };
}

/** 「유저 이름」 배역을 글에 대신 쓰는 이름 */
export const standIn = (role: { name: string }): string => role.name.trim() || RULES.playerName;

/** 배역을 보이는 이름. 「유저 이름」 배역은 들어가는 사람의 이름이다. 아직 이름을 정하지 않았으면 「유저 이름」 */
export const shownName = (role: Persona, myName: string): string => (role.player ? myName || '유저 이름' : role.name);
