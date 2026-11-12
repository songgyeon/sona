import { useEffect, useState } from 'react';
import { formatMin } from '../../shared/clock';
import { DOW_NAMES } from '../../shared/rules';
import type { Film as FilmData, FilmCard, PlayCard } from '../../shared/types';
import { ApiFail, api, imgUrl, newId } from '../api';
import { Back, LinkIcon, Next, Pen, PlayFill } from '../icons';
import { Face, StillStrip, titleClass } from '../poster';

/** 필름 정보. 그 필름의 한 장면, 제목, 캐스트, 컷, 오프닝을 보고 들어간다 */
export function Film({ filmId, go }: { filmId: string; go: (to: string) => void }) {
  const [data, setData] = useState<{ card: FilmCard; film: FilmData } | null>(null);
  const [living, setLiving] = useState<PlayCard | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [toast, setToast] = useState('');

  useEffect(() => {
    Promise.all([api.film(filmId), api.plays()])
      .then(([d, plays]) => {
        setData(d);
        setLiving(plays.find((p) => p.filmId === filmId && !p.ended) ?? null);
      })
      .catch((e) => setErr(e instanceof ApiFail ? e.message : '필름을 불러오지 못했어요.'));
  }, [filmId]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(''), 2200);
    return () => clearTimeout(t);
  }, [toast]);

  /** 이 필름의 주소를 복사한다. 받은 사람은 이 화면으로 바로 온다 */
  const copyLink = async () => {
    const link = `${window.location.origin}/film/${filmId}`;
    try {
      await navigator.clipboard.writeText(link);
      setToast('링크를 복사했어요');
    } catch {
      // 복사가 막힌 브라우저. 이 화면의 주소가 곧 그 링크다
      setToast('주소창의 주소를 복사해 주세요');
    }
  };

  const enter = async () => {
    setBusy(true);
    setErr('');
    try {
      const view = await api.enter(filmId, newId());
      go(`/play/${view.id}?open=1`);
    } catch (e) {
      setErr(e instanceof ApiFail ? e.message : '필름에 들어가지 못했어요.');
      setBusy(false);
    }
  };

  if (!data) return <p className="center">{err || '불러오는 중'}</p>;
  const { film, card } = data;
  const fs = film.firstScene;
  const stills = film.stills ?? [];
  /** 오프닝의 첫 지문. 필름이 어떻게 시작하는지 미리 보인다 */
  const opening = fs.beats.flatMap((b) => (b.kind === 'tell' ? [b.text] : []))[0] ?? '';
  const still = stills[0] ?? film.poster ?? '';
  const when = [`${DOW_NAMES[film.startDow]} ${formatMin(film.startMin)}`, fs.place].filter(Boolean).join(' · ');
  /** 살고 있는 삶이 있으면 그 삶의 프로필로 간다 — 피드가 거기 쌓인다 */
  const castPath = (key: string) => (living ? `/play/${living.id}/cast/${key}` : `/film/${filmId}/cast/${key}`);

  return (
    <main className="app info">
      <div className="top">
        <button className="ico" onClick={() => go('/')} aria-label="홈으로">
          <Back />
        </button>
      </div>

      <div className={still ? 'still grain' : 'still none'}>{still && <img src={imgUrl(still)} alt="" />}</div>

      <section className="head">
        <h1 className={titleClass(film.title)}>{film.title}</h1>
        {film.logline && <p className="line1">{film.logline}</p>}
        <div className="go">
          {living ? (
            <>
              <button className="btn play wide" onClick={() => go(`/play/${living.id}`)}>
                <PlayFill />
                이어 살기
              </button>
              <button className="btn more wide" disabled={busy} onClick={enter}>
                {busy ? '들어가는 중' : '처음부터 다시 살기'}
              </button>
            </>
          ) : (
            <button className="btn play wide" disabled={busy} onClick={enter}>
              <PlayFill />
              {busy ? '들어가는 중' : '필름에 들어가기'}
            </button>
          )}
          {card.mine && (
            <div className="own">
              {/* 비공개 필름은 링크로 와도 보이지 않는다 */}
              {!card.private && (
                <button className="textbtn" onClick={copyLink}>
                  <LinkIcon />
                  링크 복사
                </button>
              )}
              <button className="textbtn" onClick={() => go(`/film/${filmId}/edit`)}>
                <Pen />
                고치기
              </button>
            </div>
          )}
          {err && <p className="warn">{err}</p>}
        </div>
      </section>

      <section className="block first">
        <p className="kicker">캐스트</p>
        <ul className="casts">
          {film.casts.map((c) => (
            <li key={c.key}>
              <button className="castrow" onClick={() => go(castPath(c.key))}>
                <Face id={c.face ?? ''} name={c.name} />
                <span>
                  <strong>{c.name}</strong>
                  {c.role && <small>{c.role}</small>}
                </span>
                <Next />
              </button>
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
            오프닝<span>{when}</span>
          </div>
          <p className="prose">{opening || film.setting}</p>
        </section>
      )}

      <p className="bill">
        {card.mine && (
          <span>
            디렉터<b>나</b>
          </span>
        )}
        {card.private && (
          <span>
            공개 범위<b>비공개</b>
          </span>
        )}
        <span>
          캐스트<b>{film.casts.map((c) => c.name).join(' · ')}</b>
        </span>
      </p>

      {toast && (
        <p className="toast" role="status">
          {toast}
        </p>
      )}
    </main>
  );
}
