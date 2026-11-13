/* 임시저장한 필름을 두는 곳 — 이 브라우저의 저장소. 셈은 shared/draft.ts의 shelf에 있다.
   서버에도 사람마다 한 벌을 맞춰 둔다(syncDrafts) — 다른 기기에서 이어 하기로 같은 사람이 되면 어느 기기에서든 보인다.
   남기거나 지울 때마다 잠깐 모았다가 서버로 보낸다. 서버에 못 닿으면 이 기기 것만 쓰고, 다음에 맞출 때 보낸다. */

import { type Draft, editSlot, fromFilm, shelf } from '../shared/draft';
import { RULES } from '../shared/rules';
import type { Film } from '../shared/types';
import { api, newId } from './api';

const local = shelf(() => localStorage, newId, () => Date.now());

/** 서버로 보낼 자리. 쓰는 동안 자꾸 보내지 않게 잠깐 모은다 */
const pending = new Set<string>();
let timer: ReturnType<typeof setTimeout> | undefined;

async function flush(): Promise<void> {
  if (timer) clearTimeout(timer);
  timer = undefined;
  const ids = [...pending];
  pending.clear();
  const items = ids.map((id) => {
    const e = local.entry(id);
    // 자리가 없으면 지운 것이다(아무것도 적지 않아 비운 것도)
    return e ? { id, raw: e.raw, savedAt: e.savedAt, dropped: false } : { id, raw: '', savedAt: Date.now(), dropped: true };
  });
  for (let i = 0; i < items.length; i += RULES.drafts.batch) {
    const chunk = items.slice(i, i + RULES.drafts.batch);
    try {
      await api.putDrafts(chunk);
    } catch {
      // 못 보냈다. 다음에 맞출 때 다시 보낸다
      for (const it of chunk) pending.add(it.id);
    }
  }
}

function queue(id: string): void {
  pending.add(id);
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => void flush(), 1500);
}

// 다른 앱으로 가거나 창을 닫기 전에 모아 둔 것을 보낸다
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && pending.size > 0) void flush();
  });
}

export const drafts = {
  ...local,
  save(id: string, draft: Draft, filmId?: string): 'saved' | 'blank' | 'blocked' {
    const r = local.save(id, draft, filmId);
    if (r !== 'blocked') queue(id);
    return r;
  },
  drop(id: string): void {
    local.drop(id);
    queue(id);
  },
};

/** 서버에 맞춰 둔 임시저장을 받아 이 기기에 맞추고, 이 기기 쪽이 더 나중인 것은 보낸다. 못 닿으면 그냥 둔다 */
export async function syncDrafts(): Promise<void> {
  try {
    const server = await api.drafts();
    for (const id of local.merge(server)) pending.add(id);
    await flush();
  } catch {
    /* 서버에 못 닿으면 이 기기 것만 쓴다 */
  }
}

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
