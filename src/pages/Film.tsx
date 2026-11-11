import { useEffect, useState } from 'react';
import { formatMin } from '../../shared/clock';
import { DOW_NAMES } from '../../shared/rules';
import type { Film as FilmData, FilmCard, PlayCard } from '../../shared/types';
import { ApiFail, api, imgUrl, newId } from '../api';
import { Back, Next, PlayFill } from '../icons';
import { Face, StillStrip, titleClass } from '../poster';

/** 필름 정보. 그 필름의 한 장면, 제목, 캐스트, 컷, 오프닝을 보고 들어간다 */
export function Film({ filmId, go }: { filmId: string; go: (to: string) => void }) {
  const [data, setData] = useState<{ card: FilmCard; film: FilmData } | null>(null);
  const [living, setLiving] = useState<PlayCard | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    Promise.all([api.film(filmId), api.plays()])
      .then(([d, plays]) => {
        setData(d);
        setLiving(plays.find((p) => p.filmId === filmId && !p.ended) ?? null);
      })
      .catch((e) => setErr(e instanceof ApiFail ? e.message : '필름을 불러오지 못했어요.'));
  }, [filmId]);

  const enter = async () => {
    setBusy(true);
    setErr('');
    try {
      const view = await api.enter(filmId, newId());
      go(`/play/${view.id}`);
    } catch (e) {
      setErr(e instanceof ApiFail ? e.message : '필름에 들어가지 못했어요.');
      setBusy(false);
    }
  };

  if (!data) return <p className="center">{err || '불러오는 중'}</p>;
  const { film, card } = data;
  const fs = film.firstScene;
  const stills = film.stills ?? [];
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
              <button className="textbtn" disabled={busy} onClick={enter}>
                {busy ? '들어가는 중' : '처음부터 다시 들어가기'}
              </button>
            </>
          ) : (
            <button className="btn play wide" disabled={busy} onClick={enter}>
              <PlayFill />
              {busy ? '들어가는 중' : '필름에 들어가기'}
            </button>
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

      {(fs.situation || film.setting) && (
        <section className="block sect">
          <div className="rowhead" style={{ padding: 0 }}>
            오프닝<span>{when}</span>
          </div>
          <p className="prose">{fs.situation || film.setting}</p>
        </section>
      )}

      <p className="bill">
        {card.mine && (
          <span>
            디렉터<b>나</b>
          </span>
        )}
        <span>
          캐스트<b>{film.casts.map((c) => c.name).join(' · ')}</b>
        </span>
      </p>
    </main>
  );
}
