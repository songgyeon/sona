/* 먼저 오는 연락. 인물이 먼저 연락해도 되는지는 모델을 부르기 전에 코드가 정한다.
   정해진 횟수의 안부를 채우지 않는다 — 연락이 없는 날도 그 사람의 하루다. */

import { type Clock, DAY, inSpan, nextAt, worldAt } from '../../shared/clock';
import { RULES } from '../../shared/rules';
import type { Cast } from '../../shared/types';

export interface PingInput {
  /** 필름이 먼저 오는 연락을 여는가 */
  opens: boolean;
  clock: Clock;
  cast: Cast;
  /** 걸어 보려는 작중 시각 */
  slot: number;
  /** 이 방의 마지막 연락 시각. 없으면 null */
  lastContact: number | null;
  /** 건넬 얘깃거리가 있는가 */
  hasHook: boolean;
  /** 이번에 자리를 비운 동안 이미 보냈는가 */
  alreadySent: boolean;
}

/** 먼저 연락해도 되는가. 안 되면 까닭을 돌려준다 */
export function pingHeld(i: PingInput): string | null {
  if (!i.opens) return 'film_closed';
  if (i.slot >= RULES.trialMinutes) return 'trial_over';
  if (inSpan(worldAt(i.clock, i.slot).min, i.cast.sleepFrom, i.cast.sleepTo)) return 'asleep';
  if (i.lastContact !== null && i.slot - i.lastContact < RULES.ping.minGapMin) return 'too_soon';
  if (!i.hasHook) return 'nothing_to_say';
  if (i.alreadySent) return 'once';
  return null;
}

/** 먼저 걸어 볼 시각들. 코드가 정한다: 일어난 뒤, 저녁. 둘 다 구간 밖이면 가운데 */
export function pingSlots(clock: Clock, cast: Cast, from: number, to: number): number[] {
  const out = new Set<number>();
  const wake = nextAt(clock, (cast.sleepTo + RULES.ping.afterWakeMin) % DAY, from);
  if (wake <= to) out.add(wake);
  const evening = nextAt(clock, RULES.ping.eveningMin, from);
  if (evening <= to) out.add(evening);
  if (out.size === 0 && to - from >= 2 * RULES.gap.minSpanMin) out.add(from + Math.floor((to - from) / 2));
  return [...out].sort((a, b) => a - b);
}
