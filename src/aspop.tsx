/* 들어가는 사람 고르기. 필름 정보에는 지금 고른 사람 한 칸만 둔다.
   누르면 입장권 모양의 목록이 뜬다: 배역과 내 페르소나가 줄지어 서고, 하나를 누르면 그 사람으로 들어간다. */

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { FilmMine, MyPersona, Persona } from '../shared/types';
import { Close, Next } from './icons';
import { ticketNo, today } from './me';
import { Face } from './poster';

/** 지금 고른 사람이 무엇인가 */
export const asLabel = (mine: FilmMine): string =>
  mine.as === 'role' ? '배역' : mine.personaId ? '내 페르소나' : mine.as === 'me' ? '내 이름' : '고친 배역';

/** 필름 정보의 한 칸. 지금 들어가는 사람, 「고치기」와 「바꾸기」.
    고치기는 고른 내 페르소나면 그 페르소나를, 아니면 살고 있는 삶의 내 배역을 고친다. 둘 다 없으면 서지 않는다 */
export function AsSlot({ mine, onOpen, onEdit, busy }: { mine: FilmMine; onOpen: () => void; onEdit: (() => void) | null; busy: boolean }) {
  return (
    <div className="asme">
      <p>들어가는 사람</p>
      <div className="asone">
        <button className="aswho" onClick={onOpen} disabled={busy} aria-haspopup="dialog" aria-label={`${mine.name}, 들어가는 사람 바꾸기`}>
          <Face id={mine.face} name={mine.name} />
          <span>
            <b>{mine.name}</b>
            <small>{asLabel(mine)}</small>
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

type Pick = { as: 'role' } | { as: 'persona'; id: string };

/** 입장권. 배역과 내 페르소나 목록. 고르면 아래쪽이 떨어져 나가며 닫힌다 */
export function AsPop({
  title,
  role,
  mine,
  personas,
  onPick,
  onManage,
  onClose,
}: {
  title: string;
  role: Persona;
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
    const same = p.as === 'role' ? mine.as === 'role' : mine.personaId === p.id;
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
          <p className="tk-kicker">들어가는 사람</p>
          <h2 className="tk-ask">누구로 들어갈까요?</h2>
          <ul className="tk-list">
            {other && (
              <li>
                <button className="on" aria-pressed="true" disabled={busy} onClick={onClose}>
                  <Face id={mine.face} name={mine.name} />
                  <span>
                    <b>{mine.name}</b>
                    <small>{asLabel(mine)}</small>
                  </span>
                  <em>지금</em>
                </button>
              </li>
            )}
            <li>
              <button className={mine.as === 'role' ? 'on' : ''} aria-pressed={mine.as === 'role'} disabled={busy} onClick={() => void pick({ as: 'role' })}>
                <Face id={role.face} name={role.name} />
                <span>
                  <b>{role.name}</b>
                  <small>배역</small>
                </span>
                {mine.as === 'role' && <em>지금</em>}
              </button>
            </li>
            {personas.map((p) => {
              const on = mine.personaId === p.id;
              return (
                <li key={p.id}>
                  <button className={on ? 'on' : ''} aria-pressed={on} disabled={busy} onClick={() => void pick({ as: 'persona', id: p.id })}>
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
