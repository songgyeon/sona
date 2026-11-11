/* 서버와 말하는 곳. 화면은 세계를 들고 다니지 않는다 — 열쇠와 방문자 표만 들고 다닌다. */

import { RULES } from '../shared/rules';
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

async function call<T>(method: 'GET' | 'POST' | 'PUT', path: string, body?: unknown): Promise<T> {
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
    throw new ApiFail(0, 'network', '연결이 끊겼어요. 다시 시도해 주세요.');
  }
  const data = (await res.json().catch(() => null)) as (T & Partial<ApiError>) | null;
  if (!res.ok) {
    throw new ApiFail(res.status, data?.error ?? 'http', data?.message ?? '서버가 응답하지 않았어요.');
  }
  return data as T;
}

/** 올려 둔 그림의 주소 */
export const imgUrl = (id: string): string => `/api/img/${id}`;

/** 그림을 줄여서 올린다. 긴 쪽이 max를 넘지 않게 하고, 정해진 크기에 들 때까지 질을 낮춘다 */
export async function uploadImage(file: File, max = 1280): Promise<string> {
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) throw new ApiFail(400, 'image_broken', '그림 파일을 읽지 못했어요.');
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

  let blob: Blob | null = null;
  for (const quality of [0.86, 0.76, 0.66, 0.56]) {
    blob = await new Promise<Blob | null>((done) => canvas.toBlob(done, 'image/jpeg', quality));
    if (blob && blob.size <= RULES.limits.image) break;
  }
  if (!blob || blob.size > RULES.limits.image) throw new ApiFail(413, 'image_big', '그림이 너무 커요.');

  let res: Response;
  try {
    res = await fetch('/api/img', {
      method: 'POST',
      headers: { 'content-type': 'image/jpeg', 'x-sona-key': encodeURIComponent(getKey() ?? ''), 'x-sona-visitor': visitor() },
      body: blob,
    });
  } catch {
    throw new ApiFail(0, 'network', '연결이 끊겼어요. 다시 시도해 주세요.');
  }
  const data = (await res.json().catch(() => null)) as ({ id?: string } & Partial<ApiError>) | null;
  if (!res.ok || !data?.id) throw new ApiFail(res.status, data?.error ?? 'http', data?.message ?? '그림을 올리지 못했어요.');
  return data.id;
}

export const api = {
  key: () => call<{ ok: true; fake: boolean; modelReady: boolean }>('GET', '/api/key'),
  films: () => call<FilmCard[]>('GET', '/api/films'),
  film: (id: string) => call<{ card: FilmCard; film: Film }>('GET', `/api/films/${id}`),
  createFilm: (film: unknown) => call<{ id: string }>('POST', '/api/films', film),
  updateFilm: (id: string, film: unknown) => call<{ id: string }>('PUT', `/api/films/${id}`, film),
  enter: (filmId: string, playId: string) => call<PlayView>('POST', `/api/films/${filmId}/enter`, { playId }),
  plays: () => call<PlayCard[]>('GET', '/api/plays'),
  play: (id: string) => call<PlayView>('GET', `/api/plays/${id}`),
  say: (id: string, room: string, text: string, requestId: string) =>
    call<PlayView>('POST', `/api/plays/${id}/say`, { room, text, requestId }),
  skip: (id: string, kind: 'evening' | 'sleep', requestId: string) =>
    call<PlayView>('POST', `/api/plays/${id}/skip`, { kind, requestId }),
  retry: (id: string) => call<PlayView>('POST', `/api/plays/${id}/retry`, {}),
  /** 내 삶에서 내 배역의 사진과 정보를 고친다 */
  setPersona: (id: string, mine: { name: string; line: string; face: string }) => call<PlayView>('POST', `/api/plays/${id}/persona`, mine),
  /** 하루가 끝난 삶을 다음 날로 잇는다 */
  next: (id: string) => call<PlayView>('POST', `/api/plays/${id}/next`, {}),
};
