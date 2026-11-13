import { type FormEvent, Fragment, type KeyboardEvent, type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { type Clock, dayEnd, dayName, formatWorld, nextEvening, nextWake, worldAt } from '../../shared/clock';
import { josa } from '../../shared/ko';
import { splitLine } from '../../shared/line';
import { cutsOf, hasLines } from '../../shared/opening';
import { RULES } from '../../shared/rules';
import type { AsideView, Film, MessageView, Persona, PlayView } from '../../shared/types';
import { ApiFail, api, imgUrl, newId } from '../api';
import { useBgm } from '../bgm';
import { Arrow, Back, Bookmark, Down, PlayFill, SkipFill, Sound, SoundOff } from '../icons';
import { ReelOverlay } from '../reel';
import { SaveSheet } from '../saves';
import { Face, titleClass } from '../poster';
import { Tabs } from '../tabs';
import { type Go, goBack, replaceUrl } from '../router';

type SkipKind = 'evening' | 'sleep';

/** 한 번에 보내는 것. 지문과 대사 가운데 하나는 있다 */
interface Outgoing {
  /** 쓴 글 그대로. 지문은 *별표* 사이에 있다 */
  text: string;
  requestId: string;
}

/** 시간을 넘기는 단추. 넘긴 사이에도 캐스트는 자기 하루를 보낸다.
    낮에는 저녁과 다음 날 아침으로, 저녁이 지나면 아침으로만 갈 수 있다.
    가려는 때가 열어 둔 날의 끝(`end`)을 넘으면 서버는 날의 끝에서 멈추고 크레딧이 오른다 — 그 단추는 「하루 마치기」다.
    (2026-11-13 플레이에서: 저녁 7시에 「다음 날 아침으로」를 누르니 아침이 아니라 날이 끝나는 새벽 1:08로 갔다) */
function skipsAt(c: Clock, end: number): { kind: SkipKind; label: string }[] {
  const min = worldAt(c).min;
  const all: { kind: SkipKind; label: string }[] =
    min < RULES.skip.wakeMin
      ? [{ kind: 'sleep', label: '아침으로' }]
      : min < RULES.skip.eveningMin
        ? [
            { kind: 'evening', label: '저녁으로' },
            { kind: 'sleep', label: '다음 날 아침으로' },
          ]
        : [{ kind: 'sleep', label: '다음 날 아침으로' }];
  const out: { kind: SkipKind; label: string }[] = [];
  for (const s of all) {
    const to = s.kind === 'evening' ? nextEvening(c) : nextWake(c);
    if (to < end) out.push(s);
    else if (!out.some((o) => o.label === '하루 마치기')) out.push({ kind: s.kind, label: '하루 마치기' });
  }
  return out;
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
export function Opening({ film }: { film: Film }) {
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

/** 오프닝이 끝나면 서는 내 배역 소개. 이 필름에서 내가 누구인지 — 사진과 이름은 크게.
    긴 소개는 접어 둔다 — 필름 정보에서 이미 읽을 수 있고, 여기서는 이름이 뜬 다음 바로 첫 대사를 쓰게 한다.
    「고치기」는 오른쪽 위 내 얼굴과 같은 곳(내 배역)으로 간다. 이 카드를 보고 고치려는 사람이 많다
    (2026-11-13 플레이에서: 「소개 보기」를 눌러도 고칠 수 없었고, 고치는 곳은 눌러 보기 전엔 몰랐다). 미리 보기에는 없다 */
export function MeCard({ me, onEdit }: { me: Persona; onEdit?: () => void }) {
  const [open, setOpen] = useState(false);
  const more = Boolean(me.line) && !open;
  return (
    <div className="introme">
      <Face id={me.face} name={me.name} />
      <p className="k">내 배역</p>
      <h2>{me.name}</h2>
      {me.line && open && <p className="l">{me.line}</p>}
      {(more || onEdit) && (
        // 말하는 칸에 쓰다가 누르면 칸이 포커스를 잃으며 아래 탭이 다시 서고 화면이 밀린다 — 그 사이 단추가 움직여 눌리지 않는다.
        // 누르는 순간 포커스를 가져가지 않게 해서 화면이 그대로 있게 한다
        <p className="acts" onMouseDown={(e) => e.preventDefault()}>
          {more && (
            <button className="textbtn more" onClick={() => setOpen(true)}>
              소개 보기
            </button>
          )}
          {onEdit && (
            <button className="textbtn more" onClick={onEdit}>
              고치기
            </button>
          )}
        </p>
      )}
    </div>
  );
}

/** 말하는 칸에 쓰던 글. 내 배역을 고치러 가거나 다른 화면에 다녀와도 남게 이 기기에 둔다 — 삶마다 한 자리.
    (2026-11-13 플레이에서: 써 둔 대사가 화면이 바뀌면서 날아갔다) */
const SAY = (playId: string) => `sona.say.${playId}`;
function readSay(playId: string): string {
  try {
    return localStorage.getItem(SAY(playId)) ?? '';
  } catch {
    return '';
  }
}
function writeSay(playId: string, text: string): void {
  try {
    if (text) localStorage.setItem(SAY(playId), text);
    else localStorage.removeItem(SAY(playId));
  } catch {
    /* 저장이 막힌 브라우저에서는 이 화면에서만 남는다 */
  }
}

/** 이 삶의 오프닝을 이 기기에서 끝까지 읽었나 */
const READ = (playId: string) => `sona.read.${playId}`;
function wasRead(playId: string): boolean {
  try {
    return localStorage.getItem(READ(playId)) === '1';
  } catch {
    return false;
  }
}
function markRead(playId: string): void {
  try {
    localStorage.setItem(READ(playId), '1');
  } catch {
    /* 저장이 막히면 돌아올 때 오프닝을 처음부터 다시 읽는다 */
  }
}

/** 기본 오프닝: 검은 화면에 제목이 떴다가 걷힌다. 오프닝 영상이 없는 필름에만 뜬다 — 영상이 있으면 영상이 오프닝이다
    (2026-11-12 사용자 지시: 「오프닝이 없으면 검은색+글자 기본 오프닝이 뜨고 있으면 그거 안 뜨게」) */
export function TitleCard({ title }: { title: string }) {
  return (
    <div className="titlecard" aria-hidden="true">
      <h1 className={titleClass(title)}>{title}</h1>
    </div>
  );
}

/** 재생. 위에 지금 장면이 걸리고, 아래로 장면이 흐른다 */
export function Play({ playId, go }: { playId: string; go: Go }) {
  const [view, setView] = useState<PlayView | null>(null);
  /** 쓰고 있는 글. 대사와 지문을 한 칸에 쓴다. 지문은 *별표* 사이에 쓴다 */
  const [draft, setDraft] = useState(() => readSay(playId));
  /** 지금 들고 있는 글이 어느 삶의 것인지. 다른 삶으로 넘어오면 그 삶의 글을 꺼낸다 — 앞 삶의 글을 덮어쓰지 않는다 */
  const sayOf = useRef(playId);
  useEffect(() => {
    if (sayOf.current !== playId) {
      sayOf.current = playId;
      setDraft(readSay(playId));
      return;
    }
    writeSay(playId, draft);
  }, [playId, draft]);
  const box = useRef<HTMLTextAreaElement>(null);
  /** 보냈는데 아직 답이 안 온 말. 끊기면 같은 전송 표로 다시 보낸다 — 서버는 한 번만 처리한다 */
  const [out, setOut] = useState<Outgoing | null>(null);
  /** 시간을 넘기는 중. 끊기면 같은 표로 다시 부른다 */
  const [away, setAway] = useState<{ kind: SkipKind; requestId: string } | null>(null);
  const [waiting, setWaiting] = useState(false);
  const [err, setErr] = useState('');
  const [notice, setNotice] = useState('');
  /** 시간을 넘긴 사이 새로 올라온 피드: 마지막에 올린 캐스트와 글 수. 누르면 그 캐스트의 피드로 간다 */
  const [newFeed, setNewFeed] = useState<{ cast: string; count: number } | null>(null);
  /** 「필름에 들어가기」로 막 들어왔고 오프닝 영상이 없으면 기본 오프닝(검은 화면에 제목)이 먼저 뜬다 */
  const [card, setCard] = useState(() => new URLSearchParams(window.location.search).has('open'));
  /** 막 들어왔고 필름에 오프닝 영상이 있으면 그것부터 흐른다. 끝나거나 건너뛰면 바로 첫 장면이다 — 제목을 따로 띄우지 않는다 */
  const [reelOn, setReelOn] = useState(() => new URLSearchParams(window.location.search).has('open'));
  /** 오프닝을 읽는 중. 끝에 닿으면 말하는 칸이 선다 */
  const [reading, setReading] = useState(false);
  // 끝까지 읽었으면 이 기기에 적어 둔다 — 다른 화면에 다녀와도 오프닝을 처음부터 다시 읽게 하지 않는다
  useEffect(() => {
    if (view && !reading) markRead(playId);
  }, [view, reading, playId]);
  /** 장면 저장 시트를 열어 두었나. 필름 정보의 「저장한 장면」에서 오면 열린 채로 온다(?saves) */
  const [saving, setSaving] = useState(() => new URLSearchParams(window.location.search).has('saves'));
  /** 지금 화면에 걸린 컷과, 그 밑에 깔린 바로 앞 컷 */
  const [shot, setShot] = useState('');
  const [under, setUnder] = useState('');
  const flow = useRef<HTMLElement>(null);
  /** 하루의 끝에 오르는 크레딧 */
  const [credits, setCredits] = useState(false);
  const [closing, setClosing] = useState(false);
  /** 배경 음악. 오프닝 영상과 제목이 걷힌 뒤부터 흐른다 */
  const bgm = useBgm(view?.film.bgm ?? '', !!view && !reelOn && !card);
  const wasEnded = useRef<boolean | null>(null);
  const tick = useRef(0);
  const still = useRef(0);

  useEffect(() => {
    api
      .play(playId)
      .then((v) => {
        setView(v);
        const reel = (v.film.reel?.clips.length ?? 0) > 0;
        setReelOn((on) => on && reel);
        setCard((on) => on && !reel);
        // 아직 한마디도 안 했으면 오프닝을 처음부터 읽는다. 다만 이 기기에서 끝까지 읽은 오프닝은 다시 처음으로 돌리지 않는다 —
        // 내 배역을 고치러 갔다 오면 말하는 칸이 그대로 서 있어야 한다(2026-11-13 플레이에서)
        setReading(hasLines(v.film) && v.elapsed === 0 && !v.messages.some((m) => m.speaker === 'persona') && !wasRead(playId));
      })
      .catch((e) => setErr(e instanceof ApiFail ? e.message : '필름을 불러오지 못했어요.'));
  }, [playId]);

  // 제목은 잠깐 떴다가 걷힌다. 주소에 남은 표시는 지운다 — 새로 고쳐도 다시 뜨지 않게
  useEffect(() => {
    if (!card) return;
    replaceUrl(window.location.pathname);
    if (!view || reelOn) return;
    const t = setTimeout(() => setCard(false), TITLE_MS);
    return () => clearTimeout(t);
  }, [card, view !== null, reelOn]);

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
      go(`/play/${fresh.id}?open=1`, { replace: true });
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
  }, [view, out, waiting, reading]);

  // 말하는 칸은 쓴 만큼 자란다. 너무 길어지면 그 안에서 굴린다
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 132)}px`;
  }, [draft, view]);

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
    setNewFeed(null);
    try {
      setView(await api.say(playId, o.text, o.requestId));
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

  const send = () => {
    const text = draft.trim();
    if (splitLine(text).length === 0 || waiting || !view || view.ended || view.stuck || out || away) return;
    setDraft('');
    void deliver({ text, requestId: newId() });
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    send();
  };

  /** 자판으로 쓰는 화면에서는 Enter로 보낸다(Shift+Enter는 줄바꿈). 손가락으로 쓰는 화면에서는 줄을 바꾸고, 보내기는 단추로 한다.
      글자를 조합하는 중에 누른 Enter는 조합을 끝내는 것이다 — 보내지 않는다 */
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing || e.keyCode === 229) return;
    if (window.matchMedia('(pointer: coarse)').matches) return;
    e.preventDefault();
    send();
  };

  /** 「지문」 단추: 별표 한 쌍을 넣고 그 사이에 쓰게 한다. 골라 둔 글이 있으면 그 글을 별표로 감싼다 */
  const addAct = () => {
    const el = box.current;
    if (!el) return;
    const from = el.selectionStart ?? draft.length;
    const to = el.selectionEnd ?? draft.length;
    const head = draft.slice(0, from);
    const picked = draft.slice(from, to);
    // 대사와 붙어 버리지 않게 앞에 한 칸 띄운다
    const gap = head && !/\s$/.test(head) ? ' ' : '';
    const next = `${head}${gap}*${picked}*${draft.slice(to)}`;
    if (next.length > RULES.limits.say) return;
    setDraft(next);
    // 고른 글이 없으면 별표 사이에, 있으면 닫는 별표 뒤에 선다
    const caret = head.length + gap.length + 1 + picked.length + (picked ? 1 : 0);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(caret, caret);
    });
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
    setNewFeed(null);
    const seenMessages = new Set(view.messages.map((m) => m.id));
    const seenPosts = new Set(view.posts.map((p) => p.id));
    try {
      const next = await api.skip(playId, a.kind, a.requestId);
      setView(next);
      setAway(null);
      // 돌아와서 보니 와 있는 것들
      // 한편의 줄은 누가 나에게 보낸 것이 아니다
      const from = [...new Set(next.messages.filter((m) => !seenMessages.has(m.id) && m.kind === 'ping').map((m) => m.speaker))];
      const names = from.map((key) => next.film.casts.find((c) => c.key === key)?.name ?? key);
      const fresh = next.posts.filter((p) => !seenPosts.has(p.id));
      // 아무 일도 오지 않았을 때: 「연락이 없어요」는 같은 자리에 있다가 넘긴 때(같이 밤을 보낸 때)에 어색하다.
      // 떨어져 있었든 같이 있었든 맞는 말로 둔다(2026-11-13 플레이에서)
      setNotice(names.length > 0 ? `${names.join(', ')}의 메시지` : fresh.length > 0 ? '' : '그 사이 별일 없었어요.');
      setNewFeed(fresh.length > 0 ? { cast: fresh[fresh.length - 1]!.cast, count: fresh.length } : null);
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
  /** 채팅은 하나다. 유저의 말과 지문, 캐스트의 말, 지문, 폰으로 온 메시지가 한 흐름에 놓인다.
      한편(내가 없는 자리의 장면)의 줄만 따로다 — 그건 눌러서 읽는다 */
  const messages = view.messages.filter((m) => m.kind !== 'aside');
  const pendingHere = out;
  /** 대사를 못 받고 멈춘 턴. 시간을 넘기다 멈춘 것은 따로 알린다 */
  const stuckHere = view.stuck && view.stuck.kind !== 'skip';
  const locked = waiting || view.ended || !!view.stuck || !!out || !!away;
  /** 흐름에 놓이는 것들: 오간 말, 그리고 그 사이사이에 있었던 한편. 작중 시각 순.
      피드 글은 흐름에 놓지 않는다 — 피드는 프로필에서 본다(2026-11-12 사용자 지시) */
  const items: ({ at: number; m: MessageView; a?: undefined } | { at: number; a: AsideView; m?: undefined })[] = [
    ...messages.map((m) => ({ at: m.at, m })),
    ...view.asides.map((a) => ({ at: a.at, a })),
  ].sort((x, y) => x.at - y.at);
  const cuts = (i: number) => i > 0 && items[i]!.at - items[i - 1]!.at >= CUT_AFTER;
  const castOf = (key: string) => film.casts.find((c) => c.key === key);
  const fs = film.firstScene;
  /** 화면에 거는 그림. 읽는 자리의 컷이 먼저고, 없으면 첫 컷, 그것도 없으면 포스터 */
  const onScreen = shot || cutsOf(film)[0] || (film.stills ?? [])[0] || film.poster || '';
  /** 지금 장면이 벌어지는 곳. 장면을 쓰는 작가가 대목마다 알려 준 것이다. 모르면 적지 않는다 */
  const place = view.place;
  const profile = (key: string) => go(`/play/${playId}/cast/${key}`);
  /** 내 배역 */
  const me = film.persona;
  /** 「첫 하루」, 「둘째 날」 … */
  const today = dayName(view.day);

  return (
    <main className="app playing">
      <div className="band">
        <button className="ico" onClick={() => goBack(go, view ? `/film/${view.filmId}` : '/')} aria-label="필름에서 나가기">
          <Back />
        </button>
        <div className="right">
          {bgm.has && (
            <button className="ico" onClick={bgm.toggle} aria-label={bgm.on ? '배경 음악 끄기' : '배경 음악 켜기'} aria-pressed={bgm.on}>
              {bgm.on ? <Sound /> : <SoundOff />}
            </button>
          )}
          {/* 장면 저장. 지금 장면을 남기고, 남긴 장면에서 다시 산다 */}
          <button className="ico keepbtn" onClick={() => setSaving(true)} aria-label="장면 저장">
            <Bookmark />
          </button>
          {/* 내 배역. 사진과 정보를 고치러 간다 */}
          <button className="mine" onClick={() => go(`/play/${playId}/me`)} aria-label="내 배역">
            <Face id={me.face ?? ''} name={me.name} />
          </button>
        </div>
      </div>
      {saving && (
        <SaveSheet
          playId={playId}
          clock={clock}
          locked={waiting || !!out || !!away}
          onClose={() => setSaving(false)}
          onLoaded={(next) => {
            setView(next);
            setSaving(false);
            setReading(false);
            setErr('');
            setNewFeed(null);
            setNotice('저장한 장면으로 돌아왔어요.');
          }}
        />
      )}

      {/* 그림은 오프닝을 읽는 동안에만 걸린다. 다 읽으면 치우고, 그 뒤로는 화면 전체가 오가는 말이다 */}
      {onScreen && reading && (
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

      <section className="flow" aria-live="polite" ref={flow} onScroll={onScroll}>
        {fs.beats.length > 0 && <Opening film={film} />}
        <MeCard me={film.persona} onEdit={() => go(`/play/${playId}/me`)} />

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
            ) : m.speaker === 'persona' && m.kind === 'act' ? (
              // 내가 쓴 지문. 지문과 같은 모양으로 놓인다
              m.text.split('\n').map((line, j) => (
                <p className="tell byme" key={j}>
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
            ) : (
              // 캐스트의 말. 저마다 제 얼굴과 이름으로 나온다
              ((who) =>
                m.kind === 'ping' ? (
                  // 작품 속 폰으로 먼저 온 연락. 말풍선은 여기만 쓴다
                  <button className="msg" onClick={() => profile(who.key)} aria-label={`${who.name}의 프로필 보기`}>
                    <Face id={who.face ?? ''} name={who.name} />
                    <span>
                      <small>{who.name} · 메시지</small>
                      <p>{m.text}</p>
                    </span>
                  </button>
                ) : (
                  <button className="say" onClick={() => profile(who.key)} aria-label={`${who.name}의 프로필 보기`}>
                    <Face id={who.face ?? ''} name={who.name} />
                    <span>
                      <small>{who.name}</small>
                      <p>{m.text}</p>
                    </span>
                  </button>
                ))(castOf(m.speaker) ?? film.casts[0]!)
            )}
          </Fragment>
          ),
        )}

        {/* 보냈는데 아직 답이 안 온 글. 서버가 가르는 것과 같은 셈으로 미리 놓는다 */}
        {pendingHere &&
          splitLine(pendingHere.text).map((line, j) =>
            line.kind === 'act' ? (
              <p className="tell byme sending" key={j}>
                {line.text}
              </p>
            ) : (
              <div className={me.face ? 'say me faced sending' : 'say me sending'} key={j}>
                <div>
                  <small>{me.name}</small>
                  <p>{line.text}</p>
                </div>
                {me.face && <Face id={me.face} name={me.name} />}
              </div>
            ),
          )}
        {/* 다음 대목을 쓰는 중. 누가 나올지는 아직 모른다 — 다음 지문이 올 자리에서 점 셋이 하나씩 밝아진다 */}
        {waiting && !away && (
          <p className="writing" role="status">
            <span className="sr">다음 장면을 쓰는 중이에요.</span>
            <i />
            <i />
            <i />
          </p>
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

        {(notice || newFeed) && (
          <p className="note">
            {notice}
            {notice && newFeed ? ' · ' : ''}
            {newFeed && (
              <button className="feedlink" onClick={() => profile(newFeed.cast)}>
                새 피드 {newFeed.count}개
              </button>
            )}
          </p>
        )}
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
          <button className="btn more wide" disabled={closing} onClick={again}>
            처음부터 다시 살기
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
            {skipsAt(clock, dayEnd(view.day)).map((s) => (
              // 말하는 칸에 쓰다가 누르면 칸이 포커스를 잃으며 아래 탭이 다시 서고, 그 사이 단추가 밀려 눌리지 않는다.
              // 누르는 순간에는 포커스를 그대로 두고, 눌린 뒤에 칸을 놓는다(자판을 닫는다)
              <button
                key={s.kind}
                className="skip"
                disabled={locked}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  box.current?.blur();
                  leave({ kind: s.kind, requestId: newId() });
                }}
              >
                {s.label}
                <SkipFill />
              </button>
            ))}
          </div>
        )}
        {/* 말하는 칸은 하나다. 대사와 지문을 함께 쓰고, 지문은 *별표* 사이에 쓴다 */}
        <form className="box" onSubmit={submit}>
          <button
            type="button"
            className="addact"
            onMouseDown={(e) => e.preventDefault()}
            onClick={addAct}
            disabled={view.ended || !!view.stuck || !!away}
            aria-label="지문 넣기"
          >
            지문
          </button>
          <label htmlFor="say" className="sr">
            대사와 지문
          </label>
          <textarea
            id="say"
            ref={box}
            rows={1}
            value={draft}
            maxLength={RULES.limits.say}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKey}
            placeholder="대사와 *지문*을 써 주세요."
            disabled={view.ended || !!view.stuck || !!away}
            autoComplete="off"
          />
          {/* 칸 밖에 포커스가 있을 때(써 둔 글이 남아 있는 채로 돌아왔을 때) 누르면, 단추가 포커스를 받으며 아래 탭이 숨고
              그 사이 단추가 밀려 눌리지 않는다. 그때만 포커스를 옮기지 않는다 — 칸에 쓰던 중에 누르는 것은 전과 같다 */}
          <button
            type="submit"
            className="send"
            disabled={locked || splitLine(draft).length === 0}
            aria-label="보내기"
            onMouseDown={(e) => {
              if (!e.currentTarget.form?.contains(document.activeElement)) e.preventDefault();
            }}
          >
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

      {reelOn && film.reel && <ReelOverlay reel={film.reel} onDone={() => setReelOn(false)} />}
      {card && <TitleCard title={film.title} />}
      <Tabs path="" go={go} />
    </main>
  );
}
