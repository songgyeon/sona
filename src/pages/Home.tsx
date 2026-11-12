import { useEffect, useState } from 'react';
import { formatWorld } from '../../shared/clock';
import { DEV_FILM } from '../../shared/dev-film';
import type { FilmCard, PlayCard } from '../../shared/types';
import { ApiFail, api } from '../api';
import { PlayFill, Search } from '../icons';
import { Art, PosterStrip, titleClass } from '../poster';
import { useMe } from '../me';
import { Tabs } from '../tabs';

/** 홈. 맨 위는 영화 포스터 한 장이고, 내리면 필름이 한 줄로 흐른다 */
export function Home({ go, fake, modelReady }: { go: (to: string) => void; fake: boolean; modelReady: boolean }) {
  const me = useMe();
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
      setErr(e instanceof ApiFail ? e.message : '목록을 불러오지 못했어요.');
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
      setErr(e instanceof ApiFail ? e.message : '필름을 넣지 못했어요.');
    }
    setBusy(false);
  };

  if (films === null) return <p className="center">{err || '불러오는 중'}</p>;

  const mine = films.filter((f) => f.mine);
  const others = films.filter((f) => !f.mine);
  /** 살고 있던 삶이 있으면 그 필름이 맨 위에 걸린다. 없으면 가장 최근 필름 */
  const now = plays.find((p) => !p.ended) ?? null;
  const lead = now ? null : (mine[0] ?? others[0] ?? null);

  return (
    <main className="app tabbed">
      <header className="bar">
        <span className="logo">소나</span>
        <div className="right">
          {/* 내 이름. 누르면 입장권을 다시 띄워 고친다 */}
          {me.name && (
            <button className="namechip" onClick={me.rename} aria-label={`내 이름 ${me.name} 고치기`}>
              {me.name}
            </button>
          )}
          <button className="ico" onClick={() => go('/find')} aria-label="디깅">
            <Search />
          </button>
        </div>
      </header>

      <section className="hero">
        <div className="art grain">
          <Art id={now?.poster ?? lead?.poster ?? ''} title={now?.title ?? lead?.title ?? '소나'} />
        </div>

        {now && (
          <div className="poster">
            <p className="kicker">이어 살기</p>
            <h1 className={titleClass(now.title)}>{now.title}</h1>
            <p className="line1">{formatWorld(now)}</p>
            <div className="acts">
              <button className="btn play" onClick={() => go(`/play/${now.id}`)}>
                <PlayFill />
                이어 살기
              </button>
              <button className="btn more" onClick={() => go(`/film/${now.filmId}`)}>
                필름 정보
              </button>
            </div>
            <p className="bill">
              <span>
                캐스트<b>{now.castNames.join(' · ')}</b>
              </span>
            </p>
          </div>
        )}

        {lead && (
          <div className="poster">
            <h1 className={titleClass(lead.title)}>{lead.title}</h1>
            {lead.logline && <p className="line1">{lead.logline}</p>}
            <div className="acts">
              <button className="btn play" onClick={() => go(`/film/${lead.id}`)}>
                <PlayFill />
                필름 정보
              </button>
            </div>
            <p className="bill">
              <span>
                캐스트<b>{lead.castNames.join(' · ')}</b>
              </span>
            </p>
          </div>
        )}

        {!now && !lead && (
          <div className="poster">
            <p className="line1">아직 필름이 없어요. 첫 필름을 만들어 보세요.</p>
            <div className="acts">
              <button className="btn play" onClick={() => go('/create')}>
                첫 필름 만들기
              </button>
            </div>
          </div>
        )}
      </section>

      <div className="shelves">
        {mine.length > 0 && (
          <section>
            <div className="rowhead">
              내 필름<button onClick={() => go('/mine')}>모두 보기</button>
            </div>
            <PosterStrip items={mine} onPick={(id) => go(`/film/${id}`)} />
          </section>
        )}
        {others.length > 0 && (
          <section>
            <div className="rowhead">필름</div>
            <PosterStrip items={others} onPick={(id) => go(`/film/${id}`)} />
          </section>
        )}

        {(err || !modelReady || fake) && (
          <section className="sect">
            {err && <p className="warn">{err}</p>}
            {!modelReady && (
              <p className="note">대사 모델이 연결되지 않아 대화는 아직 할 수 없어요.</p>
            )}
            {fake && (
              <button className="textbtn" disabled={busy} onClick={addDevFilm}>
                시험용 모델 · 임시 필름 넣기
              </button>
            )}
          </section>
        )}
      </div>

      <Tabs path="/" go={go} />
    </main>
  );
}
