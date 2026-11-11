/* 사진을 네모로 자르는 셈.
   자르는 화면은 사진을 끌어 자리를 맞추고 크기를 바꾼다. 틀 안에 보이는 네모가 그대로 잘린다.
   계산뿐이라 화면 없이도 돌려 볼 수 있다. */

import { RULES } from './rules';

/** 사진의 크기(픽셀) */
export interface Size {
  w: number;
  h: number;
}

/** 지금 틀 안에 보이는 자리 */
export interface View {
  /** 1이면 사진의 짧은 쪽이 틀에 꼭 맞는다. 커질수록 가까이 본다 */
  zoom: number;
  /** 틀 한가운데에 놓인 사진의 점(사진의 픽셀) */
  cx: number;
  cy: number;
}

/** 잘라 낼 네모(사진의 픽셀) */
export interface Box {
  x: number;
  y: number;
  side: number;
}

const between = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/** 틀에 담기는 네모의 한 변(사진의 픽셀) */
export const sideOf = (s: Size, zoom: number): number => Math.min(s.w, s.h) / zoom;

/** 틀 밖으로 빈 곳이 보이지 않게 붙든다. 크기도 정해진 사이에 둔다 */
export function hold(s: Size, v: View): View {
  const zoom = between(v.zoom, 1, RULES.crop.maxZoom);
  const half = sideOf(s, zoom) / 2;
  return { zoom, cx: between(v.cx, half, s.w - half), cy: between(v.cy, half, s.h - half) };
}

/** 처음 보이는 자리. 사진이 가득 차게 두고, 세로로 긴 사진은 맨 위에서 시작한다 — 얼굴은 보통 위쪽에 있다 */
export function startView(s: Size): View {
  return hold(s, { zoom: 1, cx: s.w / 2, cy: s.h > s.w ? 0 : s.h / 2 });
}

/** 지금 자리에서 잘라 낼 네모 */
export function boxOf(s: Size, v: View): Box {
  const held = hold(s, v);
  const side = sideOf(s, held.zoom);
  return { x: held.cx - side / 2, y: held.cy - side / 2, side };
}

/** 사진 한 픽셀이 화면에서 차지하는 크기. frame은 틀의 한 변(화면의 픽셀) */
export const scaleOf = (s: Size, v: View, frame: number): number => frame / sideOf(s, v.zoom);

/** 끌기. 화면에서 (dx, dy)만큼 끌면 사진이 손가락을 따라온다 */
export function drag(s: Size, v: View, frame: number, dx: number, dy: number): View {
  const k = scaleOf(s, v, frame);
  return hold(s, { ...v, cx: v.cx - dx / k, cy: v.cy - dy / k });
}

/** 크기 바꾸기. 화면의 (fx, fy) — 틀 한가운데에서 잰 자리 — 밑에 있던 사진의 점이 그 자리에 머문다 */
export function zoomTo(s: Size, v: View, frame: number, zoom: number, fx = 0, fy = 0): View {
  const next = between(zoom, 1, RULES.crop.maxZoom);
  const before = scaleOf(s, v, frame);
  const after = scaleOf(s, { ...v, zoom: next }, frame);
  const px = v.cx + fx / before;
  const py = v.cy + fy / before;
  return hold(s, { zoom: next, cx: px - fx / after, cy: py - fy / after });
}

/** 올릴 그림의 한 변. 정해진 크기까지만 줄이고, 작은 사진을 억지로 키우지 않는다 */
export const outSide = (box: Box, max: number): number => Math.max(1, Math.min(max, Math.round(box.side)));
