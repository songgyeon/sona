/* 그림 글자. 가는 선 하나로 그린다. */

import type { ReactNode } from 'react';

const Line = ({ children }: { children: ReactNode }) => (
  <svg className="line" viewBox="0 0 24 24" aria-hidden="true">
    {children}
  </svg>
);

export const Back = () => (
  <Line>
    <path d="M14.5 5.5 8 12l6.5 6.5" />
  </Line>
);
export const Next = () => (
  <Line>
    <path d="M9.5 5.5 16 12l-6.5 6.5" />
  </Line>
);
export const Down = () => (
  <Line>
    <path d="M5.5 9.5 12 16l6.5-6.5" />
  </Line>
);
export const Up = () => (
  <Line>
    <path d="M5.5 14.5 12 8l6.5 6.5" />
  </Line>
);
export const Close = () => (
  <Line>
    <path d="M6 6l12 12M18 6 6 18" />
  </Line>
);
export const Search = () => (
  <Line>
    <circle cx="11" cy="11" r="6.4" />
    <path d="M15.8 15.8 20.2 20.2" />
  </Line>
);
/** 입장권. 양옆이 파이고 뜯는 자리에 점선이 있다 — 「상영작」 */
export const Ticket = () => (
  <Line>
    <path d="M3.5 6.5h17V10a2 2 0 0 0 0 4v3.5h-17V14a2 2 0 0 0 0-4z" />
    <path d="M15 8.6v1.5M15 11.25v1.5M15 13.9v1.5" />
  </Line>
);
/** 책갈피 — 장면 저장 */
export const Bookmark = () => (
  <Line>
    <path d="M6.5 4h11v16l-5.5-4-5.5 4z" />
  </Line>
);
/** 촬영기. 릴 둘을 얹은 몸통과 렌즈 — 「크랭크인」 */
export const Camera = () => (
  <Line>
    <circle cx="7.6" cy="6.4" r="2.6" />
    <circle cx="13.6" cy="6.4" r="2.6" />
    <rect x="3.5" y="10" width="12.5" height="9" rx="1" />
    <path d="M16 13.2 20.5 10.8v7.4L16 15.8" />
  </Line>
);
export const Plus = () => (
  <Line>
    <path d="M12 5v14M5 12h14" />
  </Line>
);
export const PlayLine = () => (
  <Line>
    <path d="M7.5 5v14L19 12z" />
  </Line>
);
export const FilmIcon = () => (
  <Line>
    <rect x="5" y="3.6" width="14" height="16.8" rx="1" />
    <path d="M8.4 3.6v16.8M15.6 3.6v16.8M5 8h3.4M5 12h3.4M5 16h3.4M15.6 8H19M15.6 12H19M15.6 16H19" />
  </Line>
);
export const Arrow = () => (
  <Line>
    <path d="M5 12h13.5M13 6.5l5.5 5.5-5.5 5.5" />
  </Line>
);
export const LinkIcon = () => (
  <Line>
    <path d="M10.2 13.8a3.6 3.6 0 0 0 5.1 0l3-3a3.6 3.6 0 0 0-5.1-5.1l-1.2 1.2M13.8 10.2a3.6 3.6 0 0 0-5.1 0l-3 3a3.6 3.6 0 0 0 5.1 5.1l1.2-1.2" />
  </Line>
);
export const Pen = () => (
  <Line>
    <path d="M5 19l.9-3.9L16.6 4.4a1.6 1.6 0 0 1 2.3 0l.7.7a1.6 1.6 0 0 1 0 2.3L8.9 18.1 5 19zM14.8 6.2l3 3" />
  </Line>
);
export const Upload = () => (
  <Line>
    <path d="M12 16V5M7.5 9.5 12 5l4.5 4.5M5 19h14" />
  </Line>
);

/** 채워서 그리는 것들 */
export const PlayFill = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M6 3.6v16.8L20.4 12z" />
  </svg>
);
export const SkipFill = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M3.5 5.5v13l8.5-6.5zM12 5.5v13l8.5-6.5z" />
  </svg>
);
export const Bubble = () => (
  <svg className="bubble" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M4.5 5.5h15v10.5h-8.2L7 19.6V16H4.5z" />
  </svg>
);

/** 소리 켜짐 */
export const Sound = () => (
  <Line>
    <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" />
    <path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" />
  </Line>
);
/** 소리 꺼짐 */
export const SoundOff = () => (
  <Line>
    <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" />
    <path d="m16 9.5 5 5M21 9.5l-5 5" />
  </Line>
);
/** 멈춤 */
export const Pause = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
    <rect x="6.5" y="5" width="4" height="14" />
    <rect x="13.5" y="5" width="4" height="14" />
  </svg>
);
