/* 필름의 그림들: 포스터, 얼굴, 필름 한 줄. */

import { imgUrl } from './api';

/** 넓게 띄어 놓는 제목은 짧을 때만 어울린다. 길면 붙여 쓴다 */
export const titleClass = (title: string): string => ([...title.trim()].length > 6 ? 'title long' : 'title');

/** 그림이 있으면 그림, 없으면 검은 판에 제목만 */
export function Art({ id, title }: { id: string; title: string }) {
  if (id) return <img src={imgUrl(id)} alt="" />;
  return (
    <div className="blank">
      <b>{title.trim() || '제목 없는 필름'}</b>
    </div>
  );
}

/** 캐스트의 얼굴. 그림이 없으면 이름 첫 글자 */
export function Face({ id, name }: { id: string; name: string }) {
  return <span className="face">{id ? <img src={imgUrl(id)} alt="" /> : ([...name.trim()][0] ?? '·')}</span>;
}

export interface StripItem {
  id: string;
  title: string;
  poster: string;
}

/** 필름 한 줄. 한 칸이 한 편이고, 제목은 필름 가장자리 글자 자리에 찍는다 */
export function PosterStrip({ items, onPick }: { items: StripItem[]; onPick: (id: string) => void }) {
  return (
    <div className="reel">
      <div className="strip posters named">
        {items.map((f) => (
          <div className="cellwrap" key={f.id}>
            <button className="cell grain" onClick={() => onPick(f.id)} aria-label={`${f.title} 열기`}>
              <Art id={f.poster} title={f.title} />
            </button>
            <small>{f.title}</small>
          </div>
        ))}
      </div>
    </div>
  );
}

/** 컷이 흐르는 필름 한 줄 */
export function StillStrip({ ids }: { ids: string[] }) {
  return (
    <div className="reel">
      <div className="strip stills">
        {ids.map((id) => (
          <span className="cell grain" key={id}>
            <img src={imgUrl(id)} alt="" />
          </span>
        ))}
      </div>
    </div>
  );
}
