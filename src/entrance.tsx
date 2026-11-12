/* 들어가는 화면. 앱을 열면 영사기가 돌듯 필름 리더가 흐르고(3·2·1), SONA가 뜬다.
   「입장하기」를 누르면 로비로 — 처음 온 사람은 입장권에 이름을 적고 들어간다.
   한 번 들어오면 이 창을 닫기 전까지 다시 뜨지 않는다. 필름이나 삶의 주소로 바로 들어오면 뜨지 않는다 — 링크로 온 사람을 막지 않는다. */

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { api, imgUrl } from './api';
import { ticketNo } from './me';

const SEEN = 'sona.entered';
/** 포스터 한 칸의 너비와 사이(px). 스타일의 .ecell, .erow와 같다 */
const CELL = 64 + 4;

/** 이 주소로 열었을 때 들어가는 화면을 띄우나 */
export function shouldEnter(path: string): boolean {
  if (path !== '/') return false;
  try {
    return sessionStorage.getItem(SEEN) !== '1';
  } catch {
    return true;
  }
}

const calm = (): boolean => {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
};

export function Entrance({ name, onEnter }: { name: string; onEnter: () => void }) {
  /** 리더의 숫자. 0이면 다 셌다 */
  const [n, setN] = useState(() => (calm() ? 0 : 3));
  const [posters, setPosters] = useState<string[]>([]);
  const [leaving, setLeaving] = useState(false);
  const [no] = useState(ticketNo);

  useEffect(() => {
    if (n <= 0) return;
    const t = setTimeout(() => setN(n - 1), 820);
    return () => clearTimeout(t);
  }, [n]);

  // 지금 걸려 있는 필름들의 포스터. 색은 그림에서만 나온다
  useEffect(() => {
    api
      .films()
      .then((list) => setPosters(list.map((f) => f.poster).filter((p) => p.length > 0).slice(0, 10)))
      .catch(() => setPosters([]));
  }, []);

  // 뒤의 화면이 따라 움직이지 않게
  useEffect(() => {
    const root = document.documentElement;
    const before = root.style.overflow;
    root.style.overflow = 'hidden';
    return () => {
      root.style.overflow = before;
    };
  }, []);

  const enter = () => {
    try {
      sessionStorage.setItem(SEEN, '1');
    } catch {
      /* 저장이 막혀 있으면 다음에 또 뜬다 */
    }
    setLeaving(true);
    setTimeout(onEnter, 520);
  };

  // 포스터가 몇 장뿐이어도 필름 한 줄이 화면을 다 채우게 되풀이한다. 그 한 벌을 두 번 이어 붙여 끊김 없이 흐른다
  const set = posters.length === 0 ? [] : Array.from({ length: Math.max(1, Math.ceil((window.innerWidth + CELL) / (posters.length * CELL))) }, () => posters).flat();
  const strip = [...set, ...set];

  return createPortal(
    <div className={`entrance grain${n > 0 ? ' counting' : ' lit'}${leaving ? ' out' : ''}`} onClick={() => n > 0 && setN(0)} role="dialog" aria-label="SONA">
      <span className="eholes left" aria-hidden="true" />
      <span className="eholes right" aria-hidden="true" />
      {n > 0 ? (
        <div className="leader" aria-hidden="true">
          <span className="ring outer" />
          <span className="ring inner" />
          <i className="cross h" />
          <i className="cross v" />
          <span className="sweep" key={`s${n}`} />
          <b key={`n${n}`}>{n}</b>
        </div>
      ) : (
        <div className="marquee">
          <span className="beam" aria-hidden="true" />
          <h1 className="elogo">SONA</h1>
          {strip.length > 0 && (
            <div className="eposters" aria-hidden="true">
              <div className="erow" style={{ animationDuration: `${set.length * 3}s` }}>
                {strip.map((id, i) => (
                  <span className="ecell" key={i}>
                    <img src={imgUrl(id)} alt="" />
                  </span>
                ))}
              </div>
            </div>
          )}
          <button className="btn play wide eenter" onClick={enter}>
            입장하기
          </button>
          <p className="estub">
            <span>No. {no}</span>
            {name && <span>{name} 님</span>}
          </p>
        </div>
      )}
    </div>,
    document.body,
  );
}
