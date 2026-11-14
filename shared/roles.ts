/* 내 배역 — 필름에 배역이 여럿일 수 있다. 들어가는 사람이 그 가운데 하나를 맡는다. 계산뿐이다.
   「유저 이름」 배역은 들어가는 사람의 이름이 그 배역의 이름이 된다.
   디렉터는 그 배역을 글(오프닝, 배경, 캐스트 카드)에 대신 쓰는 이름으로 적는다 — 비워 두면 RULES.playerName이다. */

import { fillMark } from './ko';
import { RULES } from './rules';
import type { Extra, Film, FilmCard, Persona } from './types';

/** 필름의 배역 전부. 첫째가 film.persona다 */
export const rolesOf = (film: Film): Persona[] => [film.persona, ...(film.roles ?? [])];

/** r번째 배역을 맡은 필름. 없는 배역이면 첫째 배역이다. 다른 배역은 뺀다 — 삶에는 맡은 배역 하나만 간다 */
export function withRole(film: Film, r: number): Film {
  const role = rolesOf(film)[r] ?? film.persona;
  return { ...film, persona: role, roles: [] };
}

/** 「유저 이름」 배역을 글에 대신 쓰는 이름 */
export const standIn = (role: { name: string }): string => role.name.trim() || RULES.playerName;

/** 디렉터가 글에 쓰는 {{user}}. 띄어 쓰거나 대문자로 적어도 같다 */
const USER_MARK = /\{\{\s*user\s*\}\}/i;

/** 이름이 아직 없으면 「나」다 */
const nameOr = (name: string): string => (name.trim() && !USER_MARK.test(name) ? name.trim() : '나');

/** 글 속의 {{user}}를 들어가는 사람의 이름으로 읽는다. 뒤에 붙은 조사는 그 이름의 받침에 맞춘다 */
export const fillUser = (text: string, name: string): string => (text && USER_MARK.test(text) ? fillMark(text, USER_MARK, nameOr(name)) : text);

/** 필름의 글 전부에서 {{user}}를 그 이름으로 읽는다: 제목, 한 줄 소개, 배경, 덧붙인 칸, 배역과 캐스트의 칸, 사이, 첫 장면, 오프닝 영상의 글자.
    이름을 주지 않으면 그 필름의 내 배역 이름이다 — 삶이 들고 가는 필름이 그렇다.
    배역과 캐스트의 이름 칸은 건드리지 않는다(「유저 이름」 배역의 이름 칸은 대신 쓰는 이름이다) */
export function fillFilm(film: Film, name: string = film.persona.name): Film {
  const f = (t: string) => fillUser(t, name);
  const ex = (list: Extra[]) => list.map((e) => ({ ...e, label: f(e.label), text: f(e.text) }));
  const person = (p: Persona): Persona => ({
    ...p,
    line: f(p.line),
    ...(p.extras ? { extras: ex(p.extras) } : {}),
    ...(p.age !== undefined ? { age: f(p.age) } : {}),
    ...(p.job !== undefined ? { job: f(p.job) } : {}),
    ...(p.quote !== undefined ? { quote: f(p.quote) } : {}),
  });
  return {
    ...film,
    title: f(film.title),
    logline: f(film.logline),
    setting: f(film.setting),
    ...(film.extras ? { extras: ex(film.extras) } : {}),
    persona: person(film.persona),
    ...(film.roles ? { roles: film.roles.map(person) } : {}),
    casts: film.casts.map((c) => ({
      ...c,
      aliases: (c.aliases ?? []).map(f),
      role: f(c.role),
      age: f(c.age ?? ''),
      job: f(c.job ?? ''),
      quote: f(c.quote ?? ''),
      intro: f(c.intro),
      callsUser: f(c.callsUser),
      speech: f(c.speech),
      nature: f(c.nature),
      habit: f(c.habit),
      trauma: f(c.trauma),
      lack: f(c.lack),
      secret: f(c.secret),
      samples: (c.samples ?? []).map(f),
      dayPlace: f(c.dayPlace),
      extras: ex(c.extras ?? []),
      ...(c.photos ? { photos: c.photos.map((p) => ({ ...p, about: f(p.about) })) } : {}),
    })),
    ties: film.ties.map((t) => ({ ...t, relation: f(t.relation), calls: f(t.calls) })),
    firstScene: {
      ...film.firstScene,
      place: f(film.firstScene.place),
      beats: film.firstScene.beats.map((b) => (b.kind === 'cut' ? b : { ...b, text: f(b.text) })),
      firstLine: f(film.firstScene.firstLine),
    },
    ...(film.incidents ? { incidents: film.incidents.map((e) => ({ ...e, text: f(e.text) })) } : {}),
    ...(film.reel ? { reel: { ...film.reel, clips: film.reel.clips.map((c) => ({ ...c, text: f(c.text), ...(c.texts ? { texts: c.texts.map((t) => ({ ...t, text: f(t.text) })) } : {}) })) } } : {}),
  };
}

/** 필름 목록의 한 칸도 같다. 목록에서는 내 이름으로 읽는다 */
export const fillCard = (card: FilmCard, name: string): FilmCard => ({ ...card, title: fillUser(card.title, name), logline: fillUser(card.logline, name), personaLine: fillUser(card.personaLine, name) });

/** 배역을 보이는 이름. 「유저 이름」 배역은 들어가는 사람의 이름이다. 아직 이름을 정하지 않았으면 「유저 이름」 */
export const shownName = (role: Persona, myName: string): string => (role.player ? myName || '유저 이름' : role.name);
