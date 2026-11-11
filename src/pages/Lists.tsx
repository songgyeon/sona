/* 줄로 보는 화면 셋: 찾기, 이어 살기, 내 필름. */

import { type ReactNode, useEffect, useState } from 'react';
import { formatWorld } from '../../shared/clock';
import type { FilmCard, PlayCard } from '../../shared/types';
import { ApiFail, api } from '../api';
import { Search } from '../icons';
import { Art } from '../poster';
import { Tabs } from '../tabs';

function Row({ poster, title, onClick, children }: { poster: string; title: string; onClick: () => void; children?: ReactNode }) {
  return (
    <li>
      <button className="filmrow" onClick={onClick}>
        <span className="thumb">
          <Art id={poster} title={title} />
        </span>
        <span className="text">
          <strong>{title}</strong>
          {children}
        </span>
      </button>
    </li>
  );
}

function useFilms(): [FilmCard[] | null, string] {
  const [films, setFilms] = useState<FilmCard[] | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    api
      .films()
      .then(setFilms)
      .catch((e) => setErr(e instanceof ApiFail ? e.message : '목록을 불러오지 못했어요.'));
  }, []);
  return [films, err];
}

/** 찾기. 제목, 한 줄, 캐스트 이름으로 찾는다 */
export function Find({ go }: { go: (to: string) => void }) {
  const [films, err] = useFilms();
  const [word, setWord] = useState('');
  const w = word.trim();
  const found = (films ?? []).filter((f) => !w || [f.title, f.logline, ...f.castNames].some((s) => s.includes(w)));

  return (
    <main className="app tabbed page">
      <h1>찾기</h1>
      <label className="find">
        <Search />
        <span className="sr">찾을 말</span>
        <input value={word} onChange={(e) => setWord(e.target.value)} placeholder="제목이나 캐스트 이름" autoComplete="off" />
      </label>
      {err && <p className="warn sect">{err}</p>}
      {films !== null && found.length === 0 && (
        <div className="empty">
          <p>{w ? `「${w}」에 맞는 필름이 없어요.` : '아직 필름이 없어요.'}</p>
        </div>
      )}
      <ul className="rows">
        {found.map((f) => (
          <Row key={f.id} poster={f.poster} title={f.title} onClick={() => go(`/film/${f.id}`)}>
            {f.logline && <span>{f.logline}</span>}
            <em>{f.castNames.join(' · ')}</em>
          </Row>
        ))}
      </ul>
      <Tabs path="/find" go={go} />
    </main>
  );
}

/** 이어 살기. 살고 있던 필름으로 돌아간다. 퍼센트가 아니라 지금 그 세계의 시각을 적는다 */
export function Living({ go }: { go: (to: string) => void }) {
  const [plays, setPlays] = useState<PlayCard[] | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    api
      .plays()
      .then(setPlays)
      .catch((e) => setErr(e instanceof ApiFail ? e.message : '목록을 불러오지 못했어요.'));
  }, []);

  const living = (plays ?? []).filter((p) => !p.ended);
  const ended = (plays ?? []).filter((p) => p.ended);

  return (
    <main className="app tabbed page">
      <h1>이어 살기</h1>
      {err && <p className="warn sect">{err}</p>}
      {plays !== null && living.length === 0 && (
        <div className="empty">
          <p>살고 있는 필름이 없어요.</p>
          <button className="btn more" onClick={() => go('/')}>
            필름 고르기
          </button>
        </div>
      )}
      <ul className="rows">
        {living.map((p) => (
          <Row key={p.id} poster={p.poster} title={p.title} onClick={() => go(`/play/${p.id}`)}>
            <em>{formatWorld(p)}</em>
            {p.lastLine && <span>{p.lastLine}</span>}
          </Row>
        ))}
      </ul>
      {ended.length > 0 && (
        <>
          <p className="kicker sect" style={{ marginTop: 34 }}>
            끝난 하루
          </p>
          <ul className="rows">
            {ended.map((p) => (
              <Row key={p.id} poster={p.poster} title={p.title} onClick={() => go(`/play/${p.id}`)}>
                <em>{formatWorld(p)}</em>
              </Row>
            ))}
          </ul>
        </>
      )}
      <Tabs path="/living" go={go} />
    </main>
  );
}

/** 내 필름. 내가 디렉터인 필름들 */
export function Mine({ go }: { go: (to: string) => void }) {
  const [films, err] = useFilms();
  const mine = (films ?? []).filter((f) => f.mine);

  return (
    <main className="app tabbed page">
      <h1>내 필름</h1>
      {err && <p className="warn sect">{err}</p>}
      {films !== null && mine.length === 0 && (
        <div className="empty">
          <p>아직 만든 필름이 없어요.</p>
          <button className="btn play" onClick={() => go('/create')}>
            필름 만들기
          </button>
        </div>
      )}
      <ul className="rows">
        {mine.map((f) => (
          <Row key={f.id} poster={f.poster} title={f.title} onClick={() => go(`/film/${f.id}`)}>
            {f.logline && <span>{f.logline}</span>}
            <em>{f.castNames.join(' · ')}</em>
          </Row>
        ))}
      </ul>
      <Tabs path="/mine" go={go} />
    </main>
  );
}
