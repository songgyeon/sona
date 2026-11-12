/* 오프닝 영상의 셈. 화면 없이 시험한다.
   컷마다 시작하는 때, 어느 때에 어느 컷이 보이는지, 서서히 넘어갈 때의 밝기, 움직임의 모양. */

import { RULES } from './rules';
import type { Reel, ReelClip, ReelMotion } from './types';

const R = RULES.reel;

/** 컷마다 시작하는 때(초) */
export const startsOf = (clips: ReelClip[]): number[] => {
  const out: number[] = [];
  let t = 0;
  for (const c of clips) {
    out.push(t);
    t += c.dur;
  }
  return out;
};

/** 영상 전체의 길이(초) */
export const lengthOf = (reel: Reel | null | undefined): number => (reel?.clips ?? []).reduce((n, c) => n + c.dur, 0);

/** 그때 보이는 컷의 차례. 끝이면 마지막 컷 */
export function clipAt(clips: ReelClip[], t: number): number {
  const starts = startsOf(clips);
  for (let i = clips.length - 1; i >= 0; i--) if (t >= starts[i]!) return i;
  return 0;
}

/** 한 컷 안에서 흐른 몫(0~1) */
export const progressIn = (clips: ReelClip[], i: number, t: number): number => {
  const c = clips[i];
  if (!c || c.dur <= 0) return 0;
  return Math.min(1, Math.max(0, (t - startsOf(clips)[i]!) / c.dur));
};

/** 그때 그 컷의 밝기(0~1). 서서히·검은 화면 거쳐 들어오면 처음에 밝아지고, 다음 컷이 검은 화면을 거쳐 오면 끝에서 어두워진다 */
export function opacityOf(clips: ReelClip[], i: number, t: number): number {
  const c = clips[i];
  if (!c) return 0;
  const start = startsOf(clips)[i]!;
  const local = t - start;
  const fade = Math.min(R.fade, c.dur / 2);
  let a = 1;
  if ((c.enter !== 'cut' || i === 0) && local < fade) a = Math.max(0, local / fade);
  const next = clips[i + 1];
  if (next?.enter === 'black' && c.dur - local < fade) a = Math.min(a, Math.max(0, (c.dur - local) / fade));
  return a;
}

/** 서서히 넘어오는 동안에는 앞 컷을 밑에 깔아 둔다. 그 앞 컷의 차례, 없으면 null */
export function underOf(clips: ReelClip[], i: number, t: number): number | null {
  const c = clips[i];
  if (!c || i === 0 || c.enter !== 'fade') return null;
  return t - startsOf(clips)[i]! < Math.min(R.fade, c.dur / 2) ? i - 1 : null;
}

/** 움직임: p(0~1)에서의 크기와 옆으로 간 몫(%) */
export function motionAt(motion: ReelMotion, p: number): { scale: number; x: number } {
  const z = 0.12;
  switch (motion) {
    case 'in':
      return { scale: 1 + z * p, x: 0 };
    case 'out':
      return { scale: 1 + z * (1 - p), x: 0 };
    case 'left':
      return { scale: 1 + z, x: 4 - 8 * p };
    case 'right':
      return { scale: 1 + z, x: -4 + 8 * p };
    default:
      return { scale: 1, x: 0 };
  }
}

/** 글자의 밝기: 컷의 처음과 끝에서 0.5초씩 서서히 */
export function textOpacity(clips: ReelClip[], i: number, t: number): number {
  const c = clips[i];
  if (!c?.text) return 0;
  const local = t - startsOf(clips)[i]!;
  const edge = Math.min(0.5, c.dur / 3);
  return Math.max(0, Math.min(1, local / edge, (c.dur - local) / edge));
}

/** 음악의 크기(0~1): 끝에서 줄어든다 */
export function musicVolume(reel: Reel, t: number): number {
  const total = lengthOf(reel);
  return Math.max(0, Math.min(1, (total - t) / R.fadeOut));
}

/** 새 컷 */
export const newClip = (kind: ReelClip['kind'], src = '', dur: number = R.dur): ReelClip => ({
  kind,
  src,
  dur,
  from: 0,
  motion: kind === 'image' ? 'in' : 'none',
  enter: 'fade',
  text: '',
  style: 'title',
  sound: kind === 'video',
});

export const blankReel = (): Reel => ({ ratio: 'tall', clips: [], music: '', musicName: '', musicFrom: 0 });
