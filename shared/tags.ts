/* 해시태그. 필름 만들기에서 적고, 필름 정보와 아카이브에 보이고, 아카이브에서 해시태그로 찾는다.
   #은 빼고 둔다. (2026-11-13 사용자: 「해시태그 넣는 기능+해시태그 검색하는 기능」) */

/** 적은 글에서 해시태그를 고른다. 빈칸·쉼표·#으로 나눈다. 같은 것은 한 번만(대소문자는 가리지 않는다).
    길이와 개수는 자르지 않는다 — 넘으면 서버가 알린다 */
export function readTags(input: string): string[] {
  const out: string[] = [];
  for (const piece of input.split(/[\s,#]+/)) {
    const t = piece.trim();
    if (!t || out.some((x) => x.toLowerCase() === t.toLowerCase())) continue;
    out.push(t);
  }
  return out;
}

/** 찾는 말에 맞는 필름인가. #으로 시작하면 해시태그만 보고, 아니면 제목·한 줄 소개·캐스트 이름·해시태그를 다 본다 */
export function matches(film: { title: string; logline: string; castNames: string[]; tags: string[] }, word: string): boolean {
  const w = word.trim();
  if (!w) return true;
  if (w.startsWith('#')) {
    const t = w.replace(/^#+/, '').trim().toLowerCase();
    return !t || film.tags.some((tag) => tag.toLowerCase().includes(t));
  }
  const low = w.toLowerCase();
  return [film.title, film.logline, ...film.castNames, ...film.tags].some((s) => s.toLowerCase().includes(low));
}

/** 필름들에 많이 붙은 해시태그부터. 같은 수면 먼저 나온 것부터 */
export function topTags(films: readonly { tags: string[] }[], n: number): string[] {
  const count = new Map<string, { tag: string; n: number; first: number }>();
  let order = 0;
  for (const f of films) {
    for (const tag of f.tags) {
      const k = tag.toLowerCase();
      const had = count.get(k);
      if (had) had.n += 1;
      else count.set(k, { tag, n: 1, first: order++ });
    }
  }
  return [...count.values()]
    .sort((a, b) => b.n - a.n || a.first - b.first)
    .slice(0, n)
    .map((x) => x.tag);
}
