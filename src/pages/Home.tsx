import { useEffect, useState } from 'react';
import { formatWorld } from '../../shared/clock';
import { DEV_FILM } from '../../shared/dev-film';
import type { FilmCard, PlayCard } from '../../shared/types';
import { ApiFail, api } from '../api';
import { Poster } from '../poster';

/** 홈. OTT처럼 포스터로 필름을 고른다. 살고 있던 필름으로는 「이어 살기」로 돌아간다 */
export function Home({ go, fake, modelReady }: { go: (to: string) => void; fake: boolean; modelReady: boolean }) {
  const [films, setFilms] = useState<FilmCard[] | null>(null);
  const [plays, setPlays] = useState<PlayCard[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const load = async () => {
    try {
      const [f, p] = await Promise.all([api.films(), api.plays()]);
      setFilms(f);
      setPlays(p);
    } catch (e) {
      setErr(e instanceof ApiFail ? e.message : '목록을 못 불러왔어.');
    }
  };

  useEffect(() => {
    void load();
  }, []);

  // 로컬에서만 보이는 단추: 임시 필름을 하나 넣는다
  const addDevFilm = async () => {
    setBusy(true);
    setErr('');
    try {
      await api.createFilm(DEV_FILM);
      await load();
    } catch (e) {
      setErr(e instanceof ApiFail ? e.message : '필름을 못 넣었어.');
    }
    setBusy(false);
  };

  const living = plays.filter((p) => !p.ended);
  const mine = films?.filter((f) => f.mine) ?? [];
  const others = films?.filter((f) => !f.mine) ?? [];

  const shelf = (title: string, list: FilmCard[]) => (
    <section className="shelf">
      <h2>{title}</h2>
      <ul className="posters">
        {list.map((f) => (
          <li key={f.id}>
            <button className="pick" onClick={() => go(`/film/${f.id}`)} aria-label={`${f.title} 열기`}>
              <Poster title={f.title} casts={f.castNames} />
              {f.logline && <span className="caption">{f.logline}</span>}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );

  return (
    <main className="home">
      <header className="top">
        <span className="brand">소나</span>
        {fake && <span className="chip">가짜 모델</span>}
        <button className="push" onClick={() => go('/create')}>
          필름 만들기
        </button>
      </header>

      {err && <p className="warn">{err}</p>}
      {!modelReady && (
        <p className="warn">
          모델 열쇠가 아직 없어서 대화가 안 돼. Cloudflare에서 이 Worker의 변수와 시크릿에 OPENROUTER_API_KEY를 넣어 줘.
        </p>
      )}

      {living.length > 0 && (
        <section className="shelf">
          <h2>이어 살기</h2>
          <ul className="resumes">
            {living.map((p) => (
              <li key={p.id}>
                <button className="resume" onClick={() => go(`/play/${p.id}`)}>
                  <Poster title={p.title} small />
                  <span className="text">
                    <strong>{p.title}</strong>
                    <span className="when">{formatWorld(p)}</span>
                    {p.lastLine && <span className="last">{p.lastLine}</span>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {films === null && <p className="muted">불러오는 중…</p>}

      {films !== null && films.length === 0 && (
        <div className="empty">
          <p>아직 필름이 없어. 세계와 인물, 첫 장면을 쓰면 그 필름에 바로 들어갈 수 있어.</p>
          <button onClick={() => go('/create')}>첫 필름 만들기</button>
        </div>
      )}

      {mine.length > 0 && shelf('내 필름', mine)}
      {others.length > 0 && shelf('필름', others)}

      {fake && (
        <footer>
          <button className="ghost" disabled={busy} onClick={addDevFilm}>
            임시 필름 넣기
          </button>
        </footer>
      )}
    </main>
  );
}
