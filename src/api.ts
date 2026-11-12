/* 서버와 말하는 곳. 화면은 세계를 들고 다니지 않는다 — 열쇠와 방문자 표만 들고 다닌다. */

import { type Box, outSide } from '../shared/crop';
import { RULES } from '../shared/rules';
import type { ApiError, Film, FilmCard, FilmMine, PlayCard, PlayView, SaveView } from '../shared/types';

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
  return send(canvas);
}

/** 사진에서 네모 하나를 잘라 올린다. 자르는 화면의 틀 안에 보이던 그대로다. 한 변이 max를 넘지 않게 줄인다 */
export async function uploadCrop(picture: CanvasImageSource, box: Box, max: number): Promise<string> {
  const side = outSide(box, max);
  const canvas = document.createElement('canvas');
  canvas.width = side;
  canvas.height = side;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(picture, box.x, box.y, box.side, box.side, 0, 0, side, side);
  return send(canvas);
}

/** 그려 둔 그림을 올린다. 정해진 크기에 들 때까지 질을 낮춘다 */
async function send(canvas: HTMLCanvasElement): Promise<string> {
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
  film: (id: string) => call<{ card: FilmCard; film: Film; mine: FilmMine }>('GET', `/api/films/${id}`),
  /** 들어가는 이름 고르기: 내 이름(me)이나 배역 이름(role) */
  chooseAs: (id: string, as: 'me' | 'role') => call<{ card: FilmCard; film: Film; mine: FilmMine }>('PUT', `/api/films/${id}/as`, { as }),
  /** 내 이름 */
  me: () => call<{ name: string }>('GET', '/api/me'),
  setMe: (name: string) => call<{ name: string }>('PUT', '/api/me', { name }),
  /** 피드를 연다. 이야기 전에 올려 둔 글이 없던 삶이면 그때 적는다 */
  openFeed: (playId: string) => call<PlayView>('POST', `/api/plays/${playId}/feed`, {}),
  /** 내 피드에 글을 올린다 */
  postMine: (playId: string, text: string) => call<PlayView>('POST', `/api/plays/${playId}/posts`, { text }),
  /** 장면 저장 */
  saves: (playId: string) => call<SaveView[]>('GET', `/api/plays/${playId}/saves`),
  makeSave: (playId: string) => call<SaveView[]>('POST', `/api/plays/${playId}/saves`, {}),
  loadSave: (playId: string, saveId: string) => call<PlayView>('POST', `/api/plays/${playId}/saves/${saveId}/load`, {}),
  dropSave: (playId: string, saveId: string) => call<SaveView[]>('POST', `/api/plays/${playId}/saves/${saveId}/drop`, {}),
  createFilm: (film: unknown) => call<{ id: string }>('POST', '/api/films', film),
  updateFilm: (id: string, film: unknown) => call<{ id: string }>('PUT', `/api/films/${id}`, film),
  enter: (filmId: string, playId: string) => call<PlayView>('POST', `/api/films/${filmId}/enter`, { playId }),
  plays: () => call<PlayCard[]>('GET', '/api/plays'),
  play: (id: string) => call<PlayView>('GET', `/api/plays/${id}`),
  /** 내 대사와 내 지문을 보낸다. 하나만 있어도 된다 */
  /** 대사와 지문을 함께 보낸다. 지문은 *별표* 사이에 쓴다 — 가르는 것은 서버가 한다 */
  say: (id: string, text: string, requestId: string) => call<PlayView>('POST', `/api/plays/${id}/say`, { text, requestId }),
  skip: (id: string, kind: 'evening' | 'sleep', requestId: string) =>
    call<PlayView>('POST', `/api/plays/${id}/skip`, { kind, requestId }),
  retry: (id: string) => call<PlayView>('POST', `/api/plays/${id}/retry`, {}),
  /** 내 삶에서 내 배역의 사진과 정보를 고친다 */
  setPersona: (id: string, mine: { name: string; line: string; face: string }) => call<PlayView>('POST', `/api/plays/${id}/persona`, mine),
  /** 하루가 끝난 삶을 다음 날로 잇는다 */
  next: (id: string) => call<PlayView>('POST', `/api/plays/${id}/next`, {}),
};
