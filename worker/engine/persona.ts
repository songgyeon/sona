/* 내 배역 — 플레이하는 사람이 자기 삶에서 맡은 인물의 사진과 정보를 고친다.
   고친 것은 그 사람의 삶에만 적힌다. 디렉터의 필름은 그대로다.
   같은 필름에 다시 들어가도 이어지게, 사람과 필름마다 따로 기억해 둔다. */

import { renameIn } from '../../shared/ko';
import { RULES } from '../../shared/rules';
import type { Film, Persona, PlayView } from '../../shared/types';
import type { Db } from '../db';
import { type Ctx, Fail } from './ctx';
import { image, text } from './films';
import { loadPlay, viewOf } from './store';

export interface Mine {
  name: string;
  line: string;
  face: string;
}

/** 화면에서 온 것을 읽는다. 맞지 않으면 어느 칸인지 말하고 거절한다 */
export function readMine(input: { name?: unknown; line?: unknown; face?: unknown }): Mine {
  return {
    name: text(input.name, 20, '내 배역의 이름', true),
    line: text(input.line, RULES.limits.persona, '내 배역 설명'),
    face: image(input.face, '내 배역'),
  };
}

/** 이름에서 성을 뗀 것. 「문리현」→「리현」. 한글 세 글자가 아니면 이름 그대로다 */
const given = (name: string): string => (/^[가-힣]{3}$/.test(name) ? name.slice(1) : name);

/** 삶이 들고 있는 필름에 내 배역을 적는다.
    이름이 바뀌면 디렉터가 쓴 글 속의 이름도 함께 바꾼다 — 캐스트가 부르는 말, 오프닝, 배경.
    캐스트에게 그 사람은 처음부터 지금 이름이다. 전의 이름을 캐스트에게 알려 주지 않는다.
    살던 삶에서 바꿨으면(fresh가 아니면) 전의 이름을 적어 둔다 — 지나간 말 속에 그 이름이 남아 있어서,
    대사 모델에게 건넬 때 지금 이름으로 읽으려는 것이다(asNow). 새로 들어가는 삶에는 그럴 말이 없으니 적지 않는다 */
export function applyMine(film: Film, mine: Mine, fresh = false): Film {
  const old = film.persona.name;
  if (film.casts.some((c) => c.name === mine.name)) throw new Fail(400, 'persona_taken', '캐스트와 같은 이름은 쓸 수 없어요.');

  const persona: Persona = { name: mine.name, line: mine.line, face: mine.face };
  const formerly = [...(film.persona.formerly ?? []), ...(old === mine.name ? [] : [old])].filter((n, i, all) => n !== mine.name && all.indexOf(n) === i);
  if (!fresh && formerly.length > 0) persona.formerly = formerly.slice(-3);
  if (old === mine.name) return { ...film, persona };

  const names = film.casts.map((c) => c.name);
  const fix = (t: string) => renameIn(t, old, mine.name, names);
  // 부르는 말에는 성을 떼고 이름만 적는 일이 많다(「리현아」). 그 칸은 내 배역을 부르는 말이니, 이름만 적힌 것도 바꾼다
  const call = (t: string) => (given(old) === old ? fix(t) : renameIn(fix(t), given(old), given(mine.name), [...names, mine.name]));
  return {
    ...film,
    persona,
    setting: fix(film.setting),
    casts: film.casts.map((c) => ({
      ...c,
      role: fix(c.role),
      callsUser: call(c.callsUser),
      speech: fix(c.speech),
      nature: fix(c.nature),
      habit: fix(c.habit),
      trauma: fix(c.trauma),
      lack: fix(c.lack),
      secret: fix(c.secret),
      samples: c.samples.map(fix),
    })),
    ties: film.ties.map((t) => ({ ...t, relation: fix(t.relation) })),
    firstScene: {
      ...film.firstScene,
      beats: film.firstScene.beats.map((b) => (b.kind === 'cut' ? b : { ...b, text: fix(b.text) })),
      firstLine: fix(film.firstScene.firstLine),
    },
  };
}

/** 내 배역의 이름을 바꾸기 전에 적힌 글을 지금 이름으로 읽는다.
    저장된 말은 그대로 두고, 대사 모델에게 건넬 때만 쓴다 — 캐스트는 전의 이름을 모른다 */
export function asNow(film: Film): (text: string) => string {
  const before = film.persona.formerly ?? [];
  if (before.length === 0) return (text) => text;
  const keep = film.casts.map((c) => c.name);
  return (text) => before.reduce((t, old) => renameIn(t, old, film.persona.name, keep), text);
}

/** 이 사람이 이 필름에서 쓰던 내 배역. 없으면 null */
export async function savedMine(db: Db, visitor: string, filmId: string): Promise<Mine | null> {
  return db.first<Mine>('SELECT name, line, face FROM personas WHERE visitor = ? AND film_id = ?', visitor, filmId);
}

/** 내 배역을 고친다. 내 삶에서만 */
export async function setMine(ctx: Ctx, playId: string, input: { name?: unknown; line?: unknown; face?: unknown }): Promise<PlayView> {
  const play = await loadPlay(ctx, playId);
  const mine = readMine(input);
  const film = applyMine(play.film, mine);
  await ctx.db.batch([
    { sql: 'UPDATE plays SET film = ? WHERE id = ?', params: [JSON.stringify(film), playId] },
    {
      sql: 'INSERT INTO personas (visitor, film_id, name, line, face, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(visitor, film_id) DO UPDATE SET name = excluded.name, line = excluded.line, face = excluded.face, updated_at = excluded.updated_at',
      params: [ctx.visitor, play.filmId, mine.name, mine.line, mine.face, ctx.now()],
    },
  ]);
  return viewOf(ctx, playId);
}
