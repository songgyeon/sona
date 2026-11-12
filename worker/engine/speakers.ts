/* 대사 줄의 이름표 — 「이름: "대사"」에서 누구의 말인지 가른다. 쓸 때(parseScene)와 읽을 때(relabel)가 같은 셈을 쓴다.
   작가(대사 모델)는 지문에서 부르던 대로 성을 떼고 「이안:」이라고 쓰기도 하고, 불리는 이름으로 쓰기도 한다.
   그래서 캐스트는 이름, 성을 뗀 이름, 불리는 이름들로 알아본다. 유저의 인물은 이름과 성을 뗀 이름으로.
   이름 그대로가 먼저다. 그 밖의 이름표를 두 사람이 같이 쓰면 아무에게도 주지 않는다 — 지문으로 둔다.
   (2026-11-12: 캐스트 「배이안」의 대사를 작가가 「이안:」으로 써서, 대사가 지문 속에 「이안: "…"」 그대로 찍혔다.) */

import { givenName } from '../../shared/ko';
import type { Film, MessageView } from '../../shared/types';

/** 유저의 인물을 가리키는 이름표 */
export const PERSONA = 'persona';

const OPEN = '"“「『';
const CLOSE = '"”」』';
/** 따옴표로 통째로 감싼 말이면 따옴표를 벗긴다. 아니면 그대로 */
export const unquote = (t: string) => (t.length > 2 && OPEN.includes(t[0]!) && CLOSE.includes(t[t.length - 1]!) ? t.slice(1, -1).trim() : t);

/** 한 줄을 이름표와 나머지로 가른다. 이름표를 꾸민 기호(**이름**, [이름])는 뗀다. 이름표 모양이 아니면 null */
export function labelOf(line: string): { who: string; rest: string } | null {
  const m = /^([^:：]{1,24}?)\s*[:：]\s*(.+)$/.exec(line);
  if (!m) return null;
  return { who: m[1]!.replace(/^[\s*\[(「『]+|[\s*\])」』]+$/g, ''), rest: m[2]!.trim() };
}

/** 이름표 → 누구(캐스트의 이름표, 유저의 인물이면 PERSONA). 모르는 이름표면 null */
export function speakerOf(film: Film): (label: string) => string | null {
  const exact = new Map<string, string>();
  for (const c of film.casts) exact.set(c.name, c.key);
  exact.set(film.persona.name, PERSONA);
  const loose = new Map<string, Set<string>>();
  const add = (label: string, key: string) => {
    const l = label.trim();
    if (!l || exact.has(l)) return;
    if (!loose.has(l)) loose.set(l, new Set());
    loose.get(l)!.add(key);
  };
  for (const c of film.casts) {
    add(givenName(c.name), c.key);
    for (const a of c.aliases ?? []) add(a, c.key);
  }
  add(givenName(film.persona.name), PERSONA);
  return (label) => {
    const hit = exact.get(label);
    if (hit) return hit;
    const keys = loose.get(label);
    return keys && keys.size === 1 ? [...keys][0]! : null;
  };
}

/** 예전 대목에서 이름표를 못 알아봐 지문 속에 들어간 대사를, 읽을 때 대사로 가른다. 저장된 말은 그대로 둔다.
    지문 한 덩이를 줄마다 보고, 캐스트의 이름표로 시작하는 줄은 그 사람의 말로 세운다.
    유저의 인물 이름표로 시작하는 줄은 뺀다 — 쓸 때와 같다(그 사람의 말은 유저가 쓴다). 한편의 줄도 같이 가른다 */
export function relabel(messages: MessageView[], film: Film): MessageView[] {
  const who = speakerOf(film);
  const out: MessageView[] = [];
  for (const m of messages) {
    if (m.speaker !== 'tell' || !/[:：]/.test(m.text)) {
      out.push(m);
      continue;
    }
    const parts: MessageView[] = [];
    let tell: string[] = [];
    let changed = false;
    const piece = (speaker: string, text: string) => parts.push({ ...m, id: `${m.id}~${parts.length}`, speaker, text });
    const flush = () => {
      if (tell.length > 0) piece('tell', tell.join('\n'));
      tell = [];
    };
    for (const line of m.text.split('\n')) {
      const l = labelOf(line.trim());
      const key = l ? who(l.who) : null;
      if (!l || !key) {
        tell.push(line);
        continue;
      }
      changed = true;
      flush();
      const text = unquote(l.rest);
      if (key !== PERSONA && text.length > 0) piece(key, text);
    }
    flush();
    if (changed) out.push(...parts);
    else out.push(m);
  }
  return out;
}
