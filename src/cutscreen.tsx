/* 오프닝을 읽는 동안 위에 걸리는 그림. 컷이 바뀌면 앞 컷을 밑에 깔고 새 컷이 그 위로 올라온다.
   세로 그림이면 칸이 세로로 길어진다 — 따로 고르는 칸 없이 올린 그림의 방향으로 정한다.
   (2026-11-13 사용자: 「오프닝 사진은 꼭 가로만 돼? 세로로 넣고 싶음」. 시안 A를 골랐다.
    그 뒤 그림이 위 띠 뒤까지 덮고 글이 그 위에 서는 모양으로 바꿨다가, 「세로 그림도 그냥 원래 가로그림처럼 보이게 해줘 아까 a안」으로 A로 되돌렸다) */

import { useCallback, useState } from 'react';
import { imgUrl } from './api';

export function CutScreen({ id }: { id: string }) {
  const [under, setUnder] = useState('');
  const [tall, setTall] = useState(false);
  const look = useCallback((img: HTMLImageElement) => {
    if (img.naturalWidth > 0) setTall(img.naturalHeight > img.naturalWidth);
  }, []);
  // 이미 받아 둔 그림은 load가 먼저 끝나 있을 수 있다
  const seen = useCallback((img: HTMLImageElement | null) => {
    if (img?.complete) look(img);
  }, [look]);

  return (
    <div className={tall ? 'screen grain tall' : 'screen grain'}>
      {under && under !== id && <img key={`under-${under}`} src={imgUrl(under)} alt="" />}
      <img key={id} ref={seen} className="cutin" src={imgUrl(id)} alt="" onLoad={(e) => look(e.currentTarget)} onAnimationEnd={() => setUnder(id)} />
    </div>
  );
}
