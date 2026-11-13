import { useEffect, useState } from 'react';
import { formatMin } from '../../shared/clock';
import { DOW_NAMES } from '../../shared/rules';
import type { Film as FilmData, FilmCard, FilmMine, MyPersona, PlayCard } from '../../shared/types';
import { ApiFail, api, imgUrl, newId } from '../api';
import { Back, LinkIcon, Next, Pen, PlayFill } from '../icons';
import { useMe } from '../me';
import { Face, StillStrip, titleClass } from '../poster';
import { AsPop, AsSlot, type Pick } from '../aspop';
import { fillFilm, rolesOf } from '../../shared/roles';
import { Tabs } from '../tabs';
import { type Go, goBack } from '../router';
import { dropFilmFlow } from '../drafts';

/** 필름 정보. 그 필름의 한 장면, 제목, 캐스트, 컷, 오프닝을 보고 들어간다 */
export function Film({ filmId, go }: { filmId: string; go: Go }) {
  const [data, setData] = useState<{ card: FilmCard; film: FilmData; mine: FilmMine } | null>(null);
  const [living, setLiving] = useState<PlayCard | null>(null);
  /** 살고 있는 삶에 저장한 장면 수 */
  const [saved, setSaved] = useState(0);
  /** 들어가는 사람을 고르는 입장권을 띄우고 있나 */
  const [choosing, setChoosing] = useState(false);
  const me = useMe();
  /** 내 페르소나. 이 가운데 하나로 들어갈 수 있다 */
  const [personas, setPersonas] = useState<MyPersona[]>([]);

  useEffect(() => {
    api
      .personas()
      .then(setPersonas)
      .catch(() => setPersonas([]));
  }, [me.name]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [toast, setToast] = useState('');
  /** 지울지 묻고 있나 */
  const [dropping, setDropping] = useState(false);

  useEffect(() => {
    Promise.all([api.film(filmId), api.plays()])
      .then(([d, plays]) => {
        setData(d);
        const now = plays.find((p) => p.filmId === filmId && !p.ended) ?? null;
        setLiving(now);
        if (now)
          api
            .saves(now.id)
            .then((list) => setSaved(list.length))
            .catch(() => setSaved(0));
      })
      .catch((e) => setErr(e instanceof ApiFail ? e.message : '필름을 불러오지 못했어요.'));
  }, [filmId]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(''), 2200);
    return () => clearTimeout(t);
  }, [toast]);

  /** 이 필름의 주소를 복사한다. 받은 사람은 이 화면으로 바로 온다 */
  const copyLink = async () => {
    const link = `${window.location.origin}/film/${filmId}`;
    try {
      await navigator.clipboard.writeText(link);
      setToast('링크를 복사했어요');
    } catch {
      // 복사가 막힌 브라우저. 이 화면의 주소가 곧 그 링크다
      setToast('주소창의 주소를 복사해 주세요');
    }
  };

  /** 들어가는 사람을 고른다: 배역이나 내 페르소나. 이 필름에서 살던 삶에도 적힌다. 못 바꿨으면 까닭을 돌려준다 */
  const choose = async (p: Pick): Promise<string | null> => {
    try {
      setData(await api.chooseAs(filmId, p));
      return null;
    } catch (e) {
      return e instanceof ApiFail ? e.message : '바꾸지 못했어요.';
    }
  };

  /** 필름을 지운다. keep이면 임시저장으로 옮긴 뒤에. 지우면 내 필름으로 간다 — 이 화면은 이제 없다 */
  const dropFilm = async (keep: boolean) => {
    if (!data) return;
    setBusy(true);
    setErr('');
    try {
      const why = await dropFilmFlow(
        filmId,
        keep,
        async () => ({ film: data.film, isPrivate: data.card.private }),
        () => api.dropFilm(filmId),
      );
      if (why) {
        setErr(why);
        setBusy(false);
        return;
      }
      go('/mine', { replace: true });
    } catch (e) {
      setErr(e instanceof ApiFail ? e.message : '지우지 못했어요.');
      setBusy(false);
    }
  };

  const enter = async () => {
    setBusy(true);
    setErr('');
    try {
      const view = await api.enter(filmId, newId());
      go(`/play/${view.id}?open=1`);
    } catch (e) {
      setErr(e instanceof ApiFail ? e.message : '필름에 들어가지 못했어요.');
      setBusy(false);
    }
  };

  if (!data) return <p className="center">{err || '불러오는 중'}</p>;
  const { card, mine } = data;
  /** 글 속의 {{user}}는 들어가는 사람의 이름으로 읽는다 */
  const film = fillFilm(data.film, mine.name);
  const fs = film.firstScene;
  const stills = film.stills ?? [];
  /** 첫 장면의 첫 지문. 필름이 어떻게 시작하는지 미리 보인다 */
  const opening = fs.beats.flatMap((b) => (b.kind === 'tell' ? [b.text] : []))[0] ?? '';
  const still = stills[0] ?? film.poster ?? '';
  const when = [`${DOW_NAMES[film.startDow]} ${formatMin(film.startMin)}`, fs.place].filter(Boolean).join(' · ');
  /** 살고 있는 삶이 있으면 그 삶의 프로필로 간다 — 피드가 거기 쌓인다 */
  const castPath = (key: string) => (living ? `/play/${living.id}/cast/${key}` : `/film/${filmId}/cast/${key}`);

  return (
    <main className="app tabbed info">
      <div className="top">
        <button className="ico" onClick={() => goBack(go, '/')} aria-label="돌아가기">
          <Back />
        </button>
      </div>

      <div className={still ? 'still grain' : 'still none'}>{still && <img src={imgUrl(still)} alt="" />}</div>

      <section className="head">
        <h1 className={titleClass(film.title)}>{film.title}</h1>
        {film.logline && <p className="line1">{film.logline}</p>}
        {/* 해시태그. 누르면 아카이브에서 그 해시태그로 찾는다 */}
        {(film.tags ?? []).length > 0 && (
          <p className="tags">
            {film.tags.map((t) => (
              <button key={t} className="tag" onClick={() => go(`/find?tag=${encodeURIComponent(t)}`)}>
                #{t}
              </button>
            ))}
          </p>
        )}
        <div className="go">
          {/* 들어가는 사람: 지금 고른 사람 한 칸. 누르면 입장권 모양의 목록이 뜬다 */}
          <AsSlot
            mine={mine}
            roles={rolesOf(film)}
            busy={choosing}
            onOpen={() => setChoosing(true)}
            onEdit={
              mine.personaId
                ? () => go(`/personas?edit=${mine.personaId}&back=${encodeURIComponent(`/film/${filmId}`)}`)
                : living
                  ? () => go(`/play/${living.id}/me`)
                  : null
            }
          />
          {living ? (
            <>
              <button className="btn play wide" onClick={() => go(`/play/${living.id}`)}>
                <PlayFill />
                이어 살기
              </button>
              <button className="btn more wide" disabled={busy} onClick={enter}>
                {busy ? '들어가는 중' : '처음부터 다시 살기'}
              </button>
            </>
          ) : (
            <button className="btn play wide" disabled={busy} onClick={enter}>
              <PlayFill />
              {busy ? '들어가는 중' : '필름에 들어가기'}
            </button>
          )}
          {living && saved > 0 && (
            <button className="savedrow" onClick={() => go(`/play/${living.id}?saves=1`)}>
              <b>저장한 장면 {saved}개</b>
              <span>여기서 다시 살기 ›</span>
            </button>
          )}
          {card.mine && (
            <div className="own">
              {/* 비공개 필름은 링크로 와도 보이지 않는다 */}
              {!card.private && (
                <button className="textbtn" onClick={copyLink}>
                  <LinkIcon />
                  링크 복사
                </button>
              )}
              <button className="textbtn" onClick={() => go(`/film/${filmId}/edit`)}>
                <Pen />
                고치기
              </button>
              <button className="textbtn" onClick={() => setDropping(true)}>
                지우기
              </button>
            </div>
          )}
          {card.mine && dropping && (
            <div className="dropask" role="group" aria-label="필름 지우기">
              <p>이 필름을 지울까요?</p>
              <small>들어가 살던 삶은 이어서 살 수 있어요.</small>
              <button className="btn more wide" disabled={busy} onClick={() => void dropFilm(true)}>
                임시저장에 두고 지우기
              </button>
              <button className="btn more wide" disabled={busy} onClick={() => void dropFilm(false)}>
                완전히 지우기
              </button>
              <button className="textbtn" disabled={busy} onClick={() => setDropping(false)}>
                취소
              </button>
            </div>
          )}
          {err && <p className="warn">{err}</p>}
        </div>
      </section>

      <section className="block first">
        <p className="kicker">캐스트</p>
        <ul className="casts">
          {/* 나. 이 필름에 들어가면 이 사람이 된다 */}
          <li>
            {/* 살고 있는 삶이 있으면 내 배역으로 간다 — 프로필을 고치고 내 피드에 글을 올린다 */}
            <button className="castrow me" disabled={!living} onClick={() => living && go(`/play/${living.id}/me`)}>
              <Face id={mine.face} name={mine.name} />
              <span>
                <strong>
                  {mine.name}
                  <em className="metag">나</em>
                </strong>
                {mine.line && <small>{mine.line}</small>}
              </span>
              {living ? <Next /> : <span />}
            </button>
          </li>
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

      {(opening || film.setting) && (
        <section className="block sect">
          <div className="rowhead" style={{ padding: 0 }}>
            첫 장면<span>{when}</span>
          </div>
          <p className="prose">{opening || film.setting}</p>
        </section>
      )}

      <p className="bill">
        {card.mine && (
          <span>
            디렉터<b>나</b>
          </span>
        )}
        {card.private && (
          <span>
            공개 범위<b>비공개</b>
          </span>
        )}
        <span>
          캐스트<b>{film.casts.map((c) => c.name).join(' · ')}</b>
        </span>
      </p>

      {choosing && (
        <AsPop
          title={film.title}
          roles={rolesOf(film)}
          myName={me.name}
          mine={mine}
          personas={personas}
          onPick={choose}
          onManage={() => go('/personas')}
          onClose={() => setChoosing(false)}
        />
      )}
      {toast && (
        <p className="toast" role="status">
          {toast}
        </p>
      )}
      <Tabs path={`/film/${filmId}`} go={go} />
    </main>
  );
}
