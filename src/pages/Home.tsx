import { useEffect, useState } from 'react';
import { formatWorld } from '../../shared/clock';
import { DEV_FILM } from '../../shared/dev-film';
import type { FilmCard, PlayCard } from '../../shared/types';
import { ApiFail, api, newId } from '../api';

export function Home({ go, fake, modelReady }: { go: (to: string) => void; fake: boolean; modelReady: boolean }) {
  const [films, setFilms] = useState<FilmCard[] | null>(null);
  const [plays, setPlays] = useState<PlayCard[]>([]);
  const [busy, setBusy] = useState('');
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

  const enter = async (filmId: string) => {
    setBusy(filmId);
    setErr('');
    try {
      const view = await api.enter(filmId, newId());
      go(`/play/${view.id}`);
    } catch (e) {
      setErr(e instanceof ApiFail ? e.message : '들어가지 못했어.');
      setBusy('');
    }
  };

  // 임시: 필름 만들기 화면이 붙기 전까지 개발용 필름을 넣는 단추
  const addDevFilm = async () => {
    setBusy('dev');
    setErr('');
    try {
      await api.createFilm(DEV_FILM);
      await load();
    } catch (e) {
      setErr(e instanceof ApiFail ? e.message : '필름을 못 넣었어.');
    }
    setBusy('');
  };

  const living = plays.filter((p) => !p.ended);

  return (
    <main className="home">
      <header className="top">
        <h1>소나</h1>
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
        <section>
          <h2>이어 살기</h2>
          <ul className="cards">
            {living.map((p) => (
              <li key={p.id}>
                <button className="card resume" onClick={() => go(`/play/${p.id}`)}>
                  <strong>{p.title}</strong>
                  <span className="when">{formatWorld(p)}</span>
                  {p.lastLine && <span className="last">{p.lastLine}</span>}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2>필름</h2>
        {films === null && <p className="muted">불러오는 중…</p>}
        {films?.length === 0 && <p className="muted">아직 필름이 없어. 「필름 만들기」로 첫 필름을 써 봐.</p>}
        <ul className="cards">
          {films?.map((f) => (
            <li key={f.id} className="card film">
              <div className="poster" aria-hidden="true">
                <span>{f.title}</span>
              </div>
              <div className="body">
                <strong>
                  {f.title}
                  {f.mine && <span className="chip">내 필름</span>}
                </strong>
                {f.logline && <p>{f.logline}</p>}
                {f.personaLine && (
                  <p className="muted">
                    이 필름에서 나는 <em>{f.personaLine}</em>
                  </p>
                )}
                <p className="muted">캐스트 · {f.castNames.join(', ')}</p>
                <button disabled={busy !== ''} onClick={() => enter(f.id)}>
                  {busy === f.id ? '들어가는 중…' : '필름에 들어가기'}
                </button>
              </div>
            </li>
          ))}
        </ul>
      </section>

      {fake && (
        <footer className="muted">
          <button className="ghost" disabled={busy !== ''} onClick={addDevFilm}>
            개발용 필름 넣기
          </button>
        </footer>
      )}
    </main>
  );
}
