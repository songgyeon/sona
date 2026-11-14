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
  // 이야기 전 며칠(흐른 분이 음수)은 시작 요일보다 앞 주로 넘어갈 수 있다. 음수 요일을 한 바퀴 돌린다
  // (2026-11-13: 월요일에 시작하는 필름의 토요일 밤 피드가 「undefined 오후 11:07」로 떴고, 대사 모델에게도 「undefined 밤」으로 갔다)
  return { dow: (((c.startDow + day) % 7) + 7) % 7, min: ((a % DAY) + DAY) % DAY, day };
}

export function formatMin(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  const half = h < 12 ? '오전' : '오후';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${half} ${h12}:${String(m).padStart(2, '0')}`;
}

/** 요일과 시각. 「금요일 오후 4:03」.
    자정부터 1시 전까지는 앞 요일의 밤으로 적는다 — 「목요일 오전 12:00」이 아니라 「수요일 밤 12:00」.
    사람들이 그렇게 말하고, 「목요일 밤 12:00」으로 적으면 목요일이 끝나는 자정으로 읽힌다(2026-11-14 리뷰: 「목요일 오전 12:00」이 어색하다) */
export function formatDowMin(dow: number, min: number): string {
  if (min < 60) return `${DOW_NAMES[(dow + 6) % 7]} 밤 12:${String(min).padStart(2, '0')}`;
  return `${DOW_NAMES[dow]} ${formatMin(min)}`;
}

/** 요일과 때. 「금요일 저녁」. 자정부터 1시 전까지는 시각과 같이 앞 요일의 밤이다(formatDowMin) */
export function dowPart(dow: number, min: number): string {
  if (min < 60) return `${DOW_NAMES[(dow + 6) % 7]} 밤`;
  return `${DOW_NAMES[dow]} ${partOfDay(min)}`;
}

/** 「금요일 오후 4:03」 */
export function formatWorld(c: Clock, elapsed = c.elapsed): string {
  const w = worldAt(c, elapsed);
  return formatDowMin(w.dow, w.min);
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

/** 저녁으로 — 다음에 오는 저녁 */
export function nextEvening(c: Clock, from = c.elapsed): number {
  return nextAt(c, RULES.skip.eveningMin, from);
}

/** 하루 중 분이 [from, to) 구간에 드는가. 자정을 넘기는 구간(from > to)도 받는다 */
export function inSpan(min: number, from: number, to: number): boolean {
  if (from === to) return false;
  return from < to ? min >= from && min < to : min >= from || min < to;
}

/** 이 삶이 지금까지 열어 둔 날의 끝(작중 분). 첫 하루는 하루, 다음 날로 이을 때마다 하루씩 는다 */
export const dayEnd = (days = 1): number => RULES.trialMinutes * days;

/** 열어 둔 날이 다 찼는가 */
export function trialOver(elapsed: number, days = 1): boolean {
  return elapsed >= dayEnd(days);
}

const DAY_NAMES = ['첫 하루', '둘째 날', '셋째 날', '넷째 날', '다섯째 날', '여섯째 날', '일곱째 날'];

/** 몇째 날인지 부르는 말. 「첫 하루」, 「둘째 날」 … */
export const dayName = (days: number): string => DAY_NAMES[days - 1] ?? `${days}일째`;

/** 화면이 띄우는 넘기기. 서버는 short·errand도 받지만 화면에는 이 둘만 선다 */
export type SkipChoice = 'evening' | 'sleep';

/** 시간을 넘기는 단추. 넘긴 사이에도 캐스트는 자기 하루를 보낸다.
    낮에는 저녁과 다음 날 아침으로, 저녁이 지나면 아침으로만 갈 수 있다.
    가려는 때가 열어 둔 날의 끝(`end`)을 넘으면 서버는 날의 끝에서 멈추고 크레딧이 오른다 — 그 단추는 「하루 마치기」다.
    (2026-11-13 플레이에서: 저녁 7시에 「다음 날 아침으로」를 누르니 아침이 아니라 날이 끝나는 새벽 1:08로 갔다)
    저녁까지 한 시간이 안 남았으면 「저녁으로」를 띄우지 않는다(2026-11-14 테스터: 6시 39분에 누르니 21분만 넘어갔다) */
export function skipsAt(c: Clock, end: number): { kind: SkipChoice; label: string }[] {
  const min = worldAt(c).min;
  const all: { kind: SkipChoice; label: string }[] =
    min < RULES.skip.wakeMin
      ? [{ kind: 'sleep', label: '아침으로' }]
      : min < RULES.skip.eveningMin
        ? [
            // 저녁이 코앞이면 「저녁으로」는 몇 분만 넘긴다. 그때는 띄우지 않는다
            ...(nextEvening(c) - c.elapsed >= RULES.skip.eveningLeadMin ? [{ kind: 'evening' as const, label: '저녁으로' }] : []),
            { kind: 'sleep', label: '다음 날 아침으로' },
          ]
        : [{ kind: 'sleep', label: '다음 날 아침으로' }];
  const out: { kind: SkipChoice; label: string }[] = [];
  for (const s of all) {
    const to = s.kind === 'evening' ? nextEvening(c) : nextWake(c);
    if (to < end) out.push(s);
    else if (!out.some((o) => o.label === '하루 마치기')) out.push({ kind: s.kind, label: '하루 마치기' });
  }
  return out;
}
