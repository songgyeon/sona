/* 줄로 보는 화면 셋: 아카이브(찾기), 이어 살기, 내 필름. */

import { type ReactNode, useEffect, useState } from 'react';
import { formatWorld } from '../../shared/clock';
import { draftTitle } from '../../shared/draft';
import { fillCard, fillUser } from '../../shared/roles';
import type { FilmCard, PlayCard } from '../../shared/types';
import { ApiFail, api } from '../api';
import { drafts, dropFilmFlow } from '../drafts';
import { Next, Search } from '../icons';
import { useMe } from '../me';
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

/** 개봉한 필름들. 글 속의 {{user}}는 내 이름으로 읽는다 */
function useFilms(): [FilmCard[] | null, string] {
  const me = useMe();
  const [films, setFilms] = useState<FilmCard[] | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    api
      .films()
      .then(setFilms)
      .catch((e) => setErr(e instanceof ApiFail ? e.message : '목록을 불러오지 못했어요.'));
  }, []);
  return [films && films.map((f) => fillCard(f, me.name)), err];
}

/** 아카이브. 제목, 한 줄, 캐스트 이름으로 찾는다 */
export function Find({ go }: { go: (to: string) => void }) {
  const [films, err] = useFilms();
  const [word, setWord] = useState('');
  const w = word.trim();
  const found = (films ?? []).filter((f) => !w || [f.title, f.logline, ...f.castNames].some((s) => s.includes(w)));

  return (
    <main className="app tabbed page">
      <h1>아카이브</h1>
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

/** 이어 살기. 살고 있던 필름으로 돌아간다. 필름마다 묶는다 — 한 필름에 삶이 여럿일 수 있다(처음부터 다시 살기).
    삶마다 지금 그 세계의 시각과 마지막으로 오간 말을 적는다. 삶은 지울 수 있다. 되돌릴 수 없어서 한 번 묻는다 */
export function Living({ go }: { go: (to: string) => void }) {
  const [plays, setPlays] = useState<PlayCard[] | null>(null);
  const [err, setErr] = useState('');
  /** 지울지 묻고 있는 삶 */
  const [asking, setAsking] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api
      .plays()
      .then(setPlays)
      .catch((e) => setErr(e instanceof ApiFail ? e.message : '목록을 불러오지 못했어요.'));
  }, []);

  const drop = async (id: string) => {
    setBusy(true);
    setErr('');
    try {
      setPlays(await api.dropPlay(id));
      setAsking('');
    } catch (e) {
      setErr(e instanceof ApiFail ? e.message : '지우지 못했어요.');
    }
    setBusy(false);
  };

  /** 필름마다 묶는다. 최근에 들어간 삶이 있는 필름부터, 묶음 안에서는 최근 삶부터 */
  const groups: { filmId: string; title: string; poster: string; gone: boolean; plays: PlayCard[] }[] = [];
  for (const p of plays ?? []) {
    const g = groups.find((x) => x.filmId === p.filmId);
    if (g) g.plays.push(p);
    else groups.push({ filmId: p.filmId, title: p.title, poster: p.poster, gone: p.filmGone, plays: [p] });
  }

  return (
    <main className="app tabbed page">
      <h1>이어 살기</h1>
      {err && <p className="warn sect">{err}</p>}
      {plays !== null && plays.length === 0 && (
        <div className="empty">
          <p>살고 있는 필름이 없어요.</p>
          <button className="btn more" onClick={() => go('/')}>
            필름 고르기
          </button>
        </div>
      )}
      {groups.map((g) => (
        <section className="lgroup" key={g.filmId}>
          {/* 만든 사람이 지운 필름은 필름 정보가 없다. 삶은 이어서 산다 */}
          <button className="lhead" disabled={g.gone} onClick={() => go(`/film/${g.filmId}`)}>
            <span className="thumb">
              <Art id={g.poster} title={g.title} />
            </span>
            <span className="text">
              <strong>{g.title}</strong>
              <em>
                삶 {g.plays.length}개{g.gone ? ' · 지운 필름' : ''}
              </em>
            </span>
            {g.gone ? <span /> : <Next />}
          </button>
          <ul className="lives">
            {g.plays.map((p) => (
              <li key={p.id} className="life">
                <button className="liferow" onClick={() => go(`/play/${p.id}`)}>
                  <em>
                    {p.ended ? '끝난 하루 · ' : ''}
                    {formatWorld(p)}
                  </em>
                  {p.lastLine && <span>{p.lastLine}</span>}
                </button>
                {asking === p.id ? (
                  <p className="ask">
                    이 삶을 지울까요?
                    <button className="textbtn" disabled={busy} onClick={() => void drop(p.id)}>
                      지우기
                    </button>
                    <button className="textbtn" disabled={busy} onClick={() => setAsking('')}>
                      취소
                    </button>
                  </p>
                ) : (
                  <button className="textbtn del" onClick={() => setAsking(p.id)} aria-label={`${g.title}, ${formatWorld(p)}의 삶 지우기`}>
                    지우기
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
      <Tabs path="/living" go={go} />
    </main>
  );
}

/** 임시저장한 때. 「11월 11일 오후 4:30」 */
const savedWhen = (at: number): string => new Date(at).toLocaleString('ko-KR', { month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' });

/** 내 필름. 내가 디렉터인 필름들. 만들다 임시저장해 둔 필름이 맨 위에 선다 */
export function Mine({ go }: { go: (to: string) => void }) {
  const me = useMe();
  const [films, err] = useFilms();
  /** 이 화면에서 지운 필름 */
  const [gone, setGone] = useState<string[]>([]);
  const mine = (films ?? []).filter((f) => f.mine && !gone.includes(f.id));
  const [saved, setSaved] = useState(() => drafts.list());
  /** 지울지 묻고 있는 임시저장 */
  const [asking, setAsking] = useState('');
  /** 지울지 묻고 있는 개봉한 필름 */
  const [dropping, setDropping] = useState('');
  const [busy, setBusy] = useState(false);
  const [dropErr, setDropErr] = useState('');

  /** 개봉한 필름을 지운다. keep이면 먼저 임시저장으로 옮긴다 — 맨 위 임시저장에 선다 */
  const dropFilm = async (f: FilmCard, keep: boolean) => {
    setBusy(true);
    setDropErr('');
    try {
      const why = await dropFilmFlow(
        f.id,
        keep,
        async () => {
          const d = await api.film(f.id);
          return { film: d.film, isPrivate: d.card.private };
        },
        () => api.dropFilm(f.id),
      );
      if (why) setDropErr(why);
      else {
        setGone((g) => [...g, f.id]);
        setSaved(drafts.list());
        setDropping('');
      }
    } catch (e) {
      setDropErr(e instanceof ApiFail ? e.message : '지우지 못했어요.');
    }
    setBusy(false);
  };

  const drop = (id: string) => {
    drafts.drop(id);
    setSaved(drafts.list());
    setAsking('');
  };

  return (
    <main className="app tabbed page">
      <h1>내 필름</h1>
      {/* 내 이름과 내 페르소나 */}
      <button className="savedrow sect mypersonas" onClick={() => go('/personas')}>
        <b>내 페르소나</b>
        <span aria-hidden="true">›</span>
      </button>
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
              const title = fillUser(draftTitle(s.draft), me.name);
              return (
                <li key={s.id} className="draft">
                  <button className="filmrow" onClick={() => go(s.filmId ? `/film/${s.filmId}/edit` : `/create/${s.id}`)}>
                    <span className="thumb">
                      <Art id={s.draft.poster} title={title} />
                    </span>
                    <span className="text">
                      <strong>{title}</strong>
                      {s.draft.logline.trim() && <span>{fillUser(s.draft.logline, me.name)}</span>}
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
      {dropErr && <p className="warn sect">{dropErr}</p>}
      <ul className="rows">
        {mine.map((f) => (
          <li key={f.id} className="draft">
            <button className="filmrow" onClick={() => go(`/film/${f.id}`)}>
              <span className="thumb">
                <Art id={f.poster} title={f.title} />
              </span>
              <span className="text">
                <strong>{f.title}</strong>
                {f.logline && <span>{f.logline}</span>}
                <em>
                  {f.private ? '비공개 · ' : ''}
                  {f.castNames.join(' · ')}
                </em>
              </span>
            </button>
            {dropping === f.id ? (
              <p className="ask wide">
                지울까요?
                <button className="textbtn" disabled={busy} onClick={() => void dropFilm(f, true)}>
                  임시저장에 두고 지우기
                </button>
                <button className="textbtn" disabled={busy} onClick={() => void dropFilm(f, false)}>
                  완전히 지우기
                </button>
                <button className="textbtn" disabled={busy} onClick={() => setDropping('')}>
                  취소
                </button>
              </p>
            ) : (
              <button className="textbtn del" onClick={() => setDropping(f.id)} aria-label={`${f.title} 지우기`}>
                지우기
              </button>
            )}
          </li>
        ))}
      </ul>
      <Tabs path="/mine" go={go} />
    </main>
  );
}
