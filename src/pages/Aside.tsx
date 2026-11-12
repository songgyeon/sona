import { useEffect, useState } from 'react';
import { formatWorld } from '../../shared/clock';
import { josa } from '../../shared/ko';
import type { PlayView } from '../../shared/types';
import { ApiFail, api } from '../api';
import { Back } from '../icons';
import { Face } from '../poster';
import { TITLE_MS } from './Play';
import { Tabs } from '../tabs';
import { goBack } from '../router';

/** 한편. 내가 없는 자리에서 캐스트 둘이 나눈 장면을 읽기만 한다.
    화면에 거는 그림도, 말하는 칸도 없다 — 나는 그 자리에 없다 */
export function Aside({ playId, asideId, go }: { playId: string; asideId: string; go: (to: string) => void }) {
  const [view, setView] = useState<PlayView | null>(null);
  const [err, setErr] = useState('');
  /** 영화의 사이 제목처럼, 「한편,」이 먼저 뜬다 */
  const [card, setCard] = useState(true);

  useEffect(() => {
    api
      .play(playId)
      .then(setView)
      .catch((e) => setErr(e instanceof ApiFail ? e.message : '장면을 불러오지 못했어요.'));
  }, [playId]);

  useEffect(() => {
    if (!view) return;
    const t = setTimeout(() => setCard(false), TITLE_MS);
    return () => clearTimeout(t);
  }, [view !== null]);

  if (!view) return err ? <p className="center">{err}</p> : <main className="app playing" />;
  const aside = view.asides.find((a) => a.id === asideId);
  if (!aside) return <p className="center">장면을 찾을 수 없어요.</p>;

  const film = view.film;
  const clock = { startDow: film.startDow, startMin: film.startMin, elapsed: view.elapsed };
  const castOf = (key: string) => film.casts.find((c) => c.key === key);
  const lines = view.messages.filter((m) => m.room === aside.id);
  const when = formatWorld(clock, aside.at);
  const back = () => goBack(go, `/play/${playId}`);

  return (
    <main className="app playing away">
      <div className="band">
        <button className="ico" onClick={back} aria-label="돌아가기">
          <Back />
        </button>
      </div>
      <p className="where">
        {when}
        {aside.place && (
          <>
            <i>—</i>
            {aside.place}
          </>
        )}
      </p>
      <div className="with duo">
        {aside.casts.map((key) => (
          <span key={key}>
            <Face id={castOf(key)?.face ?? ''} name={castOf(key)?.name ?? ''} />
            {castOf(key)?.name}
          </span>
        ))}
      </div>

      <section className="flow">
        {lines.map((m) =>
          m.speaker === 'tell' ? (
            m.text.split('\n').map((line, j) => (
              <p className="tell" key={`${m.id}-${j}`}>
                {line}
              </p>
            ))
          ) : (
            <div className="say" key={m.id}>
              <Face id={castOf(m.speaker)?.face ?? ''} name={castOf(m.speaker)?.name ?? ''} />
              <span>
                <small>{castOf(m.speaker)?.name}</small>
                <p>{m.text}</p>
              </span>
            </div>
          ),
        )}
      </section>

      <footer className="foot off">
        <p>{josa(film.persona.name, '이', '가')} 없는 자리예요.</p>
        <button className="btn more" onClick={back}>
          돌아가기
        </button>
      </footer>

      {card && (
        <div className="titlecard" aria-hidden="true">
          <div className="between">
            <h1 className="title long">한편,</h1>
            <p>
              {when}
              {aside.place && ` — ${aside.place}`}
            </p>
          </div>
        </div>
      )}
      <Tabs path="" go={go} />
    </main>
  );
}
