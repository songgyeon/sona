/* 피드 한 칸. 종류마다 영화의 물건으로 놓는다 — 흑백 틀, 색은 사진에서만.
   본 영화·드라마: 영화표 반쪽 / 들은 노래: 필름 가장자리의 소리 띠 / 일기: 무성영화의 자막 카드 /
   사진: 35mm 필름 한 칸 / 검색어: 화면을 크게 잡은 한 컷 / 본 영상: 상영 시간표 / 읽은 책: 크레딧의 원작 표기. 한 줄 글은 예전 그대로.
   고칠 수 있는 사람에게는 글마다 연필이 선다. 누르면 「수정」「삭제」(PostTools) */

import { type Clock, formatWorld, partOfDay, worldAt } from '../shared/clock';
import { postLabel } from '../shared/feed';
import { DOW_NAMES, RULES } from '../shared/rules';
import type { PostData, PostView } from '../shared/types';
import { useState } from 'react';
import { imgUrl } from './api';
import { Pen } from './icons';

/** 같은 글이면 늘 같은 수(상영관, 좌석, 소리 띠의 모양) */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

const hhmm = (min: number) => `${String(Math.floor(min / 60) % 24).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

/** 「12:04」, 「3:00:00」 → 분 */
function minutesOf(length: string): number | null {
  const p = length.split(':').map(Number);
  if (p.some((x) => !Number.isFinite(x))) return null;
  if (p.length === 2) return p[0]! + p[1]! / 60;
  if (p.length === 3) return p[0]! * 60 + p[1]! + p[2]! / 60;
  return null;
}

/** 극장의 때: 조조, 낮, 저녁, 심야 */
function showtime(min: number): string {
  if (min < 5 * 60 || min >= 22 * 60) return '심야';
  if (min < 11 * 60) return '조조';
  if (min < 18 * 60) return '낮';
  return '저녁';
}

function Ticket({ id, d, min }: { id: string; d: Extract<PostData, { kind: 'watch' }>; min: number }) {
  const h = hash(id);
  const drama = d.form === 'drama';
  const ep = drama ? (d.ep.match(/\d+/)?.[0] ?? '') : '';
  return (
    <div className="tix">
      <div className="main">
        <p className="ad">{drama ? '드라마' : '관람권'}</p>
        <h3>{d.title}</h3>
        <p className="meta">{drama ? [d.ep, hhmm(min)].filter(Boolean).join(' · ') : `${showtime(min)} · ${hhmm(min)}`}</p>
      </div>
      <div className="stub">
        <small>{drama ? '회차' : '상영관'}</small>
        <b>{drama ? ep || '—' : (h % 9) + 1}</b>
        <small>{drama ? 'TV' : `${'ABCDEFGHJK'[(h >>> 4) % 10]}${((h >>> 8) % 18) + 1}`}</small>
      </div>
    </div>
  );
}

/** 필름 가장자리에 찍히는 소리 띠. 노래마다 모양이 다르다 */
function SoundBand({ seed }: { seed: string }) {
  const h = hash(seed);
  const bars = Array.from({ length: 64 }, (_, i) => {
    const w = 3 + Math.abs(Math.sin(i * (0.5 + (h % 7) / 10)) * 6 + Math.sin(i * (1.3 + (h % 5) / 10)) * 3);
    return <rect key={i} x={12 - w} y={i * 6 + 1} width={w * 2} height={4} fill="#bdbdbd" />;
  });
  return (
    <div className="ostband" aria-hidden="true">
      <svg viewBox="0 0 24 384" preserveAspectRatio="none">
        {bars}
      </svg>
    </div>
  );
}

const SearchIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
    <circle cx="11" cy="11" r="6.5" />
    <path d="m16 16 4.5 4.5" />
  </svg>
);
const ClockIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 2" />
  </svg>
);

/** 피드 한 칸. no는 사진의 필름 번호(그 사람이 올린 사진 가운데 몇째인가) */
export function FeedItem({ post, clock, no = 1 }: { post: PostView; clock: Clock; no?: number }) {
  const d = post.data;
  const w = worldAt(clock, post.at);
  const when = formatWorld(clock, post.at);
  if (d.kind === 'text') {
    return (
      <article className="post">
        <time>{when}</time>
        <p>{post.text}</p>
      </article>
    );
  }
  return (
    <article className="fd">
      <p className="k">
        {postLabel(d)}
        <time>{when}</time>
      </p>
      {d.kind === 'watch' && (
        <>
          <Ticket id={post.id} d={d} min={w.min} />
          {d.note && <p className="fnote">{d.note}</p>}
        </>
      )}
      {d.kind === 'song' && (
        <>
          <div className="ost">
            <SoundBand seed={`${d.title}/${d.artist}`} />
            <div className="txt">
              <small>사운드트랙</small>
              <h3>{d.title}</h3>
              {d.artist && <p>{d.artist}</p>}
              <i className="ostbar" />
            </div>
          </div>
          {d.note && <p className="fnote">{d.note}</p>}
        </>
      )}
      {d.kind === 'book' && (
        <>
          <div className="orig">
            <small>원작</small>
            <h3>{d.title}</h3>
            {d.author && <p>{d.author}</p>}
          </div>
          {d.note && <p className="fnote">{d.note}</p>}
        </>
      )}
      {d.kind === 'diary' && (
        <div className="intertitle">
          <div className="in">
            <p className="d">{`${DOW_NAMES[w.dow]} ${partOfDay(w.min)}`}</p>
            <p className="body">{d.text}</p>
          </div>
        </div>
      )}
      {d.kind === 'photo' && (
        <div className="neg">
          <div className="edge" aria-hidden="true">
            <span>SONA 400</span>
            <span>{String(no).padStart(2, '0')}</span>
          </div>
          <div className="pic grain">
            <img src={imgUrl(d.photo)} alt="" />
          </div>
          {d.note && <p className="cap">{d.note}</p>}
        </div>
      )}
      {d.kind === 'search' && (
        <div className="insert">
          <div className="scr">
            <div className="q">
              <SearchIcon />
              <span>
                {d.queries[d.queries.length - 1]}
                <i className="caret" />
              </span>
            </div>
            {d.queries.length > 1 && (
              <ul>
                {d.queries
                  .slice(0, -1)
                  .reverse()
                  .map((x, i) => (
                    <li key={i}>
                      <ClockIcon />
                      {x}
                    </li>
                  ))}
              </ul>
            )}
          </div>
        </div>
      )}
      {d.kind === 'tube' && <Program post={post} d={d} clock={clock} />}
    </article>
  );
}

/** 상영 시간표. 길이를 다 알면 본 때를 거꾸로 셈해 적는다 */
function Program({ post, d, clock }: { post: PostView; d: Extract<PostData, { kind: 'tube' }>; clock: Clock }) {
  const lens = d.items.map((x) => (x.length ? minutesOf(x.length) : null));
  const known = lens.every((x) => x !== null);
  const total = known ? lens.reduce<number>((n, x) => n + (x ?? 0), 0) : 0;
  let t = post.at - Math.round(total);
  return (
    <ol className="bill2">
      <li className="hd">
        <span>{known ? '본 때' : '차례'}</span>
        <span>상영 시간</span>
      </li>
      {d.items.map((x, i) => {
        const start = worldAt(clock, t).min;
        t += Math.round(lens[i] ?? 0);
        return (
          <li key={i}>
            <time>{known ? hhmm(start) : String(i + 1).padStart(2, '0')}</time>
            <b>{x.title}</b>
            <span>{x.length || '—'}</span>
          </li>
        );
      })}
    </ol>
  );
}

/** 고친 글을 서버에 보내는 모양. 내 글은 { text }, 그 밖에는 그 종류의 칸들 */
export type PostEdit = Record<string, unknown>;

type Mode = 'idle' | 'menu' | 'edit' | 'ask';

/** 피드 글의 연필. 누르면 「수정」「삭제」가 뜬다. 수정은 그 자리에서 고치고, 삭제는 한 번 묻는다(되돌릴 수 없다).
    onSave, onDrop은 못 했으면 까닭을 돌려준다 */
export function PostTools({ post, onSave, onDrop }: { post: PostView; onSave: (input: PostEdit) => Promise<string | null>; onDrop: () => Promise<string | null> }) {
  const [mode, setMode] = useState<Mode>('idle');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const run = async (f: () => Promise<string | null>, after: Mode) => {
    setBusy(true);
    setErr('');
    const why = await f();
    setBusy(false);
    if (why) setErr(why);
    else setMode(after);
  };
  return (
    <div className="ptools">
      {mode === 'edit' ? (
        <PostEditor post={post} busy={busy} onSave={(input) => void run(() => onSave(input), 'idle')} onCancel={() => setMode('idle')} />
      ) : (
        <div className="prow">
          {mode === 'ask' && (
            <p className="ask">
              이 글을 지울까요?
              <button className="textbtn" disabled={busy} onClick={() => void run(onDrop, 'idle')}>
                지우기
              </button>
              <button className="textbtn" disabled={busy} onClick={() => setMode('idle')}>
                취소
              </button>
            </p>
          )}
          {mode === 'menu' && (
            <div className="pmenu" role="menu">
              <button role="menuitem" onClick={() => setMode('edit')}>
                수정
              </button>
              <button role="menuitem" onClick={() => setMode('ask')}>
                삭제
              </button>
            </div>
          )}
          {mode !== 'ask' && (
            <button className="ico pen" aria-label="글 고치기" aria-expanded={mode === 'menu'} onClick={() => setMode(mode === 'menu' ? 'idle' : 'menu')}>
              <Pen />
            </button>
          )}
        </div>
      )}
      {err && <p className="warn">{err}</p>}
    </div>
  );
}

/** 고치는 칸: [보내는 이름, 이름표, 최대 길이, 여러 줄] */
type Slot = [string, string, number, boolean];

/** 글의 종류마다 고칠 칸과 지금 값. 종류는 바꾸지 않는다 */
function slotsOf(post: PostView): { slots: Slot[]; values: Record<string, string> } {
  const d = post.data;
  const F = RULES.feed;
  switch (d.kind) {
    case 'watch':
      return {
        slots: [['title', '제목', F.title, false], ...(d.form === 'drama' ? ([['ep', '회차', F.ep, false]] as Slot[]) : []), ['note', '한마디', F.note, false]],
        values: { title: d.title, ep: d.ep, note: d.note },
      };
    case 'song':
      return { slots: [['title', '곡명', F.title, false], ['artist', '부른 사람', F.artist, false], ['note', '한마디', F.note, false]], values: { title: d.title, artist: d.artist, note: d.note } };
    case 'book':
      return { slots: [['title', '제목', F.title, false], ['author', '지은이', F.artist, false], ['note', '한마디', F.note, false]], values: { title: d.title, author: d.author, note: d.note } };
    case 'diary':
      return { slots: [['text', '일기', F.diary, true]], values: { text: d.text } };
    case 'photo':
      return { slots: [['note', '한마디', F.note, false]], values: { note: d.note } };
    case 'search':
      return { slots: [['queries', '검색어', (F.query + 1) * F.items, true]], values: { queries: d.queries.join('\n') } };
    case 'tube':
      return { slots: [['items', '본 영상', (F.title + 12) * F.items, true]], values: { items: d.items.map((x) => (x.length ? `${x.title} (${x.length})` : x.title)).join('\n') } };
    default:
      return { slots: [['text', '글', RULES.feed.length, true]], values: { text: post.text } };
  }
}

/** 그 자리에서 고치는 칸들. 저장하면 서버가 다시 읽는다 */
function PostEditor({ post, busy, onSave, onCancel }: { post: PostView; busy: boolean; onSave: (input: PostEdit) => void; onCancel: () => void }) {
  const { slots, values } = slotsOf(post);
  const [v, setV] = useState(values);
  const lines = (k: string) => (v[k] ?? '').split('\n').map((x) => x.trim()).filter((x) => x.length > 0);
  const save = () => onSave(Object.fromEntries(slots.map(([k]) => [k, k === 'queries' || k === 'items' ? lines(k) : (v[k] ?? '')])));
  return (
    <div className="pedit2">
      {slots.map(([k, label, max, area]) => (
        <label key={k} className="pf">
          <span>{label}</span>
          {area ? (
            <textarea rows={k === 'queries' || k === 'items' ? 3 : 4} value={v[k] ?? ''} maxLength={max} onChange={(e) => setV((x) => ({ ...x, [k]: e.target.value }))} />
          ) : (
            <input value={v[k] ?? ''} maxLength={max} onChange={(e) => setV((x) => ({ ...x, [k]: e.target.value }))} />
          )}
          {(k === 'queries' || k === 'items') && <small>한 줄에 하나씩 적어 주세요.</small>}
        </label>
      ))}
      <div className="acts">
        <button className="btn play" disabled={busy} onClick={save}>
          저장
        </button>
        <button className="textbtn" disabled={busy} onClick={onCancel}>
          취소
        </button>
      </div>
    </div>
  );
}
