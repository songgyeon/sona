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
];

/** 글 속의 이름을 새 이름으로 바꾼다. 이름 바로 뒤에 붙은 조사는 새 이름의 받침에 맞춘다.
    keep에 든 이름(캐스트의 이름)의 한 토막일 때는 건드리지 않는다.
    부르는 말(「~아/야」)이나 줄여 부른 이름은 알아보지 못한다 — 그런 곳은 적힌 그대로 남는다 */
export function renameIn(text: string, from: string, to: string, keep: string[] = []): string {
  if (!from || from === to || !text.includes(from)) return text;
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
      const single = withB === '이' || withB === '을' || withB === '은' || withB === '과';
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
