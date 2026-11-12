/* 오프닝 영상의 글자 글꼴을 받는다(목록은 shared/fonts.ts). 쓰는 글꼴만 걸고, 글꼴 파일은 글자 묶음마다 나뉘어 있어서
   화면에 그리는 글자의 조각만 받는다. 프리텐다드와 본명조는 앱에 처음부터 걸려 있다. */

import { fontOf } from '../shared/fonts';

const LOAD: Record<string, () => Promise<unknown>> = {
  'nanum-myeongjo': () => import('./fonts/nanum-myeongjo.css'),
  'gowun-batang': () => import('./fonts/gowun-batang.css'),
  'song-myung': () => import('./fonts/song-myung.css'),
  'black-han-sans': () => import('./fonts/black-han-sans.css'),
  'do-hyeon': () => import('./fonts/do-hyeon.css'),
  jua: () => import('./fonts/jua.css'),
  'gowun-dodum': () => import('./fonts/gowun-dodum.css'),
  'nanum-pen-script': () => import('./fonts/nanum-pen-script.css'),
  'nanum-brush-script': () => import('./fonts/nanum-brush-script.css'),
  'east-sea-dokdo': () => import('./fonts/east-sea-dokdo.css'),
};
const loading = new Map<string, Promise<unknown>>();

/** 이 글꼴들을 건다. 한 번 건 것은 다시 걸지 않는다 */
export function loadFonts(keys: string[]): Promise<void> {
  return Promise.all(
    [...new Set(keys)].map((k) => {
      const load = LOAD[k];
      if (!load) return null;
      if (!loading.has(k)) loading.set(k, load().catch(() => loading.delete(k)));
      return loading.get(k);
    }),
  ).then(() => {});
}

/** 글자들을 그릴 글꼴 조각까지 받아 둔다. 오래 걸리면 정해진 때에 그만 기다린다 */
export async function readyFonts(layers: { font: string; text: string }[], ms = 4000): Promise<void> {
  if (layers.length === 0) return;
  await loadFonts(layers.map((l) => l.font));
  if (typeof document === 'undefined' || !document.fonts) return;
  const all = Promise.all(
    layers.map((l) => {
      const f = fontOf(l.font);
      return document.fonts.load(`${f.weight} 32px ${f.family}`, l.text || '가').catch(() => []);
    }),
  );
  await Promise.race([all, new Promise((ok) => setTimeout(ok, ms))]);
}
