/* 내 이름. 처음 들어오면 입장권이 떠서 이름을 적게 한다.
   필름마다 이 이름으로 들어갈 수 있다(필름 정보의 「들어가는 이름」). 홈 위쪽 내 이름을 누르면 같은 입장권으로 고친다. */

import { createContext, type FormEvent, type KeyboardEvent, useContext, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { RULES } from '../shared/rules';
import { ApiFail, api, setVisitor, visitor } from './api';
import { drafts } from './drafts';
import { Close } from './icons';

/** 화면 어디서나 내 이름을 읽고, 고치는 입장권을 띄운다 */
export const MeCtx = createContext<{ name: string; rename: () => void }>({ name: '', rename: () => {} });
export const useMe = () => useContext(MeCtx);

/** 입장권의 번호. 이 기기의 표에서 뽑는다 — 같은 기기면 늘 같은 번호다 */
export const ticketNo = (): string => String(parseInt(visitor().replace(/[^0-9a-f]/g, '').slice(0, 8) || '0', 16) % 1_000_000).padStart(6, '0');

/** 오늘 날짜. 「2026. 11. 12」 */
export const today = (): string => {
  const d = new Date();
  return `${d.getFullYear()}. ${d.getMonth() + 1}. ${d.getDate()}`;
};

/** 입장권. 이름을 적고 「입장하기」를 누르면 아래쪽이 떨어져 나가며 들어간다.
    처음 들어올 때는 닫을 수 없다. 고칠 때는 닫을 수 있다(onClose) */
export function NamePop({ name, onDone, onClose }: { name: string; onDone: (name: string) => void; onClose?: () => void }) {
  const [value, setValue] = useState(name);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [leaving, setLeaving] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const [no] = useState(ticketNo);
  /** 처음 온 기기에서 「다른 기기에서 쓰던 이름이 있어요」를 눌렀다 */
  const [linking, setLinking] = useState(false);

  // 뒤의 화면이 따라 움직이지 않게 붙들어 둔다
  useEffect(() => {
    const root = document.documentElement;
    const before = root.style.overflow;
    root.style.overflow = 'hidden';
    return () => {
      root.style.overflow = before;
    };
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const next = value.trim();
    if (!next || busy) return;
    setBusy(true);
    setErr('');
    try {
      const saved = await api.setMe(next);
      setLeaving(true);
      setTimeout(() => onDone(saved.name), 480);
    } catch (x) {
      setErr(x instanceof ApiFail ? x.message : '이름을 저장하지 못했어요.');
      setBusy(false);
    }
  };

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape' && onClose && !busy) onClose();
  };

  if (linking) return <LinkPop mode="put" first onClose={() => setLinking(false)} />;

  return createPortal(
    <div className="namepop" role="dialog" aria-modal="true" aria-label="내 이름" ref={box} onKeyDown={onKey}>
      <div className="tk-wrap">
        <form className={leaving ? 'ticket out' : 'ticket'} onSubmit={submit}>
          <div className="tk-main">
            <div className="tk-top">
              <span className="tk-logo">SONA</span>
              <span className="tk-no">No. {no}</span>
              {onClose && (
                <button type="button" className="tk-x" onClick={onClose} disabled={busy} aria-label="닫기">
                  <Close />
                </button>
              )}
            </div>
            <div className="tk-strip" aria-hidden="true" />
            <p className="tk-kicker">입장권</p>
            <h2 className="tk-ask">이름을 알려 주세요.</h2>
            <label className="tk-field">
              <span>이름</span>
              <input
                value={value}
                maxLength={RULES.limits.myName}
                autoFocus
                autoComplete="nickname"
                enterKeyHint="go"
                placeholder="예) 서하"
                onChange={(e) => setValue(e.target.value)}
              />
            </label>
            <p className="tk-hint">필름마다 이 이름으로 들어갈 수 있어요.</p>
            {err && (
              <p className="tk-err" role="alert">
                {err}
              </p>
            )}
          </div>
          <div className="tk-stub">
            <button type="submit" className="tk-go" disabled={!value.trim() || busy}>
              {name ? '바꾸기' : '입장하기'}
            </button>
            <div className="tk-date">
              <span>{today()}</span>
              <span>상영관 1</span>
            </div>
          </div>
        </form>
        {!name && !onClose && (
          <button type="button" className="tk-alt" disabled={busy} onClick={() => setLinking(true)}>
            다른 기기에서 쓰던 이름이 있어요
          </button>
        )}
      </div>
    </div>,
    document.body,
  );
}

const shown = (code: string) => `${code.slice(0, 4)} ${code.slice(4)}`;

/** 다른 기기에서 이어 하기. 쓰던 기기에서는 코드를 받고(get), 새 기기에서는 넣는다(put).
    넣으면 이 기기가 코드를 받은 기기와 같은 사람이 되고, 화면을 새로 연다.
    first는 처음 온 기기의 이름 입장권에서 왔을 때다 */
export function LinkPop({ mode, first, onClose }: { mode: 'get' | 'put'; first?: boolean; onClose: () => void }) {
  const [code, setCode] = useState('');
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [leaving, setLeaving] = useState(false);
  const [no] = useState(ticketNo);

  useEffect(() => {
    const root = document.documentElement;
    const before = root.style.overflow;
    root.style.overflow = 'hidden';
    return () => {
      root.style.overflow = before;
    };
  }, []);

  // 코드를 받는다. 이 기기의 임시저장을 함께 맡긴다
  useEffect(() => {
    if (mode !== 'get') return;
    let alive = true;
    api
      .link(drafts.pack())
      .then((r) => alive && setCode(r.code))
      .catch((x) => alive && setErr(x instanceof ApiFail ? x.message : '코드를 받지 못했어요.'));
    return () => {
      alive = false;
    };
  }, [mode]);

  const typed = value.toUpperCase().replace(/[^A-Z0-9]/g, '');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (mode !== 'put' || busy || typed.length !== RULES.link.length) return;
    setBusy(true);
    setErr('');
    try {
      const r = await api.claim(typed);
      setVisitor(r.visitor);
      if (r.drafts) drafts.unpack(r.drafts);
      setLeaving(true);
      setTimeout(() => window.location.reload(), 480);
    } catch (x) {
      setErr(x instanceof ApiFail ? x.message : '이어 하지 못했어요.');
      setBusy(false);
    }
  };

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape' && !busy) onClose();
  };

  return createPortal(
    <div className="namepop" role="dialog" aria-modal="true" aria-label="다른 기기에서 이어 하기" onKeyDown={onKey}>
      <form className={leaving ? 'ticket out' : 'ticket'} onSubmit={submit}>
        <div className="tk-main">
          <div className="tk-top">
            <span className="tk-logo">SONA</span>
            <span className="tk-no">No. {no}</span>
            <button type="button" className="tk-x" onClick={onClose} disabled={busy} aria-label="닫기">
              <Close />
            </button>
          </div>
          <div className="tk-strip" aria-hidden="true" />
          {mode === 'get' ? (
            <>
              <p className="tk-kicker">이어 하기 코드</p>
              <p className="tk-code" aria-live="polite">
                {code ? shown(code) : err ? '' : '····'}
              </p>
              <p className="tk-hint">다른 기기의 입장권에서 이 코드를 넣어 주세요.</p>
              <p className="tk-hint">{RULES.link.minutes}분 안에 한 번만 쓸 수 있어요.</p>
            </>
          ) : (
            <>
              <p className="tk-kicker">이어 하기</p>
              <h2 className="tk-ask">코드를 넣어 주세요.</h2>
              <label className="tk-field">
                <span>코드</span>
                <input
                  value={value}
                  maxLength={RULES.link.length + 4}
                  autoFocus
                  autoComplete="off"
                  autoCapitalize="characters"
                  spellCheck={false}
                  enterKeyHint="go"
                  placeholder="예) K7QM 4XDZ"
                  onChange={(e) => setValue(e.target.value.toUpperCase())}
                />
              </label>
              <p className="tk-hint">{first ? '쓰던 기기의 내 페르소나에서 코드를 받을 수 있어요.' : '이 기기에서 쓰던 것도 함께 옮겨요.'}</p>
            </>
          )}
          {err && (
            <p className="tk-err" role="alert">
              {err}
            </p>
          )}
        </div>
        <div className="tk-stub">
          {mode === 'get' ? (
            <button type="button" className="tk-go" onClick={onClose}>
              닫기
            </button>
          ) : (
            <button type="submit" className="tk-go" disabled={typed.length !== RULES.link.length || busy}>
              이어 하기
            </button>
          )}
          <div className="tk-date">
            <span>{today()}</span>
            <span>상영관 1</span>
          </div>
        </div>
      </form>
    </div>,
    document.body,
  );
}
