import { type ReactNode, useEffect, useRef, useState } from 'react';
import { formatWorld } from '../../shared/clock';
import { DEV_FILM } from '../../shared/dev-film';
import { fillCard } from '../../shared/roles';
import { RULES } from '../../shared/rules';
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

  // 글 속의 {{user}}는 내 이름으로 읽는다
  const cards = films.map((f) => fillCard(f, me.name));
  const mine = cards.filter((f) => f.mine);
  const others = cards.filter((f) => !f.mine);
  /** 대문은 필름마다 한 장씩 넘긴다. 살고 있던 삶이 있으면 그 필름이 「이어 살기」로 맨 앞에 서고,
      그다음 대문에 건 필름부터 최근에 개봉한 것 차례다. 이어 살기로 선 필름은 뒤에서 또 서지 않는다
      (2026-11-13 사용자: 대문에 한 편만 걸려 「다른 작품은 안 보이잖아」) */
  const now = plays.find((p) => !p.ended) ?? null;
  const reel = cards.filter((f) => f.id !== now?.filmId).slice(0, RULES.hero.max - (now ? 1 : 0));
  const count = (now ? 1 : 0) + reel.length;

  return (
    <main className="app tabbed">
      <header className="bar">
        <span className="logo">SONA</span>
        <div className="right">
          {/* 내 이름. 누르면 내 페르소나 — 이름을 고치고 페르소나를 만든다 */}
          {me.name && (
            <button className="namechip" onClick={() => go('/personas')} aria-label={`내 이름 ${me.name}, 내 페르소나 보기`}>
              {me.name}
            </button>
          )}
          <button className="ico" onClick={() => go('/find')} aria-label="아카이브">
            <Search />
          </button>
        </div>
      </header>

      <HeroReel count={count}>
        {now && (
          <section className="hero">
            <div className="art grain">
              <Art id={now.poster} title={now.title} />
            </div>
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
              <Dots count={count} at={0} />
              <p className="bill">
                <span>
                  캐스트<b>{now.castNames.join(' · ')}</b>
                </span>
              </p>
            </div>
          </section>
        )}

        {reel.map((f, k) => {
          const at = k + (now ? 1 : 0);
          // 제목은 첫 장만 화면의 큰 제목이다
          const Title = at === 0 ? 'h1' : 'h2';
          return (
            <section className="hero" key={f.id}>
              <div className="art grain">
                <Art id={f.poster} title={f.title} />
              </div>
              <div className="poster">
                <Title className={titleClass(f.title)}>{f.title}</Title>
                {f.logline && <p className="line1">{f.logline}</p>}
                <div className="acts">
                  <button className="btn play" onClick={() => go(`/film/${f.id}`)}>
                    <PlayFill />
                    필름 정보
                  </button>
                </div>
                <Dots count={count} at={at} />
                <p className="bill">
                  <span>
                    캐스트<b>{f.castNames.join(' · ')}</b>
                  </span>
                </p>
              </div>
            </section>
          );
        })}

        {count === 0 && (
          <section className="hero">
            <div className="art grain">
              <Art id="" title="SONA" />
            </div>
            <div className="poster">
              <p className="line1">아직 필름이 없어요. 첫 필름을 만들어 보세요.</p>
              <div className="acts">
                <button className="btn play" onClick={() => go('/create')}>
                  첫 필름 만들기
                </button>
              </div>
            </div>
          </section>
        )}
      </HeroReel>

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
            <div className="rowhead">
              필름<button onClick={() => go('/films')}>모두 보기</button>
            </div>
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

      {/* 만든 사람. 링크만 받고 들어온 사람도 누가 만들었는지 알게 — 이름만 둔다(2026-11-13 사용자 승인) */}
      <p className="maker">기획·제작 문리현</p>

      <Tabs path="/" go={go} />
    </main>
  );
}

/** 대문: 필름마다 한 장씩 가로로 넘긴다. 가만두면 RULES.hero.ms마다 다음 장으로 가고, 끝에서는 처음으로 돌아간다.
    손으로 한 번이라도 만지면 그때부터는 저절로 넘기지 않는다. 움직임을 줄인 기기에서도 저절로 넘기지 않는다 */
function HeroReel({ count, children }: { count: number; children: ReactNode }) {
  const track = useRef<HTMLDivElement>(null);
  const [auto, setAuto] = useState(true);
  /** 들어가는 화면이나 입장권(이름 적기 등)이 마지막으로 대문을 덮고 있던 때 */
  const covered = useRef(0);
  useEffect(() => {
    if (!auto || count < 2) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const t = window.setInterval(() => {
      const el = track.current;
      if (!el || document.hidden) return;
      // 덮여 있는 동안은 넘기지 않고, 걷힌 뒤에도 지금 장을 한 번은 온전히 보여 준다 —
      // 처음 온 사람이 들어가는 화면과 이름 적기를 마치면 대문이 벌써 둘째·셋째 장에 가 있었다(2026-11-14 처음 온 사람으로 돌려 보다가)
      if (document.querySelector('.entrance, .namepop')) {
        covered.current = Date.now();
        return;
      }
      if (Date.now() - covered.current < RULES.hero.ms) return;
      const w = el.clientWidth;
      const now = Math.round(el.scrollLeft / w);
      el.scrollTo({ left: ((now + 1) % count) * w, behavior: 'smooth' });
    }, RULES.hero.ms);
    return () => window.clearInterval(t);
  }, [auto, count]);
  const stop = () => setAuto(false);
  return (
    <div className="heroes" ref={track} onPointerDown={stop} onWheel={stop} onKeyDown={stop}>
      {children}
    </div>
  );
}

/** 대문의 몇째 장인지. 한 장뿐이면 서지 않는다 */
function Dots({ count, at }: { count: number; at: number }) {
  if (count < 2) return null;
  return (
    <p className="herodots" aria-label={`${count}편 가운데 ${at + 1}째`}>
      {Array.from({ length: count }, (_, j) => (
        <i key={j} className={j === at ? 'on' : undefined} />
      ))}
    </p>
  );
}
