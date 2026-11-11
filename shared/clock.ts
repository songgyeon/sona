/* 작중 시간. 전부 순수 함수다 — 시계를 미는 것은 코드뿐이고 모델은 못 민다.

   저장하는 것은 셋이다: 시작 요일, 시작 시각(하루 중 분), 흐른 분(elapsed).
   「지금」은 저장하지 않고 읽을 때 셈한다. */

import { DOW_NAMES, RULES } from './rules';

export const DAY = 24 * 60;

export interface Clock {
  startDow: number;
  startMin: number;
  elapsed: number;
}

/** 시작한 날 0시에서 흐른 분 */
function abs(c: Clock, elapsed = c.elapsed): number {
  return c.startMin + elapsed;
}

export interface WorldNow {
  dow: number;
  /** 하루 중 분 */
  min: number;
  /** 시작한 날을 0으로 센 날짜 */
  day: number;
}

export function worldAt(c: Clock, elapsed = c.elapsed): WorldNow {
  const a = abs(c, elapsed);
  const day = Math.floor(a / DAY);
  return { dow: (c.startDow + day) % 7, min: ((a % DAY) + DAY) % DAY, day };
}

export function formatMin(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  const half = h < 12 ? '오전' : '오후';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${half} ${h12}:${String(m).padStart(2, '0')}`;
}

/** 「금요일 오후 4:03」 */
export function formatWorld(c: Clock, elapsed = c.elapsed): string {
  const w = worldAt(c, elapsed);
  return `${DOW_NAMES[w.dow]} ${formatMin(w.min)}`;
}

/** 프롬프트에는 분 단위를 안 준다 — 주면 「7시 42분이네요」가 나온다. 때만 준다 */
export function partOfDay(min: number): string {
  if (min < 5 * 60) return '새벽';
  if (min < 11 * 60) return '아침';
  if (min < 17 * 60) return '낮';
  if (min < 21 * 60) return '저녁';
  return '밤';
}

/** 지금 이후 처음 오는 「하루 중 target분」까지 흐른 분(elapsed 기준).
    지금이 정확히 그 시각이면 다음 날 것을 준다. */
export function nextAt(c: Clock, target: number, from = c.elapsed): number {
  const a = abs(c, from);
  const today = Math.floor(a / DAY) * DAY + target;
  const next = today > a ? today : today + DAY;
  return next - c.startMin;
}

/** 「오늘은」으로 그은 선이 풀리는 시각 — 다음 새벽 5시 */
export function endOfToday(c: Clock, from = c.elapsed): number {
  return nextAt(c, RULES.dayBoundaryMin, from);
}

/** 자고 오기 — 다음 아침 */
export function nextWake(c: Clock, from = c.elapsed): number {
  return nextAt(c, RULES.skip.wakeMin, from);
}

/** 하루 중 분이 [from, to) 구간에 드는가. 자정을 넘기는 구간(from > to)도 받는다 */
export function inSpan(min: number, from: number, to: number): boolean {
  if (from === to) return false;
  return from < to ? min >= from && min < to : min >= from || min < to;
}

export function trialOver(elapsed: number): boolean {
  return elapsed >= RULES.trialMinutes;
}
