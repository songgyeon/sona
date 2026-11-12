/* 내가 쓴 글을 지문과 대사로 가른다.
   말하는 칸은 하나다. 지문은 *별표* 사이에 쓰고, 별표 밖은 대사다.
   글자는 고치지 않는다 — 별표를 걷고, 줄을 나누고, 줄 앞뒤의 빈칸만 다듬는다.
   화면(보내는 중에 미리 놓을 때)과 서버(적을 때)가 같은 셈을 쓴다. */

export interface MyLine {
  /** act 지문(내 인물이 하는 행동) / chat 대사 */
  kind: 'act' | 'chat';
  text: string;
}

const isStar = (ch: string | undefined) => ch === '*' || ch === '＊';

/** 「*문을 연다* 왔어?」 → 지문 「문을 연다」, 대사 「왔어?」.
    별표가 여럿 붙어 있어도 하나로 친다(**문을 연다**). 닫지 않은 별표 뒤는 끝까지 지문이다.
    줄바꿈 하나가 한 줄이다. 빈 줄은 버린다 */
export function splitLine(raw: string): MyLine[] {
  const out: MyLine[] = [];
  let act = false;
  let buf = '';
  const flush = () => {
    for (const line of buf.split(/\r?\n/)) {
      const text = line.trim();
      if (text) out.push({ kind: act ? 'act' : 'chat', text });
    }
    buf = '';
  };
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (isStar(ch)) {
      while (isStar(raw[i + 1])) i++;
      flush();
      act = !act;
      continue;
    }
    buf += ch;
  }
  flush();
  return out;
}
