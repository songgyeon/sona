import { describe, expect, it } from 'vitest';
import { splitLine } from '../../shared/line';

/* 말하는 칸은 하나다. 지문은 *별표* 사이에 쓴다. 화면과 서버가 같은 셈으로 가른다 */

describe('내가 쓴 글 가르기', () => {
  it('별표 사이는 지문, 밖은 대사다. 쓴 차례 그대로다', () => {
    expect(splitLine('*문을 연다* 왔어? *웃는다*')).toEqual([
      { kind: 'act', text: '문을 연다' },
      { kind: 'chat', text: '왔어?' },
      { kind: 'act', text: '웃는다' },
    ]);
  });

  it('별표만 걷는다. 글자는 고치지 않는다', () => {
    expect(splitLine('  그거, (진짜) 맛있어…  ')).toEqual([{ kind: 'chat', text: '그거, (진짜) 맛있어…' }]);
  });

  it('줄바꿈 하나가 한 줄이다. 빈 줄은 버린다', () => {
    expect(splitLine('응.\n\n*찌개를 뜬다.\n한 입 먹는다.*\n맛있다.')).toEqual([
      { kind: 'chat', text: '응.' },
      { kind: 'act', text: '찌개를 뜬다.' },
      { kind: 'act', text: '한 입 먹는다.' },
      { kind: 'chat', text: '맛있다.' },
    ]);
  });

  it('별표가 여럿 붙어 있어도 하나로 친다. 전각 별표도 별표다', () => {
    expect(splitLine('**고개를 든다** 응')).toEqual([
      { kind: 'act', text: '고개를 든다' },
      { kind: 'chat', text: '응' },
    ]);
    expect(splitLine('＊고개를 든다＊응')).toEqual([
      { kind: 'act', text: '고개를 든다' },
      { kind: 'chat', text: '응' },
    ]);
  });

  it('닫지 않은 별표 뒤는 끝까지 지문이다', () => {
    expect(splitLine('잘 자. *불을 끈다')).toEqual([
      { kind: 'chat', text: '잘 자.' },
      { kind: 'act', text: '불을 끈다' },
    ]);
  });

  it('쓴 것이 없으면 아무것도 없다', () => {
    expect(splitLine('')).toEqual([]);
    expect(splitLine('  \n ')).toEqual([]);
    expect(splitLine('** * **')).toEqual([]);
  });
});
