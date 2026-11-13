/* 들어가는 사람 고르기. 필름 정보에는 지금 고른 사람 한 칸만 둔다.
   누르면 입장권 모양의 목록이 뜬다: 배역과 내 페르소나가 줄지어 서고, 하나를 누르면 그 사람으로 들어간다. */

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { FilmMine, MyPersona, Persona } from '../shared/types';
import { Close, Next } from './icons';
import { ticketNo, today } from './me';
import { Face } from './poster';
import { fillUser, shownName } from '../shared/roles';

/** 배역의 「나이 · 직업」. 적지 않았으면 빈 글자 */
export const creditOf = (r: { age?: string; job?: string } | undefined): string => [r?.age, r?.job].filter((s) => s && s.trim()).join(' · ');

/** 지금 고른 사람이 무엇인가. 배역이면 그 배역의 「나이 · 직업」, 배역이 여럿이면 맡은 배역도 적는다.
    「유저 이름」은 만드는 사람의 말이라 들어가는 사람에게는 쓰지 않는다 */
export const asLabel = (mine: FilmMine, roles: Persona[] = []): string => {
  const r = roles[mine.role];
  const credit = creditOf(r);
  if (mine.as === 'role') return credit || '배역';
  const base = mine.personaId ? '내 페르소나' : mine.as === 'me' ? '내 이름' : '고친 배역';
  if (!r || roles.length < 2) return base;
  return `${base} · ${credit || (r.player ? `배역 ${mine.role + 1}` : `${r.name} 역`)}`;
};

/** 필름 정보의 한 칸. 지금 들어가는 사람, 「고치기」와 「바꾸기」.
    고치기는 고른 내 페르소나면 그 페르소나를, 아니면 살고 있는 삶의 내 배역을 고친다. 둘 다 없으면 서지 않는다 */
export function AsSlot({ mine, roles, onOpen, onEdit, busy }: { mine: FilmMine; roles: Persona[]; onOpen: () => void; onEdit: (() => void) | null; busy: boolean }) {
  return (
    <div className="asme">
      <p>들어가는 사람</p>
      <div className="asone">
        <button className="aswho" onClick={onOpen} disabled={busy} aria-haspopup="dialog" aria-label={`${mine.name}, 들어가는 사람 바꾸기`}>
          <Face id={mine.face} name={mine.name} />
          <span>
            <b>{mine.name}</b>
            <small>{asLabel(mine, roles)}</small>
          </span>
        </button>
        <div className="acts">
          {onEdit && (
            <button onClick={onEdit} disabled={busy}>
              고치기
            </button>
          )}
          <button onClick={onOpen} disabled={busy} aria-haspopup="dialog">
            바꾸기
            <Next />
          </button>
        </div>
      </div>
    </div>
  );
}

/** 고른 사람. role은 맡을 배역의 차례(0 = 첫째 배역) */
export type Pick = { as: 'role'; role: number } | { as: 'persona'; id: string; role: number };

/** 입장권. 배역과 내 페르소나 목록. 고르면 아래쪽이 떨어져 나가며 닫힌다.
    배역이 여럿인 필름에서 내 페르소나를 고르면 그 페르소나가 맡을 배역을 한 번 더 묻는다 */
export function AsPop({
  title,
  roles,
  myName,
  mine,
  personas,
  onPick,
  onManage,
  onClose,
}: {
  title: string;
  /** 필름의 배역 전부(첫째가 film.persona) */
  roles: Persona[];
  /** 입장권의 내 이름. 「유저 이름」 배역은 이 이름으로 보인다 */
  myName: string;
  mine: FilmMine;
  personas: MyPersona[];
  /** 고른 사람으로 바꾼다. 못 바꿨으면 까닭을 돌려준다 */
  onPick: (p: Pick) => Promise<string | null>;
  onManage: () => void;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [leaving, setLeaving] = useState(false);
  const [no] = useState(ticketNo);
  /** 맡을 배역을 묻고 있는 내 페르소나 */
  const [asking, setAsking] = useState<MyPersona | null>(null);

  // 뒤의 화면이 따라 움직이지 않게 붙들어 둔다
  useEffect(() => {
    const root = document.documentElement;
    const before = root.style.overflow;
    root.style.overflow = 'hidden';
    return () => {
      root.style.overflow = before;
    };
  }, []);

  const pick = async (p: Pick) => {
    if (busy) return;
    const same = p.as === 'role' ? mine.as === 'role' && !mine.personaId && mine.role === p.role : mine.personaId === p.id && mine.role === p.role;
    if (same) {
      onClose();
      return;
    }
    setBusy(true);
    setErr('');
    const why = await onPick(p);
    if (why) {
      setErr(why);
      setBusy(false);
      return;
    }
    setLeaving(true);
    setTimeout(onClose, 480);
  };

  // Esc로 닫는다. 입장권 안에 손이 가 있지 않아도 된다
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  /** 지금 고른 사람이 배역도 페르소나도 아니면(내 배역을 고쳐 들어가던 사람) 맨 위에 그대로 세운다 */
  const other = mine.as !== 'role' && !mine.personaId;

  return createPortal(
    <div className="namepop" role="dialog" aria-modal="true" aria-label="들어가는 사람" onClick={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className={leaving ? 'ticket aspop out' : 'ticket aspop'}>
        <div className="tk-main">
          <div className="tk-top">
            <span className="tk-logo">SONA</span>
            <span className="tk-no">No. {no}</span>
            <button type="button" className="tk-x" onClick={onClose} disabled={busy} aria-label="닫기">
              <Close />
            </button>
          </div>
          <div className="tk-strip" aria-hidden="true" />
          {asking ? (
            <>
              <p className="tk-kicker">{asking.name}</p>
              <h2 className="tk-ask">어느 배역으로 들어갈까요?</h2>
              <ul className="tk-list">
                {roles.map((r, i) => {
                  const on = mine.personaId === asking.id && mine.role === i;
                  return (
                    <li key={i}>
                      <button className={on ? 'on' : ''} aria-pressed={on} disabled={busy} onClick={() => void pick({ as: 'persona', id: asking.id, role: i })}>
                        <Face id={r.face} name={r.player ? asking.name : r.name} />
                        <span>
                          <b>{r.player ? asking.name : r.name}</b>
                          <small>
                            {creditOf(r) || '배역'}
                            {r.line ? `\n${fillUser(r.line, r.player ? asking.name : r.name)}` : ''}
                          </small>
                        </span>
                        {on && <em>지금</em>}
                      </button>
                    </li>
                  );
                })}
              </ul>
              <button type="button" className="tk-back" disabled={busy} onClick={() => setAsking(null)}>
                다른 사람 고르기
              </button>
            </>
          ) : (
            <>
              <p className="tk-kicker">들어가는 사람</p>
              <h2 className="tk-ask">누구로 들어갈까요?</h2>
              <ul className="tk-list">
                {other && (
                  <li>
                    <button className="on" aria-pressed="true" disabled={busy} onClick={onClose}>
                      <Face id={mine.face} name={mine.name} />
                      <span>
                        <b>{mine.name}</b>
                        <small>{asLabel(mine, roles)}</small>
                      </span>
                      <em>지금</em>
                    </button>
                  </li>
                )}
                {roles.map((r, i) => {
                  const on = mine.as === 'role' && !mine.personaId && mine.role === i;
                  const name = shownName(r, myName);
                  return (
                    <li key={`r${i}`}>
                      <button className={on ? 'on' : ''} aria-pressed={on} disabled={busy} onClick={() => void pick({ as: 'role', role: i })}>
                        <Face id={r.face} name={name} />
                        <span>
                          <b>{name}</b>
                          <small>
                            {creditOf(r) || '배역'}
                            {roles.length > 1 && r.line ? `\n${fillUser(r.line, name)}` : ''}
                          </small>
                        </span>
                        {on && <em>지금</em>}
                      </button>
                    </li>
                  );
                })}
                {personas.map((p) => {
                  const on = mine.personaId === p.id;
                  return (
                    <li key={p.id}>
                      <button
                        className={on ? 'on' : ''}
                        aria-pressed={on}
                        disabled={busy}
                        onClick={() => (roles.length > 1 ? setAsking(p) : void pick({ as: 'persona', id: p.id, role: 0 }))}
                      >
                        <Face id={p.face} name={p.name} />
                        <span>
                          <b>{p.name}</b>
                          <small>{p.line || '내 페르소나'}</small>
                        </span>
                        {on && <em>지금</em>}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
          {err && (
            <p className="tk-err" role="alert">
              {err}
            </p>
          )}
        </div>
        <div className="tk-stub">
          <button type="button" className="tk-go" disabled={busy} onClick={onManage}>
            페르소나 관리
          </button>
          <div className="tk-date">
            <span>{today()}</span>
            <span className="tk-film">{title}</span>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
