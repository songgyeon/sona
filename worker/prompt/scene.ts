/* 프롬프트의 셋째 층 — 시나리오.
   지금 이 장면의 사실만 싣는다: 때, 이 인물이 아는 일, 최근 대화. */

import { type Clock, formatMin, partOfDay, worldAt } from '../../shared/clock';
import { DOW_NAMES } from '../../shared/rules';
import type { Cast, Film } from '../../shared/types';

export interface SceneEvent {
  at: number;
  text: string;
}

/** 지나간 장면의 한 조각. 지문에는 말한 사람이 없다 */
export interface SceneLine {
  kind: 'tell' | 'say' | 'msg';
  speaker: string; // 이름. 지문이면 빈 글자
  text: string;
  /** 유저가 맡은 인물의 말이면 참 — 받은 그대로 적는다 */
  mine: boolean;
}

export interface SceneInput {
  film: Film;
  cast: Cast;
  clock: Clock;
  /** 이 인물이 아는 일만. 거르는 것은 부르는 쪽이 한다 */
  events: SceneEvent[];
  /** 지나간 장면. 유저의 이번 말은 빼고 준다 */
  history: SceneLine[];
}

/** 프롬프트에 적는 때. 분 단위를 안 준다 — 주면 「7시 42분이네요」가 나온다 */
export function when(clock: Clock, at: number): string {
  const w = worldAt(clock, at);
  return `${DOW_NAMES[w.dow]} ${partOfDay(w.min)}`;
}

export function sceneLayer(s: SceneInput): string {
  const out: string[] = [];
  const now = worldAt(s.clock);

  out.push('[지금]');
  out.push(`${DOW_NAMES[now.dow]} ${partOfDay(now.min)}.`);

  const fs = s.film.firstScene;
  if (fs.place || fs.situation) {
    out.push('');
    out.push('[이야기가 시작된 자리]');
    out.push([fs.place, fs.situation].filter(Boolean).join(' — '));
  }

  if (s.events.length > 0) {
    out.push('');
    out.push('[네가 아는 일]');
    for (const e of s.events) out.push(`- (${when(s.clock, e.at)}) ${e.text}`);
  }

  if (s.history.length > 0) {
    out.push('');
    out.push('[지금까지의 장면]');
    for (const h of s.history) {
      if (h.kind === 'tell') out.push(h.text);
      else if (h.kind === 'msg') out.push(`${h.speaker}(메시지): ${h.text}`);
      else out.push(h.mine ? `${h.speaker}: ${h.text}` : `${h.speaker}: "${h.text}"`);
    }
  }

  return out.join('\n');
}

/** 「금요일 오후 4:03」 */
export function stamp(clock: Clock, at: number): string {
  const w = worldAt(clock, at);
  return `${DOW_NAMES[w.dow]} ${formatMin(w.min)}`;
}
