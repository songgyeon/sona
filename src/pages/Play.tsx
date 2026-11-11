import { type FormEvent, Fragment, type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { dayEnd, dayName, formatWorld, worldAt } from '../../shared/clock';
import { josa } from '../../shared/ko';
import { cutsOf, hasLines } from '../../shared/opening';
import { RULES } from '../../shared/rules';
import type { AsideView, Film, MessageView, PlayView } from '../../shared/types';
import { ApiFail, api, imgUrl, newId } from '../api';
import { Arrow, Back, Down, PlayFill, SkipFill } from '../icons';
import { Face, titleClass } from '../poster';

type SkipKind = 'evening' | 'sleep';

interface Outgoing {
  room: string;
  text: string;
  requestId: string;
}

/** 시간을 넘기는 단추. 넘긴 사이에도 캐스트는 자기 하루를 보낸다.
    낮에는 저녁과 다음 날 아침으로, 저녁이 지나면 아침으로만 갈 수 있다 */
function skipsAt(min: number): { kind: SkipKind; label: string }[] {
  if (min < RULES.skip.wakeMin) return [{ kind: 'sleep', label: '아침으로' }];
  if (min < RULES.skip.eveningMin) {
    return [
      { kind: 'evening', label: '저녁으로' },
      { kind: 'sleep', label: '다음 날 아침으로' },
    ];
  }
  return [{ kind: 'sleep', label: '다음 날 아침으로' }];
}

/** 앞 대사와 이만큼 벌어지면 그 사이에 시각을 적는다(작중 분) */
const CUT_AFTER = 30;

/** 들어가는 순간 제목이 떠 있는 동안(밀리초) */
export const TITLE_MS = 1900;
/** 하루가 끝난 뒤 크레딧이 오르기까지. 마지막 대사를 읽을 틈이다 */
const CREDITS_AFTER_MS = 2600;

/** 오프닝. 디렉터가 쌓은 순서대로 흐른다. 재생 중에는 컷 번호 같은 만드는 말을 보이지 않는다.
    컷은 글 사이에 끼우지 않는다 — 그 컷 바로 다음에 오는 줄에 표시(data-cut)만 달아 두고,
    읽는 자리가 그 줄에 닿으면 위 화면의 그림이 바뀐다 */
function Opening({ film }: { film: Film }) {
  const out: ReactNode[] = [];
  let pending = '';
  film.firstScene.beats.forEach((b, i) => {
    if (b.kind === 'cut') {
      pending = b.image;
      return;
    }
    const mark = pending ? { 'data-cut': pending } : {};
    pending = '';
    if (b.kind === 'tell') {
      b.text
        .split('\n')
        .filter((line) => line.trim().length > 0)
        .forEach((line, j) =>
          out.push(
            <p className="tell" key={`${i}-${j}`} {...(j === 0 ? mark : {})}>
              {line}
            </p>,
          ),
        );
      return;
    }
    const who = film.casts.find((c) => c.key === b.cast);
    out.push(
      <div className="say" key={i} {...mark}>
        <Face id={who?.face ?? ''} name={who?.name ?? ''} />
        <span>
          <small>{who?.name}</small>
          <p>{b.text}</p>
        </span>
      </div>,
    );
  });
  // 맨 끝에 건 컷: 오프닝을 다 읽으면 걸린다
  if (pending) out.push(<i className="mark" key="end" data-cut={pending} />);
  return <div className="opening">{out}</div>;
}

/** 재생. 위에 지금 장면이 걸리고, 아래로 장면이 흐른다 */
export function Play({ playId, go }: { playId: string; go: (to: string) => void }) {
  const [view, setView] = useState<PlayView | null>(null);
  const [room, setRoom] = useState('');
  const [draft, setDraft] = useState('');
  /** 보냈는데 아직 답이 안 온 말. 끊기면 같은 전송 표로 다시 보낸다 — 서버는 한 번만 처리한다 */
  const [out, setOut] = useState<Outgoing | null>(null);
  /** 시간을 넘기는 중. 끊기면 같은 표로 다시 부른다 */
  const [away, setAway] = useState<{ kind: SkipKind; requestId: string } | null>(null);
  const [waiting, setWaiting] = useState(false);
  const [err, setErr] = useState('');
  const [notice, setNotice] = useState('');
  /** 「필름에 들어가기」로 막 들어왔으면 제목이 먼저 뜬다 */
  const [card, setCard] = useState(() => new URLSearchParams(window.location.search).has('open'));
  /** 오프닝을 읽는 중. 끝에 닿으면 말하는 칸이 선다 */
  const [reading, setReading] = useState(false);
  /** 지금 화면에 걸린 컷과, 그 밑에 깔린 바로 앞 컷 */
  const [shot, setShot] = useState('');
  const [under, setUnder] = useState('');
  const flow = useRef<HTMLElement>(null);
  /** 하루의 끝에 오르는 크레딧 */
  const [credits, setCredits] = useState(false);
  const [closing, setClosing] = useState(false);
  const wasEnded = useRef<boolean | null>(null);
  const tick = useRef(0);
  const still = useRef(0);

  useEffect(() => {
    api
      .play(playId)
      .then((v) => {
        setView(v);
        // 프로필에서 「메시지」로 왔으면 그 사람과의 자리로 연다
        const asked = new URLSearchParams(window.location.search).get('with');
        const first = v.film.firstScene.room;
        const to = asked && v.film.casts.some((c) => c.key === asked) ? asked : first;
        setRoom(to);
        // 아직 한마디도 안 했으면 오프닝을 처음부터 읽는다
        setReading(to === first && hasLines(v.film) && v.elapsed === 0 && !v.messages.some((m) => m.speaker === 'persona'));
      })
      .catch((e) => setErr(e instanceof ApiFail ? e.message : '필름을 불러오지 못했어요.'));
  }, [playId]);

  // 제목은 잠깐 떴다가 걷힌다. 주소에 남은 표시는 지운다 — 새로 고쳐도 다시 뜨지 않게
  useEffect(() => {
    if (!card) return;
    window.history.replaceState(null, '', window.location.pathname);
    if (!view) return;
    const t = setTimeout(() => setCard(false), TITLE_MS);
    return () => clearTimeout(t);
  }, [card, view !== null]);

  // 하루가 끝나는 것을 지켜본 자리에서는 크레딧이 저절로 오른다. 끝난 삶을 다시 열었을 때는 오르지 않는다
  const ended = view?.ended ?? null;
  useEffect(() => {
    if (ended === null) return;
    const before = wasEnded.current;
    wasEnded.current = ended;
    if (before !== false || !ended) return;
    const t = setTimeout(() => setCredits(true), CREDITS_AFTER_MS);
    return () => clearTimeout(t);
  }, [ended]);

  /** 같은 삶을 다음 날로 잇는다 */
  const nextDay = async () => {
    setClosing(true);
    setErr('');
    try {
      setView(await api.next(playId));
      setCredits(false);
    } catch (e) {
      setErr(e instanceof ApiFail ? e.message : '다음 날로 잇지 못했어요.');
    }
    setClosing(false);
  };

  /** 같은 필름에 처음부터 다시 들어간다 */
  const again = async () => {
    if (!view) return;
    setClosing(true);
    setErr('');
    try {
      const fresh = await api.enter(view.filmId, newId());
      go(`/play/${fresh.id}?open=1`);
    } catch (e) {
      setErr(e instanceof ApiFail ? e.message : '필름에 들어가지 못했어요.');
      setClosing(false);
    }
  };

  /** 마지막 줄까지 남은 길이. 흐름 맨 아래의 여백(말하는 칸에 가리는 자리)은 치지 않는다 */
  const restOf = (el: HTMLElement) => {
    const pad = parseFloat(getComputedStyle(el).paddingBottom) || 0;
    return Math.max(0, el.scrollHeight - el.clientHeight - el.scrollTop - pad);
  };

  /** 마지막 줄까지 내려왔나 */
  const atEnd = () => {
    const el = flow.current;
    return !el || restOf(el) <= 12;
  };

  /** 읽는 자리에 맞는 컷을 고른다. 표시가 달린 줄 가운데, 읽는 자리를 지난 마지막 줄의 컷이다.
      읽는 자리는 보통 흐름의 위에서 2/5다. 끝이 가까워지면 아래로 내려가서, 맨 끝에서는 흐름의 바닥이 된다 —
      그래야 마지막 화면에 든 줄들의 컷도 차례로 걸리고, 다 읽으면 마지막 컷이 남는다 */
  const look = () => {
    const el = flow.current;
    if (!el) return;
    const marks = [...el.querySelectorAll<HTMLElement>('[data-cut]')];
    if (marks.length === 0) {
      setShot('');
      return;
    }
    const rest = restOf(el);
    const reach = el.clientHeight * 0.6;
    const at = rest >= reach ? 0.4 : 1 - 0.6 * (rest / reach);
    const line = el.scrollTop + el.clientHeight * at;
    let cur = marks[0]!;
    for (const m of marks) if (m.offsetTop <= line) cur = m;
    setShot(cur.dataset.cut ?? '');
  };

  const onScroll = () => {
    cancelAnimationFrame(tick.current);
    tick.current = requestAnimationFrame(look);
    // 끝에 닿아 멈추면 오프닝 읽기가 끝난다. 미끄러져 내려가는 중에는 기다린다
    window.clearTimeout(still.current);
    still.current = window.setTimeout(() => {
      if (atEnd()) setReading(false);
    }, 160);
  };

  // 오프닝을 읽는 동안에는 끌어내리지 않는다. 그 밖에는 늘 맨 아래를 본다
  useLayoutEffect(() => {
    if (!view) return;
    // 한 화면에 다 들어오는 오프닝은 읽을 것이 남지 않았다
    if (reading && atEnd()) setReading(false);
    // 맨 아래 여백까지 내린다 — 마지막 줄이 말하는 칸 위로 올라와 가리지 않게
    const el = flow.current;
    if (!reading && el) el.scrollTop = el.scrollHeight;
    look();
  }, [view, out, room, waiting, reading]);

  useEffect(() => {
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('resize', onScroll);
      cancelAnimationFrame(tick.current);
      window.clearTimeout(still.current);
    };
  }, []);

  const deliver = async (o: Outgoing) => {
    setOut(o);
    setWaiting(true);
    setErr('');
    setNotice('');
    try {
      setView(await api.say(playId, o.room, o.text, o.requestId));
      setOut(null);
    } catch (e) {
      if (e instanceof ApiFail && e.status !== 0 && e.status < 500) {
        // 서버가 받지 않았다(끝났거나, 앞 턴이 멈춰 있거나). 쓴 말은 돌려준다
        setOut(null);
        setDraft(o.text);
        setView(await api.play(playId).catch(() => view));
      }
      setErr(e instanceof ApiFail ? e.message : '보내지 못했어요.');
    }
    setWaiting(false);
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text || waiting || !view || view.ended || view.stuck || out || away) return;
    setDraft('');
    void deliver({ room, text, requestId: newId() });
  };

  const retry = async () => {
    setWaiting(true);
    setErr('');
    try {
      setView(await api.retry(playId));
    } catch (e) {
      setErr(e instanceof ApiFail ? e.message : '다시 받지 못했어요.');
    }
    setWaiting(false);
  };

  const leave = async (a: { kind: SkipKind; requestId: string }) => {
    if (!view) return;
    setAway(a);
    setWaiting(true);
    setErr('');
    setNotice('');
    const seenMessages = new Set(view.messages.map((m) => m.id));
    const seenPosts = view.posts.length;
    try {
      const next = await api.skip(playId, a.kind, a.requestId);
      setView(next);
      setAway(null);
      // 돌아와서 보니 와 있는 것들
      // 한편의 줄은 누가 나에게 보낸 것이 아니다
      const from = [...new Set(next.messages.filter((m) => !seenMessages.has(m.id) && m.kind !== 'aside').map((m) => m.room))];
      const names = from.map((key) => next.film.casts.find((c) => c.key === key)?.name ?? key);
      const posts = next.posts.length - seenPosts;
      const bits = [names.length > 0 ? `${names.join(', ')}의 메시지` : '', posts > 0 ? `새 피드 ${posts}개` : ''].filter(Boolean);
      setNotice(bits.length > 0 ? bits.join(' · ') : '그 사이 온 연락이 없어요.');
      if (from.length > 0 && !from.includes(room)) setRoom(from[0]!);
    } catch (e) {
      if (e instanceof ApiFail && e.status !== 0 && e.status < 500) {
        setAway(null);
        setView(await api.play(playId).catch(() => view));
      }
      setErr(e instanceof ApiFail ? e.message : '시간을 넘기지 못했어요.');
    }
    setWaiting(false);
  };

  // 제목이 뜰 자리. 불러오는 동안에는 검은 화면만 둔다
  if (!view) return err || !card ? <p className="center">{err || '필름에 들어가는 중'}</p> : <main className="app playing" />;

  const film = view.film;
  const clock = { startDow: film.startDow, startMin: film.startMin, elapsed: view.elapsed };
  const cast = film.casts.find((c) => c.key === room) ?? film.casts[0]!;
  const messages = view.messages.filter((m) => m.room === cast.key);
  const pendingHere = out && out.room === cast.key ? out : null;
  const stuckHere = view.stuck && view.stuck.room === cast.key;
  const locked = waiting || view.ended || !!view.stuck || !!out || !!away;
  /** 흐름에 놓이는 것들: 이 사람과 오간 말, 그리고 그 사이사이에 있었던 한편. 작중 시각 순 */
  const items: ({ at: number; m: MessageView; a?: undefined } | { at: number; a: AsideView; m?: undefined })[] = [
    ...messages.map((m) => ({ at: m.at, m })),
    ...view.asides.map((a) => ({ at: a.at, a })),
  ].sort((x, y) => x.at - y.at);
  const cuts = (i: number) => i > 0 && items[i]!.at - items[i - 1]!.at >= CUT_AFTER;
  const castOf = (key: string) => film.casts.find((c) => c.key === key);
  const fs = film.firstScene;
  /** 화면에 거는 그림. 읽는 자리의 컷이 먼저고, 없으면 첫 컷, 그것도 없으면 포스터 */
  const onScreen = shot || cutsOf(film)[0] || (film.stills ?? [])[0] || film.poster || '';
  /** 첫 장면 안에 있는 동안만 장소를 적는다. 그 뒤로는 어디인지 서버가 모른다 */
  const place = view.elapsed < CUT_AFTER ? fs.place : '';
  const profile = () => go(`/play/${playId}/cast/${cast.key}`);
  /** 내 배역 */
  const me = film.persona;
  /** 「첫 하루」, 「둘째 날」 … */
  const today = dayName(view.day);

  return (
    <main className="app playing">
      <div className="band">
        <button className="ico" onClick={() => go('/')} aria-label="필름에서 나가기">
          <Back />
        </button>
        {/* 내 배역. 사진과 정보를 고치러 간다 */}
        <button className="mine" onClick={() => go(`/play/${playId}/me`)} aria-label="내 배역">
          <Face id={me.face ?? ''} name={me.name} />
        </button>
      </div>

      {onScreen && (
        <div className="screen grain">
          {under && under !== onScreen && <img key={`under-${under}`} src={imgUrl(under)} alt="" />}
          <img key={onScreen} className="cutin" src={imgUrl(onScreen)} alt="" onAnimationEnd={() => setUnder(onScreen)} />
        </div>
      )}
      <p className="where">
        {formatWorld(clock)}
        {place && (
          <>
            <i>—</i>
            {place}
          </>
        )}
      </p>
      <div className="day" role="img" aria-label={`${josa(today, '이', '가')} 흐른 만큼`}>
        <span style={{ width: `${Math.min(100, ((view.elapsed - dayEnd(view.day - 1)) / RULES.trialMinutes) * 100)}%` }} />
      </div>

      {film.casts.length > 1 && (
        <nav className="with" aria-label="함께 있는 캐스트">
          {film.casts.map((c) => (
            <button key={c.key} className={c.key === cast.key ? 'on' : ''} onClick={() => setRoom(c.key)}>
              <Face id={c.face ?? ''} name={c.name} />
              {c.name}
            </button>
          ))}
        </nav>
      )}

      <section className="flow" aria-live="polite" ref={flow} onScroll={onScroll}>
        {cast.key === fs.room && fs.beats.length > 0 && <Opening film={film} />}

        {items.map(({ m, a }, i) =>
          a ? (
            // 한편: 내가 없는 자리에서 두 사람이 나눈 장면. 누르면 읽기만 하는 화면이 열린다
            <button className="aside" key={a.id} onClick={() => go(`/play/${playId}/aside/${a.id}`)}>
              <span className="duo">
                {a.casts.map((key) => (
                  <Face key={key} id={castOf(key)?.face ?? ''} name={castOf(key)?.name ?? ''} />
                ))}
              </span>
              <span>
                <b>
                  한편, {formatWorld(clock, a.at)}
                  {a.place && ` — ${a.place}`}
                </b>
                <small>
                  {josa(castOf(a.casts[0])?.name ?? '', '과', '와')} {castOf(a.casts[1])?.name}
                </small>
              </span>
              <span className="see">
                보기
                <PlayFill />
              </span>
            </button>
          ) : (
          <Fragment key={m.id}>
            {cuts(i) && <p className="cut">{formatWorld(clock, m.at)}</p>}
            {m.speaker === 'tell' ? (
              // 지문. 말한 사람이 없다
              m.text.split('\n').map((line, j) => (
                <p className="tell" key={j}>
                  {line}
                </p>
              ))
            ) : m.speaker === 'persona' ? (
              <div className={me.face ? 'say me faced' : 'say me'}>
                <div>
                  <small>{me.name}</small>
                  <p>{m.text}</p>
                </div>
                {me.face && <Face id={me.face} name={me.name} />}
              </div>
            ) : m.kind === 'ping' ? (
              // 작품 속 폰으로 먼저 온 연락. 말풍선은 여기만 쓴다
              <button className="msg" onClick={profile} aria-label={`${cast.name}의 프로필 보기`}>
                <Face id={cast.face ?? ''} name={cast.name} />
                <span>
                  <small>{cast.name} · 메시지</small>
                  <p>{m.text}</p>
                </span>
              </button>
            ) : (
              <button className="say" onClick={profile} aria-label={`${cast.name}의 프로필 보기`}>
                <Face id={cast.face ?? ''} name={cast.name} />
                <span>
                  <small>{cast.name}</small>
                  <p>{m.text}</p>
                </span>
              </button>
            )}
          </Fragment>
          ),
        )}

        {pendingHere && (
          <div className={me.face ? 'say me faced sending' : 'say me sending'}>
            <div>
              <small>{me.name}</small>
              <p>{pendingHere.text}</p>
            </div>
            {me.face && <Face id={me.face} name={me.name} />}
          </div>
        )}
        {waiting && !away && (
          <div className="say">
            <Face id={cast.face ?? ''} name={cast.name} />
            <span>
              <small>{cast.name}</small>
              <p>…</p>
            </span>
          </div>
        )}
        {away && waiting && <p className="cut">시간이 흐르는 중</p>}

        {stuckHere && !waiting && (
          <div className="stuck">
            <p>대사를 받지 못했어요.</p>
            <button className="btn more" onClick={retry}>
              다시 받기
            </button>
          </div>
        )}
        {view.stuck && !stuckHere && !waiting && (
          <div className="stuck">
            <p>끝나지 않은 장면이 있어요.</p>
            <button className="btn more" onClick={retry}>
              이어서 하기
            </button>
          </div>
        )}
        {out && !waiting && (
          <div className="stuck">
            <p>보내는 중에 연결이 끊겼어요.</p>
            <button className="btn more" onClick={() => deliver(out)}>
              다시 보내기
            </button>
          </div>
        )}
        {away && !waiting && (
          <div className="stuck">
            <p>시간을 넘기는 중에 연결이 끊겼어요.</p>
            <button className="btn more" onClick={() => leave(away)}>
              다시 시도
            </button>
          </div>
        )}

        {notice && <p className="note">{notice}</p>}
        {view.ended && <p className="cut">{josa(today, '이', '가')} 끝났어요</p>}
      </section>

      {reading ? (
        // 오프닝을 읽는 동안: 아래로 더 있다는 것만 알린다
        <footer className="foot more">
          <button className="ico" onClick={() => flow.current?.scrollBy({ top: flow.current.clientHeight * 0.8, behavior: 'smooth' })} aria-label="이어서 읽기">
            <Down />
          </button>
        </footer>
      ) : view.ended ? (
        // 하루가 끝났다. 말하는 칸 자리에 다음 날로 가는 단추가 선다
        <footer className="foot done">
          {err && <p className="warn">{err}</p>}
          <button className="btn play wide" disabled={closing} onClick={nextDay}>
            <SkipFill />
            다음 날 이어 살기
          </button>
          <button className="textbtn" onClick={() => setCredits(true)}>
            크레딧 보기
          </button>
          <div className="safe" />
        </footer>
      ) : (
      <footer className="foot">
        {err && <p className="warn">{err}</p>}
        {!view.ended && (
          <div className="skips">
            {skipsAt(worldAt(clock).min).map((s) => (
              <button key={s.kind} className="skip" disabled={locked} onClick={() => leave({ kind: s.kind, requestId: newId() })}>
                {s.label}
                <SkipFill />
              </button>
            ))}
          </div>
        )}
        <form className="box" onSubmit={submit}>
          <label htmlFor="say" className="sr">
            {cast.name}에게 할 말
          </label>
          <input
            id="say"
            value={draft}
            maxLength={RULES.limits.say}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={view.ended ? '첫 하루가 끝났어요' : '말하기'}
            disabled={view.ended || !!view.stuck || !!away}
            autoComplete="off"
          />
          <button type="submit" className="send" disabled={locked || !draft.trim()} aria-label="보내기">
            <Arrow />
          </button>
        </form>
        <div className="safe" />
      </footer>
      )}

      {credits && (
        <div className="credits" role="dialog" aria-label="엔드 크레딧">
          {onScreen && (
            <div className="back grain">
              <img src={imgUrl(onScreen)} alt="" />
            </div>
          )}
          <div className="band">
            <button className="ico" onClick={() => setCredits(false)} aria-label="장면으로 돌아가기">
              <Back />
            </button>
          </div>
          <div className="roll">
            <p className="kicker">{today}</p>
            <h1 className={titleClass(film.title)}>{film.title}</h1>
            <p className="span">
              {formatWorld(clock, dayEnd(view.day - 1))} — {formatWorld(clock, dayEnd(view.day))}
            </p>
            <dl className="names">
              <div>
                <dt>주연</dt>
                <dd>{film.persona.name}</dd>
              </div>
              {film.casts.map((c, i) => (
                <div key={c.key}>
                  <dt>{i === 0 ? '캐스트' : ''}</dt>
                  <dd>{c.name}</dd>
                </div>
              ))}
              {view.mine && (
                <div>
                  <dt>디렉터</dt>
                  <dd>나</dd>
                </div>
              )}
            </dl>
          </div>
          <div className="acts">
            {err && <p className="warn">{err}</p>}
            {view.ended && (
              <button className="btn play wide" disabled={closing} onClick={nextDay}>
                <SkipFill />
                다음 날 이어 살기
              </button>
            )}
            <button className="btn more wide" disabled={closing} onClick={again}>
              처음부터 다시 살기
            </button>
            <button className="textbtn" onClick={() => go('/')}>
              홈으로
            </button>
          </div>
        </div>
      )}

      {card && (
        <div className="titlecard" aria-hidden="true">
          <h1 className={titleClass(film.title)}>{film.title}</h1>
        </div>
      )}
    </main>
  );
}
