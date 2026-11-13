import { describe, expect, it } from 'vitest';
import { overused } from '../../worker/engine/echo';

/* 같은 말이 도는지 세는 셈. 고치지 않고 세기만 한다 */

describe('같은 말 세기', () => {
  it('여러 글에 걸쳐 세 번 넘게 나온 말을 고른다. 끝이 달라도 같은 말로 센다', () => {
    const texts = ['무심하게 책장을 넘긴다.', '무심한 얼굴로 창밖을 본다.', '컵을 무심히 내려놓는다.', '문이 닫힌다.'];
    expect(overused(texts, [])).toEqual(['무심']);
  });

  it('한 글에 여러 번 나와도 한 번으로 친다', () => {
    expect(overused(['시선을 피한다. 시선이 흔들린다. 시선을 든다.', '시선을 돌린다.'], [])).toEqual([]);
    expect(overused(['시선을 피한다.', '시선이 흔들린다.', '시선을 든다.'], [])).toEqual(['시선']);
  });

  it('많이 나온 것부터 적는다. 정해진 수까지만', () => {
    const texts = ['한숨 어깨 시선', '한숨 어깨 시선', '한숨 어깨 시선', '한숨 시선', '시선'];
    expect(overused(texts, [])).toEqual(['시선', '한숨', '어깨']);
    const many = Array.from({ length: 3 }, () => '가방 나무 다리 라면 마당 바람 사탕');
    expect(overused(many, [])).toHaveLength(5);
  });

  it('사람 이름과 부르는 말은 세지 않는다. 조사가 붙어도 같다', () => {
    const texts = ['한서가 고개를 든다.', '한서는 고개를 젓는다.', '수아 씨, 한서의 고개가 돌아간다.', '선배가 고개를 숙인다.', '선배, 선배는요.', '선배도요.'];
    expect(overused(texts, ['한서', '수아 씨', '선배'])).toEqual(['고개']);
  });

  it('「천천히」는 센다 — 흔한 말로 빼 두었다가, 지문 21줄에 5번 도는 것을 보고 돌렸다', () => {
    const texts = ['이겸이 천천히 몸을 일으킨다.', '그가 천천히 몸을 돌린다.', '손에 힘을 빼고 천천히 뗀다.', '구두 소리가 울린다.'];
    expect(overused(texts, [])).toContain('천천히');
  });

  it('어느 글에나 흔한 말은 세지 않는다', () => {
    expect(overused(['그는 지금 여기 있다.', '그는 지금 여기 없다.', '그는 지금 여기 있었다.'], [])).toEqual([]);
  });

  it('한 글자짜리 말은 흉내말만 센다', () => {
    expect(overused(['툭 던진다.', '어깨를 툭 친다.', '말을 툭 뱉는다.'], [])).toEqual(['툭']);
    // 겹쳐 쓴 것도 같은 말이다
    expect(overused(['툭툭 친다.', '컵을 툭 놓는다.', '툭, 떨어진다.'], [])).toEqual(['툭']);
    expect(overused(['문 앞에 선다.', '문 뒤로 숨는다.', '문 옆에 기댄다.'], [])).toEqual([]);
  });
});
