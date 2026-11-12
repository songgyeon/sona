/* 임시저장한 필름을 두는 곳 — 이 브라우저의 저장소. 셈은 shared/draft.ts의 shelf에 있다. */

import { editSlot, fromFilm, shelf } from '../shared/draft';
import type { Film } from '../shared/types';
import { newId } from './api';

export const drafts = shelf(() => localStorage, newId, () => Date.now());

/** 개봉한 필름을 지우기 전에 임시저장으로 옮긴다. 새 필름으로 남는다 — 다시 개봉하면 새 필름이 된다.
    고치다 남겨 둔 것이 있으면 그것을(더 나중 것이다), 없으면 개봉한 그대로를 옮긴다. 남기지 못했으면 거짓 */
export function shelveFilm(filmId: string, film: Film, isPrivate: boolean): boolean {
  const editing = drafts.load(editSlot(filmId));
  const draft = editing ? editing.draft : { ...fromFilm(film), private: isPrivate };
  if (drafts.save(newId(), draft) !== 'saved') return false;
  drafts.drop(editSlot(filmId));
  return true;
}

/** 필름을 지운다. keep이면 먼저 임시저장으로 옮긴다. 못 지웠으면 까닭을 돌려준다 */
export async function dropFilmFlow(filmId: string, keep: boolean, load: () => Promise<{ film: Film; isPrivate: boolean }>, drop: () => Promise<unknown>): Promise<string | null> {
  if (keep) {
    const { film, isPrivate } = await load();
    if (!shelveFilm(filmId, film, isPrivate)) return '임시저장하지 못해서 지우지 않았어요.';
  } else {
    drafts.drop(editSlot(filmId));
  }
  await drop();
  return null;
}
