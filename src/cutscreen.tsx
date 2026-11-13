/* 오프닝을 읽는 동안 위에 걸리는 그림. 컷이 바뀌면 앞 컷을 밑에 깔고 새 컷이 그 위로 올라온다.
   세로 그림이면 화면 위를 덮는다 — 화면 너비에 맞춰 원래 비율 그대로 걸고(확대하지 않는다), 아래쪽은 어둠으로 녹아
   글이 그 위에 선다. 따로 고르는 칸 없이 올린 그림의 방향으로 정한다.
   (2026-11-13 사용자: 「오프닝 사진은 꼭 가로만 돼? 세로로 넣고 싶음」, 「b로 해서 a처럼 사진 그대로 유지하면 안 돼?」) */

import { type CSSProperties, useCallback, useState } from 'react';
import { imgUrl } from './api';

export function CutScreen({ id }: { id: string }) {
  const [under, setUnder] = useState('');
  /** 세로 그림이면 높이를 너비로 나눈 값. 가로 그림이면 0 */
  const [tall, setTall] = useState(0);
  const look = useCallback((img: HTMLImageElement) => {
    if (img.naturalWidth > 0) setTall(img.naturalHeight > img.naturalWidth ? img.naturalHeight / img.naturalWidth : 0);
  }, []);
  // 이미 받아 둔 그림은 load가 먼저 끝나 있을 수 있다
  const seen = useCallback((img: HTMLImageElement | null) => {
    if (img?.complete) look(img);
  }, [look]);

  return (
    <div className={tall ? 'screen grain tall' : 'screen grain'} style={tall ? ({ '--rh': tall.toFixed(4) } as CSSProperties) : undefined}>
      {under && under !== id && <img key={`under-${under}`} src={imgUrl(under)} alt="" />}
      <img key={id} ref={seen} className="cutin" src={imgUrl(id)} alt="" onLoad={(e) => look(e.currentTarget)} onAnimationEnd={() => setUnder(id)} />
    </div>
  );
}
