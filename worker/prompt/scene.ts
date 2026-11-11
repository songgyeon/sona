/* 프롬프트의 셋째 층 — 시나리오.
   지금 이 장면의 사실만 싣는다: 때, 누가 무엇을 아는가, 지금까지의 장면.
   본편은 작가가 나오는 사람들을 모두 맡아 쓴다(writerLayer). 먼저 거는 연락은 그 인물이 되어 쓴다(sceneLayer). */

import { type Clock, formatMin, partOfDay, worldAt } from '../../shared/clock';
import { wasThere } from '../../shared/opening';
import { DOW_NAMES, RULES } from '../../shared/rules';
import type { Cast, Film } from '../../shared/types';

export interface SceneEvent {
  at: number;
  text: string;
}

/** 지나간 장면의 한 조각. 지문에는 말한 사람이 없다 */
export interface SceneLine {
  /** tell 지문 / say 대사 / msg 폰으로 온 메시지 / act 유저가 쓴 지문 */
  kind: 'tell' | 'say' | 'msg' | 'act';
  speaker: string; // 이름. 지문이면 빈 글자
  text: string;
  /** 유저가 맡은 인물의 말이면 참 — 받은 그대로 적는다 */
  mine: boolean;
  /** 그 말이 나온 때(흐른 분) */
  at: number;
}

/** 프롬프트에 적는 때. 분 단위를 안 준다 — 주면 「7시 42분이네요」가 나온다 */
export function when(clock: Clock, at: number): string {
  const w = worldAt(clock, at);
  return `${DOW_NAMES[w.dow]} ${partOfDay(w.min)}`;
}

/** 지나간 장면의 한 줄을 적는 모양. 유저의 지문은 누가 한 행동인지 붙여서 적는다 */
export function lineOf(h: SceneLine): string {
  if (h.kind === 'tell') return h.text;
  if (h.kind === 'msg') return `${h.speaker}(메시지): ${h.text}`;
  if (h.kind === 'act') return `(${h.speaker}의 지문) ${h.text}`;
  return h.mine ? `${h.speaker}: ${h.text}` : `${h.speaker}: "${h.text}"`;
}

/** 앞뒤 말 사이가 크게 벌어졌으면 그 자리에 적어 둔다. 앞 장면은 거기서 끝난 것이다 */
const passed = (clock: Clock, at: number) => `(시간이 흘렀다. 지금은 ${when(clock, at)}.)`;

/** [지금] — 때, 그리고 알고 있으면 바로 앞 대목까지 장면이 벌어지던 곳과 그 대목이 끝났을 때의 모습 */
function nowBlock(clock: Clock, out: string[], place = '', pose = ''): void {
  const now = worldAt(clock);
  out.push('[지금]');
  out.push(`${DOW_NAMES[now.dow]} ${partOfDay(now.min)}.`);
  // 「지금 있는 곳」이라고 적으면 자리를 옮긴 뒤에도 작가가 그 이름을 그대로 베껴 적는다
  if (place) out.push(`바로 앞 대목까지 있던 곳: ${place}`);
  if (pose) out.push(`바로 앞 대목이 끝났을 때의 모습: ${pose}`);
}

/** [이야기가 시작된 자리] — 디렉터가 쓴 오프닝. 지문은 그대로, 대사는 누가 한 말인지 붙여서. 적었으면 참 */
function openingBlock(film: Film, out: string[]): boolean {
  const fs = film.firstScene;
  const lines = fs.beats.filter((b) => b.kind !== 'cut');
  if (!fs.place && lines.length === 0) return false;
  const nameOf = (key: string) => film.casts.find((c) => c.key === key)?.name ?? key;
  out.push('');
  out.push('[이야기가 시작된 자리]');
  if (fs.place) out.push(fs.place);
  for (const b of lines) {
    if (b.kind === 'tell') out.push(b.text);
    else if (b.kind === 'say') out.push(`${nameOf(b.cast)}: "${b.text}"`);
  }
  return true;
}

/** [지금까지의 장면]. prev는 바로 앞에 적은 말의 때다 — 오프닝을 적었으면 맨 처음(0분) */
function historyBlock(clock: Clock, history: SceneLine[], prev: number | null, out: string[]): void {
  if (history.length > 0) {
    out.push('');
    out.push('[지금까지의 장면]');
    for (const h of history) {
      if (prev !== null && h.at - prev >= RULES.scene.breakMin) out.push(passed(clock, h.at));
      prev = h.at;
      out.push(lineOf(h));
    }
  }
  // 마지막 말 뒤로(오간 말이 없으면 오프닝 뒤로) 시간이 흘렀으면, 지금은 새 장면이다
  if (prev !== null && clock.elapsed - prev >= RULES.scene.breakMin) {
    if (history.length === 0) out.push('');
    out.push(passed(clock, clock.elapsed));
  }
}

export interface WriterInput {
  film: Film;
  clock: Clock;
  /** 나오는 사람들과 유저의 인물이 모두 아는 일 */
  shared: SceneEvent[];
  /** 몇 사람만 아는 일. 누가 아는지 이름과 함께 */
  only: { who: string[]; events: SceneEvent[] }[];
  /** 지나간 장면. 유저가 이번에 쓴 것은 빼고 준다 */
  history: SceneLine[];
  /** 바로 앞 대목까지 장면이 벌어지던 곳. 모르면 빈 글자(오래 비우고 돌아온 뒤가 그렇다) */
  place: string;
  /** 바로 앞 대목이 끝났을 때 사람들의 모습. 모르면 빈 글자 */
  pose: string;
}

/** 본편: 장면을 쓰는 작가에게 건네는 시나리오 */
export function writerLayer(s: WriterInput): string {
  const out: string[] = [];
  nowBlock(s.clock, out, s.place, s.pose);
  const opened = openingBlock(s.film, out);

  if (s.shared.length > 0) {
    out.push('');
    out.push('[모두 아는 일]');
    for (const e of s.shared) out.push(`- (${when(s.clock, e.at)}) ${e.text}`);
  }
  for (const g of s.only) {
    out.push('');
    out.push(`[${g.who.join(', ')}만 아는 일 — 다른 사람은 듣기 전에는 모른다]`);
    for (const e of g.events) out.push(`- (${when(s.clock, e.at)}) ${e.text}`);
  }

  historyBlock(s.clock, s.history, opened ? 0 : null, out);
  return out.join('\n');
}

export interface SceneInput {
  film: Film;
  cast: Cast;
  clock: Clock;
  /** 이 인물이 아는 일만. 거르는 것은 부르는 쪽이 한다 */
  events: SceneEvent[];
  /** 지나간 장면 */
  history: SceneLine[];
}

/** 먼저 거는 연락: 그 인물 한 사람에게 건네는 시나리오. 오프닝은 그 자리에 있던 사람에게만 싣는다 */
export function sceneLayer(s: SceneInput): string {
  const out: string[] = [];
  nowBlock(s.clock, out);
  const opened = wasThere(s.film, s.cast.key) && openingBlock(s.film, out);

  if (s.events.length > 0) {
    out.push('');
    out.push('[네가 아는 일]');
    for (const e of s.events) out.push(`- (${when(s.clock, e.at)}) ${e.text}`);
  }

  historyBlock(s.clock, s.history, opened ? 0 : null, out);
  return out.join('\n');
}

/** 「금요일 오후 4:03」 */
export function stamp(clock: Clock, at: number): string {
  const w = worldAt(clock, at);
  return `${DOW_NAMES[w.dow]} ${formatMin(w.min)}`;
}
