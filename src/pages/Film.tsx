import { useEffect, useState } from 'react';
import { formatMin, formatWorld } from '../../shared/clock';
import { DOW_NAMES } from '../../shared/rules';
import type { Film as FilmData, FilmCard, PlayCard } from '../../shared/types';
import { ApiFail, api, newId } from '../api';
import { Poster } from '../poster';

/** 필름 상세. 포스터, 한 줄 소개, 캐스트, 내가 맡을 인물을 보고 들어간다 */
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
      .catch((e) => setErr(e instanceof ApiFail ? e.message : '필름을 못 불러왔어.'));
  }, [filmId]);

  const enter = async () => {
    setBusy(true);
    setErr('');
    try {
      const view = await api.enter(filmId, newId());
      go(`/play/${view.id}`);
    } catch (e) {
      setErr(e instanceof ApiFail ? e.message : '들어가지 못했어.');
      setBusy(false);
    }
  };

  if (!data) return <p className="center muted">{err || '필름을 여는 중…'}</p>;
  const { film, card } = data;
  const fs = film.firstScene;

  return (
    <main className="film">
      <header className="top">
        <button className="ghost" onClick={() => go('/')} aria-label="필름 목록으로">
          ←
        </button>
        {card.mine && <span className="chip">내 필름</span>}
      </header>

      <div className="hero">
        <Poster title={film.title} casts={film.casts.map((c) => c.name)} />

        <div className="about">
          <h1>{film.title}</h1>
          {film.logline && <p className="logline">{film.logline}</p>}

          <div className="me">
            <small>이 필름에서 나는</small>
            <strong>{film.persona.name}</strong>
            {film.persona.line && <span>{film.persona.line}</span>}
          </div>

          <div className="enter">
            {living ? (
              <>
                <button onClick={() => go(`/play/${living.id}`)}>이어 살기 · {formatWorld(living)}</button>
                <button className="quiet" disabled={busy} onClick={enter}>
                  {busy ? '들어가는 중…' : '처음부터 다시 들어가기'}
                </button>
              </>
            ) : (
              <button disabled={busy} onClick={enter}>
                {busy ? '들어가는 중…' : '필름에 들어가기'}
              </button>
            )}
          </div>
          {err && <p className="warn">{err}</p>}

          <section>
            <h2>캐스트</h2>
            <ul className="casts">
              {film.casts.map((c) => (
                <li key={c.key}>
                  <strong>{c.name}</strong>
                  {c.role && <span>{c.role}</span>}
                </li>
              ))}
            </ul>
          </section>

          {film.setting && (
            <section>
              <h2>배경</h2>
              <p className="setting">{film.setting}</p>
            </section>
          )}

          <section>
            <h2>이야기가 시작되는 곳</h2>
            <p>
              {DOW_NAMES[film.startDow]} {formatMin(film.startMin)}
              {fs.place ? ` · ${fs.place}` : ''}
            </p>
            {fs.situation && <p className="setting">{fs.situation}</p>}
          </section>
        </div>
      </div>
    </main>
  );
}
