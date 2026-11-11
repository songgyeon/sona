import { type FormEvent, Fragment, useEffect, useRef, useState } from 'react';
import { formatWorld, worldAt } from '../../shared/clock';
import { RULES } from '../../shared/rules';
import type { MessageView, PlayView } from '../../shared/types';
import { ApiFail, api, imgUrl, newId } from '../api';
import { Arrow, Back, SkipFill } from '../icons';
import { Face } from '../poster';

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
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api
      .play(playId)
      .then((v) => {
        setView(v);
        // 프로필에서 「메시지」로 왔으면 그 사람과의 자리로 연다
        const asked = new URLSearchParams(window.location.search).get('with');
        setRoom(asked && v.film.casts.some((c) => c.key === asked) ? asked : v.film.firstScene.room);
      })
      .catch((e) => setErr(e instanceof ApiFail ? e.message : '필름을 못 불러왔어.'));
  }, [playId]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' });
  }, [view, out, room, waiting]);

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
      setErr(e instanceof ApiFail ? e.message : '보내지 못했어.');
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
      setErr(e instanceof ApiFail ? e.message : '다시 받지 못했어.');
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
      const from = [...new Set(next.messages.filter((m) => !seenMessages.has(m.id)).map((m) => m.room))];
      const names = from.map((key) => next.film.casts.find((c) => c.key === key)?.name ?? key);
      const posts = next.posts.length - seenPosts;
      const bits = [
        names.length > 0 ? `${names.join(', ')}에게서 연락이 와 있어` : '',
        posts > 0 ? `피드에 새 글 ${posts}개` : '',
      ].filter(Boolean);
      setNotice(bits.length > 0 ? `${bits.join(' · ')}.` : '그 사이 온 연락은 없어.');
      if (from.length > 0 && !from.includes(room)) setRoom(from[0]!);
    } catch (e) {
      if (e instanceof ApiFail && e.status !== 0 && e.status < 500) {
        setAway(null);
        setView(await api.play(playId).catch(() => view));
      }
      setErr(e instanceof ApiFail ? e.message : '시간을 넘기지 못했어.');
    }
    setWaiting(false);
  };

  if (!view) return <p className="center">{err || '필름에 들어가는 중…'}</p>;

  const film = view.film;
  const clock = { startDow: film.startDow, startMin: film.startMin, elapsed: view.elapsed };
  const cast = film.casts.find((c) => c.key === room) ?? film.casts[0]!;
  const messages = view.messages.filter((m) => m.room === cast.key);
  const pendingHere = out && out.room === cast.key ? out : null;
  const stuckHere = view.stuck && view.stuck.room === cast.key;
  const locked = waiting || view.ended || !!view.stuck || !!out || !!away;
  const cuts = (m: MessageView, i: number) => i > 0 && m.at - messages[i - 1]!.at >= CUT_AFTER;
  const fs = film.firstScene;
  const still = (film.stills ?? [])[0] ?? film.poster ?? '';
  /** 첫 장면 안에 있는 동안만 장소를 적는다. 그 뒤로는 어디인지 서버가 모른다 */
  const place = view.elapsed < CUT_AFTER ? fs.place : '';
  const profile = () => go(`/play/${playId}/cast/${cast.key}`);

  return (
    <main className="app playing">
      <div className="band">
        <button className="ico" onClick={() => go('/')} aria-label="필름에서 나가기">
          <Back />
        </button>
      </div>

      {still && (
        <div className="screen grain">
          <img src={imgUrl(still)} alt="" />
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
      <div className="day" role="img" aria-label="첫 하루가 흐른 만큼">
        <span style={{ width: `${Math.min(100, (view.elapsed / RULES.trialMinutes) * 100)}%` }} />
      </div>

      {film.casts.length > 1 && (
        <nav className="with" aria-label="지금 누구와 있나">
          {film.casts.map((c) => (
            <button key={c.key} className={c.key === cast.key ? 'on' : ''} onClick={() => setRoom(c.key)}>
              <Face id={c.face ?? ''} name={c.name} />
              {c.name}
            </button>
          ))}
        </nav>
      )}

      <section className="flow" aria-live="polite">
        {cast.key === fs.room && fs.situation && <p className="tell">{fs.situation}</p>}

        {messages.map((m, i) => (
          <Fragment key={m.id}>
            {cuts(m, i) && <p className="cut">{formatWorld(clock, m.at)}</p>}
            {m.speaker === 'tell' ? (
              // 지문. 말한 사람이 없다
              m.text.split('\n').map((line, j) => (
                <p className="tell" key={j}>
                  {line}
                </p>
              ))
            ) : m.speaker === 'persona' ? (
              <div className="say me">
                <div>
                  <small>{film.persona.name}</small>
                  <p>{m.text}</p>
                </div>
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
        ))}

        {pendingHere && (
          <div className="say me sending">
            <div>
              <small>{film.persona.name}</small>
              <p>{pendingHere.text}</p>
            </div>
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
            <p>{cast.name}의 대사를 못 받았어.</p>
            <button className="btn more" onClick={retry}>
              다시 받기
            </button>
          </div>
        )}
        {view.stuck && !stuckHere && !waiting && (
          <div className="stuck">
            <p>앞에서 멈춘 일이 있어.</p>
            <button className="btn more" onClick={retry}>
              마저 하기
            </button>
          </div>
        )}
        {out && !waiting && (
          <div className="stuck">
            <p>보내는 중에 끊겼어.</p>
            <button className="btn more" onClick={() => deliver(out)}>
              다시 보내기
            </button>
          </div>
        )}
        {away && !waiting && (
          <div className="stuck">
            <p>시간을 넘기는 중에 끊겼어.</p>
            <button className="btn more" onClick={() => leave(away)}>
              다시 하기
            </button>
          </div>
        )}

        {notice && <p className="note">{notice}</p>}
        {view.ended && <p className="cut">첫 하루가 끝났어</p>}
        <div ref={bottom} />
      </section>

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
            placeholder={view.ended ? '첫 하루가 끝났어' : '말하기'}
            disabled={view.ended || !!view.stuck || !!away}
            autoComplete="off"
          />
          <button type="submit" className="send" disabled={locked || !draft.trim()} aria-label="보내기">
            <Arrow />
          </button>
        </form>
        <div className="safe" />
      </footer>
    </main>
  );
}
