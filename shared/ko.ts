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
