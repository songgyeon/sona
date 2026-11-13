/* 미리 보기 — 개봉하기 전에, 들어가는 사람이 보는 화면을 본다.
   필름 정보(그림, 제목, 한 줄 소개, 캐스트)와 오프닝(영상 → 제목 → 컷·지문·대사 → 내 배역 카드).
   필름 정보 화면과 재생 화면을 그대로 빌려 그린다. 첫째 배역으로 들어간 것으로 본다. 아무것도 저장하지 않는다. */

import { CutScreen } from './cutscreen';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { formatMin, formatWorld } from '../shared/clock';
import { cutsOf, hasLines } from '../shared/opening';
import { DOW_NAMES } from '../shared/rules';
import type { Film } from '../shared/types';
import { imgUrl } from './api';
import { useBgm } from './bgm';
import { Close, Down, PlayFill, Sound, SoundOff } from './icons';
import { MeCard, Opening, TITLE_MS, TitleCard } from './pages/Play';
import { Face, StillStrip, titleClass } from './poster';
import { ReelOverlay } from './reel';

export type PeekMode = 'film' | 'opening';

export function Preview({ film, start, onClose }: { film: Film; start: PeekMode; onClose: () => void }) {
  const [mode, setMode] = useState<PeekMode>(start);
  /** 오프닝을 처음부터 다시 틀 때마다 는다 */
  const [run, setRun] = useState(0);
  const watch = () => {
    setMode('opening');
    setRun((n) => n + 1);
  };

  // 뒤의 만드는 화면이 따라 움직이지 않게 붙들어 둔다. Esc로 닫는다
  useEffect(() => {
    const root = document.documentElement;
    const before = root.style.overflow;
    root.style.overflow = 'hidden';
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape' && !document.querySelector('.opener')) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      root.style.overflow = before;
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return createPortal(
    <div className="preview" role="dialog" aria-modal="true" aria-label="미리 보기">
      <div className="pvbar">
        <span className="pvk">미리 보기</span>
        <div className="pvtabs" role="tablist">
          <button role="tab" aria-selected={mode === 'film'} onClick={() => setMode('film')}>
            필름 정보
          </button>
          <button role="tab" aria-selected={mode === 'opening'} onClick={watch}>
            오프닝
          </button>
        </div>
        <button className="ico" onClick={onClose} aria-label="미리 보기 닫기">
          <Close />
        </button>
      </div>
      <div className="pvbody">{mode === 'film' ? <FilmPeek film={film} onEnter={watch} /> : <OpeningPeek key={run} film={film} onAgain={watch} />}</div>
    </div>,
    document.body,
  );
}

/** 필름 정보 화면. 누를 수 있는 것은 「필름에 들어가기」뿐이다 — 누르면 오프닝을 튼다 */
function FilmPeek({ film, onEnter }: { film: Film; onEnter: () => void }) {
  const fs = film.firstScene;
  const stills = film.stills ?? [];
  const opening = fs.beats.flatMap((b) => (b.kind === 'tell' ? [b.text] : []))[0] ?? '';
  const still = stills[0] ?? film.poster ?? '';
  const when = [`${DOW_NAMES[film.startDow]} ${formatMin(film.startMin)}`, fs.place].filter(Boolean).join(' · ');
  const me = film.persona;
  return (
    <div className="app info pvfilm">
      <div className={still ? 'still grain' : 'still none'}>{still && <img src={imgUrl(still)} alt="" />}</div>

      <section className="head">
        <h1 className={titleClass(film.title)}>{film.title}</h1>
        {film.logline && <p className="line1">{film.logline}</p>}
        {(film.tags ?? []).length > 0 && (
          <p className="tags">
            {film.tags.map((t) => (
              <span key={t} className="tag">
                #{t}
              </span>
            ))}
          </p>
        )}
        <div className="go">
          <div className="asme">
            <p>들어가는 사람</p>
            <div className="asone">
              <div className="aswho">
                <Face id={me.face} name={me.name} />
                <span>
                  <b>{me.name}</b>
                  <small>{me.player ? '배역 · 유저 이름' : '배역'}</small>
                </span>
              </div>
            </div>
          </div>
          <button className="btn play wide" onClick={onEnter}>
            <PlayFill />
            필름에 들어가기
          </button>
        </div>
      </section>

      <section className="block first">
        <p className="kicker">캐스트</p>
        <ul className="casts">
          <li>
            <div className="castrow me">
              <Face id={me.face} name={me.name} />
              <span>
                <strong>
                  {me.name}
                  <em className="metag">나</em>
                </strong>
                {me.line && <small>{me.line}</small>}
              </span>
              <span />
            </div>
          </li>
          {film.casts.map((c) => (
            <li key={c.key}>
              <div className="castrow">
                <Face id={c.face ?? ''} name={c.name} />
                <span>
                  <strong>{c.name}</strong>
                  {c.role && <small>{c.role}</small>}
                </span>
                <span />
              </div>
            </li>
          ))}
        </ul>
      </section>

      {stills.length > 0 && (
        <section className="block">
          <div className="rowhead">스틸</div>
          <StillStrip ids={stills} />
        </section>
      )}

      {(opening || film.setting) && (
        <section className="block sect">
          <div className="rowhead" style={{ padding: 0 }}>
            첫 장면<span>{when}</span>
          </div>
          <p className="prose">{opening || film.setting}</p>
        </section>
      )}

      <p className="bill">
        <span>
          캐스트<b>{film.casts.map((c) => c.name).join(' · ')}</b>
        </span>
      </p>
    </div>
  );
}

/** 오프닝. 들어가는 순간과 같다: 오프닝 영상(없으면 검은 화면에 제목), 컷·지문·대사, 내 배역 카드.
    읽는 자리에 닿은 줄의 컷이 위 화면에 걸린다(재생 화면과 같은 셈) */
function OpeningPeek({ film, onAgain }: { film: Film; onAgain: () => void }) {
  // 오프닝 영상이 있으면 영상이 오프닝이다. 없으면 기본 오프닝(검은 화면에 제목)이 뜬다
  const [reelOn, setReelOn] = useState((film.reel?.clips.length ?? 0) > 0);
  const [card, setCard] = useState(!((film.reel?.clips.length ?? 0) > 0));
  const [reading, setReading] = useState(hasLines(film));
  const [shot, setShot] = useState('');
  const flow = useRef<HTMLElement>(null);
  const tick = useRef(0);
  const still = useRef(0);
  const bgm = useBgm(film.bgm ?? '', !reelOn && !card);

  useEffect(() => {
    if (!card || reelOn) return;
    const t = setTimeout(() => setCard(false), TITLE_MS);
    return () => clearTimeout(t);
  }, [card, reelOn]);

  const restOf = (el: HTMLElement) => el.scrollHeight - el.scrollTop - el.clientHeight;
  const atEnd = () => {
    const el = flow.current;
    return !el || restOf(el) <= 12;
  };
  const look = () => {
    const el = flow.current;
    if (!el) return;
    const marks = [...el.querySelectorAll<HTMLElement>('[data-cut]')];
    if (marks.length === 0) {
      setShot('');
      return;
    }
    const rest = restOf(el);
    const reach = el.clientHeight * 0.6;
    const at = rest >= reach ? 0.4 : 1 - 0.6 * (rest / reach);
    const line = el.scrollTop + el.clientHeight * at;
    let cur = marks[0]!;
    for (const m of marks) if (m.offsetTop <= line) cur = m;
    setShot(cur.dataset.cut ?? '');
  };
  const onScroll = () => {
    cancelAnimationFrame(tick.current);
    tick.current = requestAnimationFrame(look);
    window.clearTimeout(still.current);
    still.current = window.setTimeout(() => {
      if (atEnd()) setReading(false);
    }, 160);
  };
  useLayoutEffect(() => {
    if (reading && atEnd()) setReading(false);
    look();
  }, [reading, card]);
  useEffect(
    () => () => {
      cancelAnimationFrame(tick.current);
      window.clearTimeout(still.current);
    },
    [],
  );

  const clock = { startDow: film.startDow, startMin: film.startMin, elapsed: 0 };
  const onScreen = shot || cutsOf(film)[0] || (film.stills ?? [])[0] || film.poster || '';
  const place = film.firstScene.place;

  return (
    <div className="app playing pvplay">
      {bgm.has && (
        <button className="ico pvsound" onClick={bgm.toggle} aria-label={bgm.on ? '배경 음악 끄기' : '배경 음악 켜기'} aria-pressed={bgm.on}>
          {bgm.on ? <Sound /> : <SoundOff />}
        </button>
      )}
      {onScreen && reading && <CutScreen id={onScreen} />}
      <p className="where">
        {formatWorld(clock)}
        {place && (
          <>
            <i>—</i>
            {place}
          </>
        )}
      </p>
      <section className="flow" ref={flow} onScroll={onScroll}>
        {film.firstScene.beats.length > 0 && <Opening film={film} inline={!reading} />}
        <MeCard me={film.persona} />
        {!reading && (
          <div className="pvend">
            <p>여기부터는 개봉한 뒤에 들어가서 살아요.</p>
            <button className="btn more" onClick={onAgain}>
              처음부터 다시 보기
            </button>
          </div>
        )}
      </section>
      {reading && (
        <footer className="foot more">
          <button className="ico" onClick={() => flow.current?.scrollBy({ top: flow.current.clientHeight * 0.8, behavior: 'smooth' })} aria-label="이어서 읽기">
            <Down />
          </button>
        </footer>
      )}
      {reelOn && film.reel && <ReelOverlay reel={film.reel} onDone={() => setReelOn(false)} />}
      {card && <TitleCard title={film.title} />}
    </div>
  );
}
