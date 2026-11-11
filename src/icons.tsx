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
export const HomeIcon = () => (
  <Line>
    <path d="M4 10.8 12 4l8 6.8V20h-5.4v-5.6H9.4V20H4z" />
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
