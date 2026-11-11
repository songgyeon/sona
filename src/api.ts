/* 서버와 말하는 곳. 화면은 세계를 들고 다니지 않는다 — 열쇠와 방문자 표만 들고 다닌다. */

import type { ApiError, Film, FilmCard, PlayCard, PlayView } from '../shared/types';

const KEY = 'sona.key';
const VISITOR = 'sona.visitor';

// 저장소가 막힌 브라우저에서도 탭 안에서는 이어지게 메모리에도 둔다
const mem: Record<string, string> = {};

function read(k: string): string | null {
  if (mem[k]) return mem[k]!;
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}

function write(k: string, v: string): void {
  mem[k] = v;
  try {
    localStorage.setItem(k, v);
  } catch {
    /* 저장이 막혀 있으면 이 탭에서만 기억한다 */
  }
}

export function visitor(): string {
  let v = read(VISITOR);
  if (!v) {
    v = crypto.randomUUID();
    write(VISITOR, v);
  }
  return v;
}

export const getKey = (): string | null => read(KEY);
export const setKey = (k: string): void => write(KEY, k.trim());
export const newId = (): string => crypto.randomUUID();

export class ApiFail extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

async function call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers: {
        // 머리글에는 한글을 그대로 못 싣는다. 싸서 보내고 서버가 푼다
        'x-sona-key': encodeURIComponent(getKey() ?? ''),
        'x-sona-visitor': visitor(),
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiFail(0, 'network', '연결이 끊겼어. 다시 해 줘.');
  }
  const data = (await res.json().catch(() => null)) as (T & Partial<ApiError>) | null;
  if (!res.ok) {
    throw new ApiFail(res.status, data?.error ?? 'http', data?.message ?? '서버가 답하지 않았어.');
  }
  return data as T;
}

export const api = {
  key: () => call<{ ok: true; fake: boolean; modelReady: boolean }>('GET', '/api/key'),
  films: () => call<FilmCard[]>('GET', '/api/films'),
  film: (id: string) => call<{ card: FilmCard; film: Film }>('GET', `/api/films/${id}`),
  createFilm: (film: unknown) => call<{ id: string }>('POST', '/api/films', film),
  enter: (filmId: string, playId: string) => call<PlayView>('POST', `/api/films/${filmId}/enter`, { playId }),
  plays: () => call<PlayCard[]>('GET', '/api/plays'),
  play: (id: string) => call<PlayView>('GET', `/api/plays/${id}`),
  say: (id: string, room: string, text: string, requestId: string) =>
    call<PlayView>('POST', `/api/plays/${id}/say`, { room, text, requestId }),
  skip: (id: string, kind: 'short' | 'errand' | 'sleep', requestId: string) =>
    call<PlayView>('POST', `/api/plays/${id}/skip`, { kind, requestId }),
  retry: (id: string) => call<PlayView>('POST', `/api/plays/${id}/retry`, {}),
};
