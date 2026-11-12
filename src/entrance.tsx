/* 들어가는 화면. 앱을 열면 검은 화면에 가는 빛줄기가 그어지고, SONA가 한 글자씩 떴다가 그 자리에서 사라진다.
   그다음 조명 아래로 영화표 한 장이 올라온다 — 지금 걸린 필름의 포스터, 입장권 번호, 내 이름, 들어온 날짜와 시각.
   「입장하기」를 누르면 절취선을 따라 아래 반쪽이 뜯겨 나가고 상영작으로 — 처음 온 사람은 그다음 입장권에 이름을 적는다.
   한 번 들어오면 이 창을 닫기 전까지 다시 뜨지 않는다. 필름이나 삶의 주소로 바로 들어오면 뜨지 않는다 — 링크로 온 사람을 막지 않는다. */

import { type AnimationEvent, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { DOW_NAMES, RULES } from '../shared/rules';
import { api, imgUrl } from './api';
import { ticketNo } from './me';

const SEEN = 'sona.entered';

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

/** 표에 찍는 날짜와 시각. 「11. 12 목 · 17:40」 */
const stamp = (d = new Date()): string =>
  `${d.getMonth() + 1}. ${d.getDate()} ${DOW_NAMES[d.getDay()]![0]} · ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

export function Entrance({ name, onEnter }: { name: string; onEnter: () => void }) {
  /** 연출을 건너뛰었나 — 화면을 눌렀거나 움직임을 줄인 기기다. 바로 표가 선다 */
  const [skip, setSkip] = useState(calm);
  /** 표가 올라오기 시작했나. 그 전에는 「입장하기」가 눌리지 않는다(보이지 않는 단추를 누르게 하지 않는다) */
  const [shown, setShown] = useState(false);
  const [posters, setPosters] = useState<string[]>([]);
  /** 표에 걸린 포스터의 차례 */
  const [at, setAt] = useState(0);
  const [torn, setTorn] = useState(false);
  const [no] = useState(ticketNo);
  const [when] = useState(() => stamp());
  const ready = skip || shown;

  // 지금 걸려 있는 필름들의 포스터. 색은 그림에서만 나온다
  useEffect(() => {
    api
      .films()
      .then((list) => setPosters(list.map((f) => f.poster).filter((p) => p.length > 0).slice(0, 10)))
      .catch(() => setPosters([]));
  }, []);

  // 걸린 필름이 여럿이면 표의 그림이 몇 초마다 다음 포스터로 서서히 넘어간다
  useEffect(() => {
    if (posters.length < 2 || torn) return;
    const t = setInterval(() => setAt((i) => (i + 1) % posters.length), RULES.entrance.posterMs);
    return () => clearInterval(t);
  }, [posters.length, torn]);

  // 뒤의 화면이 따라 움직이지 않게
  useEffect(() => {
    const root = document.documentElement;
    const before = root.style.overflow;
    root.style.overflow = 'hidden';
    return () => {
      root.style.overflow = before;
    };
  }, []);

  /** 표를 뜯고 들어간다 */
  const enter = () => {
    if (torn) return;
    try {
      sessionStorage.setItem(SEEN, '1');
    } catch {
      /* 저장이 막혀 있으면 다음에 또 뜬다 */
    }
    setTorn(true);
    setTimeout(onEnter, RULES.entrance.tearMs);
  };

  const onIssue = (e: AnimationEvent) => {
    if (e.animationName === 'eissue') setShown(true);
  };

  return createPortal(
    <div className={`entrance grain${skip ? ' skip' : ''}${torn ? ' torn' : ''}`} onClick={() => setSkip(true)} role="dialog" aria-label="SONA">
      <span className="eslit" aria-hidden="true" />
      <p className="etitle" aria-hidden="true">
        <span>S</span>
        <span>O</span>
        <span>N</span>
        <span>A</span>
      </p>
      <span className="espot" aria-hidden="true" />
      <div className="efloat">
        <span className="efloor" aria-hidden="true" />
        <div className="eticket" onAnimationStart={onIssue}>
          <div className="et-main">
            <div className="et-head">
              <b>SONA</b>
              <span>No. {no}</span>
            </div>
            <div className="et-art" aria-hidden="true">
              {posters.map((id, i) => (
                <img key={`${id}-${i}`} className={i === at ? 'on' : ''} src={imgUrl(id)} alt="" />
              ))}
            </div>
            <div className="et-name">
              <span>{name ? `${name} 님` : ''}</span>
              <span className="et-when">{when}</span>
            </div>
          </div>
          <button
            className="et-stub"
            aria-disabled={!ready}
            onClick={(e) => {
              // 표가 아직 안 보이면 이 자리를 누른 것은 연출을 건너뛰는 것이다
              if (!ready) return;
              e.stopPropagation();
              enter();
            }}
          >
            입장하기
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
