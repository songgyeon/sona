/* 유저가 자리를 비운 동안 인물이 보낸 시간.
   모델이 한 줄에 한 가지 일을 적고, 코드가 줄마다 확인해서 안 맞는 줄만 버린다.
   유저가 없는 자리에는 유저가 없는 일만 일어난다 — 유저가 나오는 줄은 따로 물어 보고 버린다. */

import { type Clock, inSpan, nextAt } from '../../shared/clock';
import { squeeze } from '../../shared/ko';
import { RULES } from '../../shared/rules';
import type { Cast, Film } from '../../shared/types';
import type { Layers } from '../model/index';
import { castLayer } from '../prompt/cast';
import { stamp, when, type SceneEvent, type SceneLine } from '../prompt/scene';

export const GAP_SYSTEM = `너는 필름 속 한 사람이 보낸 시간을 적는 기록자다. 대화를 쓰는 자리가 아니다.

[할 일]
[인물]이 [구간] 동안 보낸 시간을 적는다.
- 한 줄에 한 가지 일. 모양은 반드시: 시각 | 종류 | 글
- 시각은 24시간제 HH:MM. [구간] 안의 시각만 쓴다. 자는 시간에는 아무 일도 적지 않는다.
- 종류는 셋뿐이다.
  일상: 그 사람이 한 일. 사실만 한 문장으로. 한 줄에서 세 줄.
  피드: 그 사람이 피드에 올린 한 줄. 그 사람 말투로. 없어도 되고, 많아야 한 줄.
  말거리: 그 사람이 [상대]에게 먼저 건넬 만한 얘깃거리 하나. 없어도 되고, 많아야 한 줄.

[지킬 것]
- [상대]는 그 자리에 없다. [상대]의 말, 행동, 선택을 쓰지 않는다. 그 사람이 [상대]를 떠올리는 것은 된다.
- 큰 사건을 만들지 않는다. 평범한 하루의 조각이면 된다.
- 줄만 쓴다. 다른 말을 붙이지 않는다.

[예]
19:20 | 일상 | 퇴근길에 편의점에서 컵라면을 샀다.
22:40 | 피드 | 오늘은 진짜 아무것도 하기 싫다
08:10 | 말거리 | 아침에 비가 와서 우산을 챙겼다.`;

export const GAP_CUE = '(위 구간을 적는다.)';

const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

export function gapLayers(
  film: Film,
  cast: Cast,
  clock: Clock,
  from: number,
  to: number,
  events: SceneEvent[],
  recent: SceneLine[],
): Layers {
  const out: string[] = [];
  out.push('[인물]');
  out.push(cast.name);
  out.push('');
  out.push('[상대]');
  out.push(film.persona.name);
  out.push('');
  out.push('[구간]');
  out.push(`${stamp(clock, from)}부터 ${stamp(clock, to)}까지`);
  out.push(`자는 시간: ${hhmm(cast.sleepFrom)} ~ ${hhmm(cast.sleepTo)}`);
  if (events.length > 0) {
    out.push('');
    out.push('[이 사람이 아는 일]');
    for (const e of events) out.push(`- (${when(clock, e.at)}) ${e.text}`);
  }
  if (recent.length > 0) {
    out.push('');
    out.push('[구간 직전의 대화]');
    for (const r of recent) out.push(`${r.speaker}: ${r.text}`);
  }
  return { system: GAP_SYSTEM, cast: castLayer(film, cast), scene: out.join('\n') };
}

export type GapKind = 'daily' | 'post' | 'hook';

export interface GapItem {
  /** 작중 시각(흐른 분) */
  at: number;
  kind: GapKind;
  text: string;
}

export interface GapDrop {
  line: string;
  reason: 'shape' | 'kind' | 'out_of_span' | 'asleep' | 'too_many';
}

const KIND: Record<string, GapKind> = { 일상: 'daily', 피드: 'post', 말거리: 'hook' };

/** 줄마다 확인한다. 맞는 줄은 받고, 안 맞는 줄은 까닭을 달아 버린다 */
export function parseGap(
  raw: string,
  clock: Clock,
  from: number,
  to: number,
  cast: Cast,
): { items: GapItem[]; drops: GapDrop[] } {
  const items: GapItem[] = [];
  const drops: GapDrop[] = [];
  const count: Record<GapKind, number> = { daily: 0, post: 0, hook: 0 };

  for (const line of raw.split(/\r?\n/).map((s) => s.trim()).filter((s) => s.length > 0)) {
    const m = /^(\d{1,2}):(\d{2})\s*\|\s*([^|]+?)\s*\|\s*(.+)$/.exec(line);
    const h = m ? Number(m[1]) : NaN;
    const mm = m ? Number(m[2]) : NaN;
    if (!m || h > 23 || mm > 59) {
      drops.push({ line, reason: 'shape' });
      continue;
    }
    const kind = KIND[squeeze(m[3]!)];
    if (!kind) {
      drops.push({ line, reason: 'kind' });
      continue;
    }
    const min = h * 60 + mm;
    // 구간 안에서 그 시각이 처음 오는 때
    const at = nextAt(clock, min, from);
    if (at > to) {
      drops.push({ line, reason: 'out_of_span' });
      continue;
    }
    if (inSpan(min, cast.sleepFrom, cast.sleepTo)) {
      drops.push({ line, reason: 'asleep' });
      continue;
    }
    if (count[kind] >= RULES.gap[kind]) {
      drops.push({ line, reason: 'too_many' });
      continue;
    }
    count[kind] += 1;
    items.push({ at, kind, text: m[4]!.trim() });
  }
  items.sort((a, b) => a.at - b.at);
  return { items, drops };
}

/* ── 유저가 그 자리에 있는가 ── */

export const PRESENT_SYSTEM = `너는 한 줄을 읽고 판정만 하는 판정자다.

[할 일]
[줄]은 [인물]이 [상대] 없이 보낸 시간의 기록이어야 한다. [줄] 안에서 [상대]가 그 자리에 함께 있거나, 말하거나, 행동하는지 본다.
- 있음: [상대]가 그 자리에 있거나 말이나 행동을 한다.
- 없음: [상대]가 나오지 않거나, [인물]이 [상대]를 떠올리거나 [상대] 얘기를 하기만 한다.

[답하는 모양] 한 줄만 쓴다.
판정: 있음 | 없음`;

export const presentLayers = (): Layers => ({ system: PRESENT_SYSTEM, cast: '', scene: '' });

export const presentUser = (castName: string, personaName: string, line: string) =>
  `[인물]\n${castName}\n\n[상대]\n${personaName}\n\n[줄]\n${line}`;

/** 못 읽으면 null. 부르는 쪽은 못 읽은 줄을 버린다 — 유저를 대신 움직이는 쪽으로 틀리지 않게 */
export function parsePresent(raw: string): boolean | null {
  const m = /^\s*판정\s*[:：]\s*(있음|없음)\s*$/m.exec(raw);
  return m ? m[1] === '있음' : null;
}
