/* 한국어 조사. 이름이 받침으로 끝나는지에 따라 고른다. */

function hasBatchim(word: string): boolean {
  const ch = word.trim().slice(-1);
  const code = ch.charCodeAt(0);
  if (code < 0xac00 || code > 0xd7a3) return false;
  return (code - 0xac00) % 28 !== 0;
}

/** josa('민현', '은', '는') → '민현은' */
export function josa(word: string, withBatchim: string, without: string): string {
  return word + (hasBatchim(word) ? withBatchim : without);
}

/** 조사만 고른다. 따옴표로 감싼 말 뒤에 붙일 때 쓴다: `「${w}」${pick(w, '이라고', '라고')}` */
export function pick(word: string, withBatchim: string, without: string): string {
  return hasBatchim(word) ? withBatchim : without;
}

/** 공백을 지우고 견준다 — 「보건 선생님」과 「보건선생님」은 같은 말이다 */
export function squeeze(s: string): string {
  return s.replace(/\s+/g, '');
}

/** 받침이 ㄹ인가 — 「으로/로」를 고를 때 쓴다 */
function endsWithRieul(word: string): boolean {
  const code = word.trim().slice(-1).charCodeAt(0);
  return code >= 0xac00 && code <= 0xd7a3 && (code - 0xac00) % 28 === 8;
}

/** 이름 바로 뒤에 붙는 조사. [받침이 있을 때, 없을 때]. 긴 것부터 견준다 */
const AFTER_NAME: [string, string][] = [
  ['이랑', '랑'],
  ['으로', '로'],
  ['이라', '라'],
  ['이', '가'],
  ['을', '를'],
  ['은', '는'],
  ['과', '와'],
  // 부르는 말: 「리현아」, 「수아야」
  ['아', '야'],
];

/** 글 속의 이름을 새 이름으로 바꾼다. 이름 바로 뒤에 붙은 조사는 새 이름의 받침에 맞춘다.
    keep에 든 이름(캐스트의 이름)의 한 토막일 때는 건드리지 않는다.
    줄여 부른 이름은 알아보지 못한다 — 그런 곳은 적힌 그대로 남는다 */
export function renameIn(text: string, from: string, to: string, keep: string[] = []): string {
  if (!from || from === to || !text.includes(from)) return text;
  // {{user}} 같은 자리표는 사람 이름이 아니라서 받침으로 조사를 짐작할 수 없다
  if (/^\{\{.*\}\}$/.test(from)) return fillMark(text, new RegExp(from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), to);
  const fromB = hasBatchim(from);
  const toB = hasBatchim(to);
  let out = '';
  let i = 0;
  while (i < text.length) {
    const at = text.indexOf(from, i);
    if (at < 0) {
      out += text.slice(i);
      break;
    }
    out += text.slice(i, at);
    const inside = keep.some((k) => k !== from && k.includes(from) && text.startsWith(k, at - k.indexOf(from)));
    if (inside) {
      out += from;
      i = at + from.length;
      continue;
    }
    let rest = at + from.length;
    let particle = '';
    for (const [withB, without] of AFTER_NAME) {
      // ㄹ 받침 뒤에는 「으로」가 아니라 「로」가 온다
      const was = withB === '으로' ? (fromB && !endsWithRieul(from) ? '으로' : '로') : fromB ? withB : without;
      if (!text.startsWith(was, rest)) continue;
      // 한 글자 조사 뒤에 한글이 바로 이어지면 다른 낱말일 수 있다. 그때는 이름만 바꾼다
      const single = withB === '이' || withB === '을' || withB === '은' || withB === '과' || withB === '아';
      if (single && /[가-힣]/.test(text[rest + 1] ?? '')) continue;
      particle = withB === '으로' ? (toB && !endsWithRieul(to) ? '으로' : '로') : toB ? withB : without;
      rest += was.length;
      break;
    }
    out += to + particle;
    i = rest;
  }
  return out;
}

/** 글 속의 자리표(예: {{user}})를 이름으로 바꾼다. 바로 뒤에 붙은 조사는 그 이름의 받침에 맞춘다.
    자리표 뒤의 조사는 받침이 있는 꼴(「은」)로 적었든 없는 꼴(「는」)로 적었든, 「은(는)」처럼 둘 다 적었든 알아본다 */
export function fillMark(text: string, mark: RegExp, to: string): string {
  const re = new RegExp(mark.source, `${mark.flags.replace('g', '')}g`);
  const toB = hasBatchim(to);
  let out = '';
  let i = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    out += text.slice(i, m.index);
    let rest = m.index + m[0].length;
    let particle = '';
    for (const [withB, without] of AFTER_NAME) {
      const was = [`${withB}(${without})`, `${without}(${withB})`, withB, without].find((form) => text.startsWith(form, rest));
      if (!was) continue;
      // 한 글자 조사 뒤에 한글이 바로 이어지면 다른 낱말일 수 있다(「이름」, 「은행」). 그때는 이름만 바꾼다
      if (['이', '을', '은', '과', '아'].includes(was) && /[가-힣]/.test(text[rest + 1] ?? '')) continue;
      particle = withB === '으로' ? (toB && !endsWithRieul(to) ? '으로' : '로') : toB ? withB : without;
      rest += was.length;
      break;
    }
    out += to + particle;
    i = rest;
    re.lastIndex = rest;
  }
  return out + text.slice(i);
}

/** 두 글자 성. 이 성으로 시작하는 네 글자 이름은 뒤 두 글자가 이름이다 */
const DOUBLE_SURNAMES = ['남궁', '황보', '제갈', '선우', '독고', '사공', '서문', '동방'];

/** 이름에서 성을 뗀 것. 「배이안」→「이안」, 「남궁민수」→「민수」. 성을 가를 수 없으면 이름 그대로다 */
export function givenName(name: string): string {
  if (/^[가-힣]{3}$/.test(name)) return name.slice(1);
  if (/^[가-힣]{4}$/.test(name) && DOUBLE_SURNAMES.some((s) => name.startsWith(s))) return name.slice(2);
  return name;
}
