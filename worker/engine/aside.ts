/* 한편 — 유저가 없는 자리에서 캐스트 둘이 나누는 장면.
   누가 언제 만나는지는 코드가 정하고, 모델은 장면만 쓴다.
   유저가 없는 자리에는 유저가 없는 일만 일어난다 — 유저의 인물이 말하거나 그 자리에 있으면 장면을 통째로 버린다.
   그 일은 두 사람만 안다. 유저가 장면을 읽어도 유저의 인물은 모르는 일이다. */

import { type Clock, inSpan, nextAt, worldAt } from '../../shared/clock';
import { josa, pick } from '../../shared/ko';
import { RULES } from '../../shared/rules';
import type { Cast, Film } from '../../shared/types';
import type { Layers } from '../model/index';
import { type SceneEvent, when } from '../prompt/scene';

export const ASIDE_SYSTEM = `너는 「소나」의 필름 속 한 장면을 쓰는 작가다. [두 사람]이 [때]에 만나 나누는 짧은 장면을 쓴다.

[지킬 것]
- [그 자리에 없는 사람]은 이 장면에 없다. 그 사람이 말하거나, 들어오거나, 연락해 오는 것을 쓰지 않는다. 두 사람이 그 사람 이야기를 하는 것은 된다.
- 아는 것의 주인을 지킨다. [○○만 아는 일]에 적힌 일은 ○○만 안다. 그 일을 먼저 꺼낼 수 있는 사람은 ○○뿐이다. 다른 사람은 이 장면에서 ○○에게 듣고 나서야 알고, 듣기 전에는 그 일을 아는 것처럼 말하지 않는다.
- 적혀 있지 않은 일을 지어내지 않는다. [그 자리에 없는 사람]과 있었던 일은 아래에 적힌 것이 전부다. 적혀 있지 않은 만남이나 대화를 있었던 것처럼 말하지 않는다.
- 두 사람의 사이, 서로를 부르는 말, 말투는 [두 사람]에 적힌 그대로 쓴다.
- [두 사람]에 트라우마, 결핍, 비밀이 적혀 있으면 그것은 그 사람의 속사정이다. 장면에서 풀어 설명하거나 털어놓지 않는다. 말과 행동에 묻어날 뿐이다. 비밀은 적힌 사람만 안다. 상대가 안다고 적혀 있지 않으면 상대는 모르는 일이다.
- 큰 사건을 만들지 않는다. 평범한 하루의 한 토막이면 된다. 시간을 건너뛰지 않는다.

[쓰는 법]
- 첫 줄은 반드시 이 모양: 장소 | 두 사람이 있는 곳
- 그다음 줄부터 장면을 쓴다. 지문과 대사를 섞는다.
- 지문에는 보이는 것과 들리는 것만 쓴다. 「~다」로 끝나는 짧은 문장으로 쓴다. 속마음을 풀어 설명하지 않는다.
- 대사는 한 줄에 하나씩, 반드시 이 모양: 이름: "대사"
- 대사는 여섯 줄에서 열 줄, 지문은 두세 덩이.
- 장면만 쓴다. 설명, 해설, 영어, 생각하는 과정을 쓰지 않는다.

[예]
장소 | 사무실
둘만 남은 사무실. 형광등 하나가 깜빡인다.
가람: "아직 안 갔어요?"
도윤: "이것만 보고."`;

export const ASIDE_CUE = '(위 두 사람의 장면을 쓴다.)';

/** 서로 아는 두 사람. 사이가 적혀 있으면 아는 사이다(어느 쪽으로든). 캐스트 순서대로 */
export function knownPairs(film: Film): [Cast, Cast][] {
  const out: [Cast, Cast][] = [];
  for (let i = 0; i < film.casts.length; i++) {
    for (let j = i + 1; j < film.casts.length; j++) {
      const a = film.casts[i]!;
      const b = film.casts[j]!;
      if (film.ties.some((t) => (t.from === a.key && t.to === b.key) || (t.from === b.key && t.to === a.key))) out.push([a, b]);
    }
  }
  return out;
}

export const pairId = (a: Cast, b: Cast): string => `${a.key}+${b.key}`;

/** 이번에 만날 두 사람. 지금까지 장면이 가장 적었던 쌍이다. 같으면 앞선 쌍 */
export function pickPair(film: Film, counts: Map<string, number>): [Cast, Cast] | null {
  let best: [Cast, Cast] | null = null;
  for (const pair of knownPairs(film)) {
    if (!best || (counts.get(pairId(...pair)) ?? 0) < (counts.get(pairId(...best)) ?? 0)) best = pair;
  }
  return best;
}

/** 두 사람이 만나는 때. 비운 사이에 저녁 그 시각이 들어 있고 둘 다 깨어 있으면 그때, 아니면 비운 사이의 가운데.
    누가 자고 있으면 만나지 않는다 */
export function asideSlot(clock: Clock, a: Cast, b: Cast, from: number, to: number): number | null {
  const awake = (at: number) => ![a, b].some((c) => inSpan(worldAt(clock, at).min, c.sleepFrom, c.sleepTo));
  const evening = nextAt(clock, RULES.aside.eveningMin, from);
  if (evening < to && awake(evening)) return evening;
  const mid = from + Math.floor((to - from) / 2);
  return awake(mid) ? mid : null;
}

/** 한 사람의 카드. 작가에게 건네는 것이라 「너」가 아니라 이름으로 적는다 */
function card(film: Film, who: Cast, other: Cast): string {
  const me = film.persona.name;
  const out: string[] = [`이름: ${who.name}`];
  if (who.role) out.push(`- ${me}에게는: ${who.role}`);
  if (who.speech) out.push(`- 말투: ${who.speech}`);
  if (who.nature) out.push(`- 성격: ${who.nature}`);
  if (who.habit) out.push(`- 습관: ${who.habit}`);
  if (who.trauma) out.push(`- 트라우마: ${who.trauma}`);
  if (who.lack) out.push(`- 결핍: ${who.lack}`);
  if (who.secret) out.push(`- 비밀: ${who.secret}`);
  if (who.callsUser) out.push(`- ${josa(me, '을', '를')} 부르는 말: ${who.callsUser}`);
  if (who.dayPlace) out.push(`- 낮에 주로 있는 곳: ${who.dayPlace}`);
  const tie = film.ties.find((t) => t.from === who.key && t.to === other.key);
  if (tie?.relation) out.push(`- ${other.name}에게는: ${tie.relation}`);
  if (tie?.calls) out.push(`- ${josa(other.name, '을', '를')} 「${tie.calls}」${pick(tie.calls, '이라고', '라고')} 부른다`);
  if (who.samples.length > 0) out.push(`- 예시 대사(이 결로 쓴다. 그대로 베끼지 않는다): ${who.samples.join(' / ')}`);
  return out.join('\n');
}

/** 두 사람이 아는 것. 주인을 갈라서 건넨다 */
export interface AsideKnown {
  /** 둘 다 아는 일 */
  shared: SceneEvent[];
  /** 한 사람만 아는 일. 앞이 첫째 사람, 뒤가 둘째 사람 */
  only: [SceneEvent[], SceneEvent[]];
  /** 각자가 유저의 인물과 최근에 나눈 말. 그 사람만 안다 */
  recent: [{ speaker: string; text: string }[], { speaker: string; text: string }[]];
}

export function asideLayers(film: Film, a: Cast, b: Cast, clock: Clock, at: number, known: AsideKnown): Layers {
  const cast = ['[두 사람]', card(film, a, b), '', card(film, b, a)];
  if (film.setting) cast.push('', '[이 세계]', film.setting);

  const out: string[] = [];
  out.push('[때]');
  out.push(`${when(clock, at)}.`);
  out.push('');
  out.push('[그 자리에 없는 사람]');
  out.push(film.persona.line ? `${film.persona.name} — ${film.persona.line}` : film.persona.name);
  // 아는 것의 주인을 갈라서 건넨다: 둘 다 아는 일, 한 사람만 아는 일
  if (known.shared.length > 0) {
    out.push('');
    out.push('[둘 다 아는 일]');
    for (const e of known.shared) out.push(`- (${when(clock, e.at)}) ${e.text}`);
  }
  [a, b].forEach((who, i) => {
    const other = i === 0 ? b : a;
    const recent = known.recent[i]!;
    out.push('');
    out.push(`[${who.name}만 아는 일 — ${josa(other.name, '은', '는')} ${who.name}에게 듣기 전에는 모른다]`);
    for (const e of known.only[i]!) out.push(`- (${when(clock, e.at)}) ${e.text}`);
    if (recent.length > 0) {
      out.push(`- ${josa(film.persona.name, '과', '와')} 나눈 말:`);
      for (const r of recent) out.push(`    ${r.speaker}: ${r.text}`);
    } else {
      out.push(`- ${josa(film.persona.name, '과', '와')} 말을 나눈 적이 없다.`);
    }
  });
  return { system: ASIDE_SYSTEM, cast: cast.join('\n'), scene: out.join('\n') };
}

export interface AsidePiece {
  /** 캐스트의 이름표, 지문이면 'tell' */
  speaker: string;
  text: string;
}

export interface AsideRead {
  place: string;
  pieces: AsidePiece[];
  /** 유저의 인물이 직접 말했다 — 그러면 장면을 버린다 */
  personaSpoke: boolean;
}

const OPEN = '"“「『';
const CLOSE = '"”」』';

/** 모델이 쓴 장면을 읽는다. 「이름: "대사"」 줄은 그 사람의 대사고, 나머지는 지문이다.
    글자를 지우거나 고치지 않는다 — 대사를 감싼 따옴표만 벗긴다. 이어지는 지문 줄은 한 덩이로 둔다 */
export function parseAside(raw: string, film: Film, a: Cast, b: Cast): AsideRead {
  const lines = raw
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  let place = '';
  const first = lines[0] ? /^장소\s*[|:：]\s*(.+)$/.exec(lines[0]) : null;
  if (first) {
    lines.shift();
    const p = first[1]!.trim();
    // 곳 이름으로 보기에 너무 길면 곳을 비워 둔다. 잘라 쓰지 않는다
    if (p.length <= RULES.limits.place) place = p;
  }

  const keyOf = new Map([
    [a.name, a.key],
    [b.name, b.key],
  ]);
  const pieces: AsidePiece[] = [];
  let personaSpoke = false;
  for (const line of lines) {
    const m = /^([^:：]{1,20}?)\s*[:：]\s*(.+)$/.exec(line);
    const who = m ? m[1]!.trim() : '';
    if (m && who === film.persona.name) {
      personaSpoke = true;
      continue;
    }
    const key = m ? keyOf.get(who) : undefined;
    if (m && key) {
      let text = m[2]!.trim();
      if (text.length > 2 && OPEN.includes(text[0]!) && CLOSE.includes(text[text.length - 1]!)) text = text.slice(1, -1).trim();
      if (text.length > 0) pieces.push({ speaker: key, text });
      continue;
    }
    const last = pieces[pieces.length - 1];
    if (last?.speaker === 'tell') last.text += `\n${line}`;
    else pieces.push({ speaker: 'tell', text: line });
  }
  return { place, pieces, personaSpoke };
}

/** 두 사람이 기억하는 그 일. 나눈 말을 그대로 적는다 */
export function asideMemory(film: Film, a: Cast, b: Cast, read: AsideRead): string {
  const nameOf = (key: string) => (key === a.key ? a.name : b.name);
  const said = read.pieces.filter((p) => p.speaker !== 'tell').map((p) => `${nameOf(p.speaker)}: "${p.text}"`);
  const where = read.place ? `${read.place}에서 ` : '';
  return `${josa(a.name, '과', '와')} ${josa(b.name, '이', '가')} ${where}둘이 나눈 이야기(${josa(film.persona.name, '은', '는')} 그 자리에 없었다) — ${said.join(' / ')}`;
}
