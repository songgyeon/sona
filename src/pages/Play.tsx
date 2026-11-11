import { type CSSProperties, type FormEvent, Fragment, useEffect, useRef, useState } from 'react';
import { formatWorld } from '../../shared/clock';
import { RULES } from '../../shared/rules';
import type { MessageView, PlayView } from '../../shared/types';
import { ApiFail, api, newId } from '../api';
import { hueOf } from '../poster';
import { Feed } from './Feed';

type SkipKind = 'short' | 'errand' | 'sleep';
type Tab = 'chat' | 'feed';

interface Outgoing {
  room: string;
  text: string;
  requestId: string;
}

const SKIPS: { kind: SkipKind; label: string; hint: string }[] = [
  { kind: 'short', label: '잠깐 자리 비우기', hint: `${RULES.skip.short}분` },
  { kind: 'errand', label: '볼일 보고 오기', hint: `${RULES.skip.errand / 60}시간` },
  { kind: 'sleep', label: '자고 오기', hint: '다음 날 아침' },
];

/** 앞 말풍선과 이만큼 벌어지면 시각을 적는다(작중 분) */
const DIVIDE_AFTER = 30;

export function Play({ playId, go }: { playId: string; go: (to: string) => void }) {
  const [view, setView] = useState<PlayView | null>(null);
  const [room, setRoom] = useState('');
  const [draft, setDraft] = useState('');
  /** 보냈는데 아직 답이 안 온 말. 끊기면 같은 전송 표로 다시 보낸다 — 서버는 한 번만 처리한다 */
  const [out, setOut] = useState<Outgoing | null>(null);
  /** 자리를 비우는 중. 끊기면 같은 표로 다시 부른다 */
  const [away, setAway] = useState<{ kind: SkipKind; requestId: string } | null>(null);
  const [waiting, setWaiting] = useState(false);
  const [menu, setMenu] = useState(false);
  const [err, setErr] = useState('');
  const [notice, setNotice] = useState('');
  const [tab, setTab] = useState<Tab>('chat');
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api
      .play(playId)
      .then((v) => {
        setView(v);
        setRoom(v.film.firstScene.room);
      })
      .catch((e) => setErr(e instanceof ApiFail ? e.message : '플레이를 못 불러왔어.'));
  }, [playId]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' });
  }, [view, out, room, waiting, tab]);

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
    setMenu(false);
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
      setTab('chat');
    } catch (e) {
      if (e instanceof ApiFail && e.status !== 0 && e.status < 500) {
        setAway(null);
        setView(await api.play(playId).catch(() => view));
      }
      setErr(e instanceof ApiFail ? e.message : '자리를 비우지 못했어.');
    }
    setWaiting(false);
  };

  if (!view) return <p className="center muted">{err || '필름에 들어가는 중…'}</p>;

  const film = view.film;
  const clock = { startDow: film.startDow, startMin: film.startMin, elapsed: view.elapsed };
  const cast = film.casts.find((c) => c.key === room) ?? film.casts[0]!;
  const messages = view.messages.filter((m) => m.room === cast.key);
  const pendingHere = out && out.room === cast.key ? out : null;
  const stuckHere = view.stuck && view.stuck.room === cast.key;
  const locked = waiting || view.ended || !!view.stuck || !!out || !!away;

  const divides = (m: MessageView, i: number) => i === 0 || m.at - messages[i - 1]!.at >= DIVIDE_AFTER;

  const fs = film.firstScene;

  return (
    <div className="stage" style={{ '--h': hueOf(film.title) } as CSSProperties}>
    <main className="play">
      <header className="top">
        <button className="ghost" onClick={() => go('/')} aria-label="필름 목록으로">
          ←
        </button>
        <div className="where">
          <strong>{film.title}</strong>
          <span className="when">{formatWorld(clock)}</span>
        </div>
        {film.opens.feed && (
          <button className={tab === 'feed' ? 'pill on' : 'pill'} onClick={() => setTab(tab === 'feed' ? 'chat' : 'feed')}>
            피드
          </button>
        )}
      </header>

      <nav className="rooms" aria-label="대화 상대" hidden={film.casts.length < 2}>
        {film.casts.map((c) => (
          <button
            key={c.key}
            className={tab === 'chat' && c.key === cast.key ? 'on' : ''}
            onClick={() => {
              setRoom(c.key);
              setTab('chat');
            }}
          >
            {c.name}
          </button>
        ))}
      </nav>

      {tab === 'feed' && <Feed view={view} />}

      <section className="chat" aria-live="polite" hidden={tab !== 'chat'}>
        {cast.key === fs.room && (fs.place || fs.situation) && (
          <p className="scene">
            {fs.place && <strong>{fs.place}</strong>}
            {fs.situation}
          </p>
        )}
        {messages.map((m, i) => (
          <Fragment key={m.id}>
            {divides(m, i) && <p className="divider">{formatWorld(clock, m.at)}</p>}
            <p className={m.speaker === 'persona' ? 'bubble me' : 'bubble them'}>{m.text}</p>
          </Fragment>
        ))}
        {pendingHere && <p className="bubble me sending">{pendingHere.text}</p>}
        {waiting && !away && <p className="bubble them typing">…</p>}
        {away && waiting && <p className="passing">시간이 흐르는 중…</p>}
        {stuckHere && !waiting && (
          <div className="stuck">
            <p>{cast.name}의 답을 못 받았어.</p>
            <button onClick={retry}>다시 받기</button>
          </div>
        )}
        {view.stuck && !stuckHere && !waiting && (
          <div className="stuck">
            <p>앞에서 멈춘 일이 있어.</p>
            <button onClick={retry}>마저 하기</button>
          </div>
        )}
        {out && !waiting && (
          <div className="stuck">
            <p>보내는 중에 끊겼어.</p>
            <button onClick={() => deliver(out)}>다시 보내기</button>
          </div>
        )}
        {away && !waiting && (
          <div className="stuck">
            <p>자리를 비우는 중에 끊겼어.</p>
            <button onClick={() => leave(away)}>다시 하기</button>
          </div>
        )}
        {notice && <p className="notice">{notice}</p>}
        {view.ended && <p className="ended">이 필름에서의 첫 하루가 끝났어.</p>}
        <div ref={bottom} />
      </section>

      <div className="foot">
        {err && <p className="warn">{err}</p>}
        {menu && (
          <div className="away" role="menu">
            {SKIPS.map((s) => (
              <button key={s.kind} role="menuitem" disabled={locked} onClick={() => leave({ kind: s.kind, requestId: newId() })}>
                <span>{s.label}</span>
                <span className="muted">{s.hint}</span>
              </button>
            ))}
          </div>
        )}
        <form className="say" onSubmit={submit} hidden={tab !== 'chat'}>
          <button type="button" className="pill" disabled={locked} aria-expanded={menu} onClick={() => setMenu(!menu)}>
            자리 비우기
          </button>
          <label htmlFor="say" className="sr">
            {cast.name}에게 보낼 말
          </label>
          <input
            id="say"
            value={draft}
            maxLength={RULES.limits.say}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={view.ended ? '첫 하루가 끝났어' : `${cast.name}에게`}
            disabled={view.ended || !!view.stuck || !!away}
            autoComplete="off"
          />
          <button type="submit" disabled={locked || !draft.trim()}>
            보내기
          </button>
        </form>
      </div>
    </main>
    </div>
  );
}
