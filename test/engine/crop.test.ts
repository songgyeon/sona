import { describe, expect, it } from 'vitest';
import { boxOf, drag, hold, outSide, scaleOf, sideOf, startView, zoomTo, type Size, type View } from '../../shared/crop';
import { RULES } from '../../shared/rules';

/* 사진을 네모로 자르는 셈. 틀은 한 변이 300인 네모다(화면의 픽셀). */
const FRAME = 300;
const WIDE: Size = { w: 1200, h: 800 };
const TALL: Size = { w: 600, h: 1200 };
const round = (b: { x: number; y: number; side: number }) => ({ x: Math.round(b.x), y: Math.round(b.y), side: Math.round(b.side) });

describe('사진 자르기: 처음 보이는 자리', () => {
  it('사진이 틀에 가득 찬다. 가로로 긴 사진은 가운데에서 시작한다', () => {
    expect(boxOf(WIDE, startView(WIDE))).toEqual({ x: 200, y: 0, side: 800 });
    expect(boxOf({ w: 500, h: 500 }, startView({ w: 500, h: 500 }))).toEqual({ x: 0, y: 0, side: 500 });
  });

  it('세로로 긴 사진은 맨 위에서 시작한다', () => {
    expect(boxOf(TALL, startView(TALL))).toEqual({ x: 0, y: 0, side: 600 });
  });
});

describe('사진 자르기: 끌기', () => {
  it('끄는 만큼 사진이 따라온다', () => {
    // 화면의 75는 사진의 200이다(틀 300에 사진 800이 담겨 있다)
    expect(scaleOf(WIDE, startView(WIDE), FRAME)).toBe(0.375);
    expect(boxOf(WIDE, drag(WIDE, startView(WIDE), FRAME, 75, 0))).toEqual({ x: 0, y: 0, side: 800 });
    expect(boxOf(WIDE, drag(WIDE, startView(WIDE), FRAME, -37.5, 0))).toEqual({ x: 300, y: 0, side: 800 });
    // 세로로 긴 사진을 위로 끌면 아래쪽이 보인다
    expect(boxOf(TALL, drag(TALL, startView(TALL), FRAME, 0, -150))).toEqual({ x: 0, y: 300, side: 600 });
  });

  it('사진 밖으로는 못 나간다', () => {
    expect(boxOf(WIDE, drag(WIDE, startView(WIDE), FRAME, 9999, 9999))).toEqual({ x: 0, y: 0, side: 800 });
    expect(boxOf(WIDE, drag(WIDE, startView(WIDE), FRAME, -9999, -9999))).toEqual({ x: 400, y: 0, side: 800 });
    expect(boxOf(TALL, drag(TALL, startView(TALL), FRAME, 0, -9999))).toEqual({ x: 0, y: 600, side: 600 });
  });
});

describe('사진 자르기: 크기', () => {
  it('가까이 보면 네모가 작아진다. 가운데는 그대로다', () => {
    const v = zoomTo(WIDE, startView(WIDE), FRAME, 2);
    expect(sideOf(WIDE, v.zoom)).toBe(400);
    expect(boxOf(WIDE, v)).toEqual({ x: 400, y: 200, side: 400 });
  });

  it('손가락 밑에 있던 점이 그 자리에 머문다', () => {
    const start = startView(WIDE);
    // 틀의 오른쪽 아래 구석 근처(가운데에서 100, 100)
    const point = (v: View) => ({ x: v.cx + 100 / scaleOf(WIDE, v, FRAME), y: v.cy + 100 / scaleOf(WIDE, v, FRAME) });
    const before = point(start);
    const after = point(zoomTo(WIDE, start, FRAME, 2.5, 100, 100));
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
  });

  it('정해진 사이를 넘지 않는다', () => {
    expect(zoomTo(WIDE, startView(WIDE), FRAME, 0.2).zoom).toBe(1);
    expect(zoomTo(WIDE, startView(WIDE), FRAME, 99).zoom).toBe(RULES.crop.maxZoom);
    expect(hold(WIDE, { zoom: 99, cx: 600, cy: 400 }).zoom).toBe(RULES.crop.maxZoom);
  });

  it('구석에서 멀리 보기로 돌아가도 빈 곳이 보이지 않는다', () => {
    let v = zoomTo(TALL, startView(TALL), FRAME, RULES.crop.maxZoom);
    v = drag(TALL, v, FRAME, -9999, -9999); // 오른쪽 아래 구석
    expect(round(boxOf(TALL, v))).toEqual({ x: 450, y: 1050, side: 150 });
    expect(boxOf(TALL, zoomTo(TALL, v, FRAME, 1))).toEqual({ x: 0, y: 600, side: 600 });
  });

  it('무엇을 얼마나 하든 네모는 사진 안에 있다', () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648) * 2 - 1;
    for (const s of [WIDE, TALL, { w: 333, h: 777 }, { w: 4000, h: 3000 }]) {
      let v = startView(s);
      for (let i = 0; i < 400; i++) {
        v = i % 3 === 0 ? zoomTo(s, v, FRAME, v.zoom * (1 + rnd() * 0.6), rnd() * 150, rnd() * 150) : drag(s, v, FRAME, rnd() * 400, rnd() * 400);
        const b = boxOf(s, v);
        expect(b.x).toBeGreaterThanOrEqual(-1e-6);
        expect(b.y).toBeGreaterThanOrEqual(-1e-6);
        expect(b.x + b.side).toBeLessThanOrEqual(s.w + 1e-6);
        expect(b.y + b.side).toBeLessThanOrEqual(s.h + 1e-6);
        expect(b.side).toBeGreaterThanOrEqual(Math.min(s.w, s.h) / RULES.crop.maxZoom - 1e-6);
      }
    }
  });
});

describe('사진 자르기: 올리는 크기', () => {
  it('정해진 크기까지만 줄인다. 작은 사진을 키우지 않는다', () => {
    expect(outSide({ x: 0, y: 0, side: 2000 }, RULES.crop.face)).toBe(RULES.crop.face);
    expect(outSide({ x: 0, y: 0, side: 300.4 }, RULES.crop.face)).toBe(300);
    expect(outSide({ x: 0, y: 0, side: 0.2 }, RULES.crop.face)).toBe(1);
  });
});
