/* 줄로 보는 화면 셋: 찾기, 이어 살기, 내 필름. */

import { type ReactNode, useEffect, useState } from 'react';
import { formatWorld } from '../../shared/clock';
import { draftTitle } from '../../shared/draft';
import type { FilmCard, PlayCard } from '../../shared/types';
import { ApiFail, api } from '../api';
import { drafts } from '../drafts';
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

/** 임시저장한 때. 「11월 11일 오후 4:30」 */
const savedWhen = (at: number): string => new Date(at).toLocaleString('ko-KR', { month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' });

/** 내 필름. 내가 디렉터인 필름들. 만들다 임시저장해 둔 필름이 맨 위에 선다 */
export function Mine({ go }: { go: (to: string) => void }) {
  const [films, err] = useFilms();
  const mine = (films ?? []).filter((f) => f.mine);
  const [saved, setSaved] = useState(() => drafts.list());
  /** 지울지 묻고 있는 임시저장 */
  const [asking, setAsking] = useState('');

  const drop = (id: string) => {
    drafts.drop(id);
    setSaved(drafts.list());
    setAsking('');
  };

  return (
    <main className="app tabbed page">
      <h1>내 필름</h1>
      {err && <p className="warn sect">{err}</p>}
      {films !== null && mine.length === 0 && saved.length === 0 && (
        <div className="empty">
          <p>아직 만든 필름이 없어요.</p>
          <button className="btn play" onClick={() => go('/create')}>
            필름 만들기
          </button>
        </div>
      )}
      {saved.length > 0 && (
        <>
          <p className="kicker sect shelfname">임시저장</p>
          <ul className="rows">
            {saved.map((s) => {
              const title = draftTitle(s.draft);
              return (
                <li key={s.id} className="draft">
                  <button className="filmrow" onClick={() => go(s.filmId ? `/film/${s.filmId}/edit` : `/create/${s.id}`)}>
                    <span className="thumb">
                      <Art id={s.draft.poster} title={title} />
                    </span>
                    <span className="text">
                      <strong>{title}</strong>
                      {s.draft.logline.trim() && <span>{s.draft.logline}</span>}
                      <em>
                        {s.filmId ? '고치는 중 · ' : ''}
                        {savedWhen(s.savedAt)}
                      </em>
                    </span>
                  </button>
                  {asking === s.id ? (
                    <p className="ask">
                      지울까요?
                      <button className="textbtn" onClick={() => drop(s.id)}>
                        지우기
                      </button>
                      <button className="textbtn" onClick={() => setAsking('')}>
                        취소
                      </button>
                    </p>
                  ) : (
                    <button className="textbtn del" onClick={() => setAsking(s.id)} aria-label={`${title} 지우기`}>
                      지우기
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
      {saved.length > 0 && mine.length > 0 && <p className="kicker sect shelfname">개봉한 필름</p>}
      <ul className="rows">
        {mine.map((f) => (
          <Row key={f.id} poster={f.poster} title={f.title} onClick={() => go(`/film/${f.id}`)}>
            {f.logline && <span>{f.logline}</span>}
            <em>
              {f.private ? '비공개 · ' : ''}
              {f.castNames.join(' · ')}
            </em>
          </Row>
        ))}
      </ul>
      <Tabs path="/mine" go={go} />
    </main>
  );
}
