import type { CSSProperties } from 'react';

/** 제목에서 색을 뽑는다. 같은 제목은 언제나 같은 색이다 */
export function hueOf(title: string): number {
  let h = 0;
  for (const ch of title) h = (h * 31 + ch.codePointAt(0)!) % 360;
  return h;
}

/** 필름의 포스터. 그림이 없어도 제목과 색으로 한 편 한 편이 달라 보이게 한다 */
export function Poster({ title, casts = [], small = false }: { title: string; casts?: string[]; small?: boolean }) {
  const style = { '--h': hueOf(title || '소나') } as CSSProperties;
  return (
    <div className={small ? 'poster small' : 'poster'} style={style} aria-hidden="true">
      <span className="poster-title">{title || '제목 없는 필름'}</span>
      {!small && casts.length > 0 && <span className="poster-casts">{casts.join(' · ')}</span>}
    </div>
  );
}
