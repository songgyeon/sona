/* 같은 말이 도는지 센다.
   대사 모델은 한번 쓴 말버릇과 몸짓으로 자꾸 돌아간다(「글쎄」, 「무심하게」, 「시선을」, 「툭」).
   여기서는 세기만 한다. 대목을 고치거나 지우지 않는다 — 다음 대목을 쓸 때 자주 나온 말로 알려 줄 뿐이다.
   무엇이 버릇이고 무엇이 이야기에 꼭 있어야 하는 말인지는 가리지 않는다. 그것은 받아 읽는 작가가 가린다. */

import { RULES } from '../../shared/rules';

/** 어느 글에나 흔한 말. 자주 나와도 버릇으로 치지 않는다. 낱말의 앞 두 글자로 적는다 */
const COMMON = new Set(
  `그가 그는 그의 그를 그와 그도 그에 그녀 그것 그게 그건 그걸 그거 그때 그렇 그런 그러 그래 그럼 그리 그만
   이것 이게 이건 이걸 이거 이렇 이런 이제 이미 이내 이번 이쪽 이다 저것 저건 저렇 저런 저쪽 여기 거기 저기
   어디 어떻 어떤 어느 어쩌 어째 어서 어제 언제 얼마 오늘 내일 지금 방금 아까 나중 먼저 다음 처음 다시 아직 아주 아무 아니 아닌 아마 아예
   조금 잠시 잠깐 정말 진짜 너무 거의 모두 모든 전부 혼자 같이 함께 서로 계속 역시 물론 하지 무슨 무엇 뭔가 뭐가 뭐야 뭐라 뭐든 누구 누가
   우리 너는 너의 너도 너를 네가 내가 나는 나의 나도 나를 자기 하나
   있다 있는 있었 있어 있고 없다 없는 없었 없어 없이 없고 한다 했다 하고 하는 하며 하다 하면 해서 해도 했어 했는 한번 된다 됐다 되는 되고
   않는 않고 않았 않아 않을 못하 같은 같다 같아 보다 본다 보는 보며 보고 봤다 봤어 간다 갔다 가는 가고 온다 왔다 오는 준다 줬다 주는
   말한 말했 말하 말을 말이 말은 말도 안다 알아 알았 모른 몰라 몰랐
   채로 때문 동안 위로 위에 아래 앞에 앞으 뒤로 뒤에 옆에 옆으 안으 안에 밖으 쪽으 쪽을 사이 정도 만큼 처럼 대로 한참 여전`.split(/\s+/),
);
// 「천천히」는 흔한 말로 빼 두었는데, 대사 모델의 지문 버릇이었다 — 「적과 흑」 10턴의 지문 21줄 가운데 5줄(2026-11-13). 세는 말로 돌렸다

/** 한 글자짜리 말은 흉내말만 센다. 「툭」 같은 말은 지문에 버릇처럼 붙는다 */
const MIMETIC = new Set('툭 픽 쓱 슥 휙 탁 턱 쿡 꾹 톡 콱 확 홱 척 뚝 딱 쭉 푹 꽉 쾅 쿵'.split(' '));

/** 낱말의 뿌리. 세 글자 넘는 말은 앞 두 글자로 본다 — 「무심한」과 「무심하게」가 같은 말로 세어진다.
    겹쳐 쓴 흉내말은 한 글자로 본다 — 「툭툭」은 「툭」이다 */
function root(word: string): string {
  if (word.length === 2 && word[0] === word[1] && MIMETIC.has(word[0]!)) return word[0]!;
  return word.length >= 3 ? word.slice(0, 2) : word;
}

/** 두 낱말이 함께 가진 앞머리 */
function head(a: string, b: string): string {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i += 1;
  return a.slice(0, i);
}

/** 글들 가운데 여러 글에 걸쳐 자주 나온 말을 고른다. 많이 나온 것부터.
    한 글에 여러 번 나와도 한 번으로 친다 — 여러 대목에 걸쳐 도는 말을 찾는 것이다.
    names는 사람 이름과 부르는 말이다. 자주 나오는 것이 당연하니 세지 않는다.
    돌려주는 것은 나온 모양들이 함께 가진 앞머리다(「무심한」, 「무심하게」 → 「무심」) */
export function overused(texts: string[], names: string[]): string[] {
  const seen = new Map<string, { times: number; shown: string }>();
  for (const text of texts) {
    const here = new Map<string, string>();
    for (const word of text.match(/[가-힣]+/g) ?? []) {
      if (word.length < 2 && !MIMETIC.has(word)) continue;
      const key = root(word);
      if (COMMON.has(key) || names.some((n) => n.includes(key))) continue;
      const was = here.get(key);
      here.set(key, was === undefined ? word : head(was, word));
    }
    for (const [key, form] of here) {
      const was = seen.get(key);
      seen.set(key, was ? { times: was.times + 1, shown: head(was.shown, form) } : { times: 1, shown: form });
    }
  }
  return [...seen.values()]
    .filter((v) => v.times >= RULES.echo.times)
    .sort((a, b) => b.times - a.times)
    .slice(0, RULES.echo.list)
    .map((v) => v.shown);
}
