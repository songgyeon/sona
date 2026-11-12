/* 장면 저장 시트. 재생 화면 위의 책갈피를 누르면 아래에서 올라온다.
   지금 장면을 저장하고, 저장한 장면에서 다시 산다. 돌아가면 그 뒤의 이야기는 지워지고,
   돌아가기 직전의 장면은 「돌아가기 전」 자리에 저절로 남는다(서버가 한다). */

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { type Clock, formatWorld } from '../shared/clock';
import { RULES } from '../shared/rules';
import type { PlayView, SaveView } from '../shared/types';
import { ApiFail, api } from './api';
import { Close } from './icons';

/** 저장한 때. 「11월 12일 오후 3:10」 */
const savedWhen = (at: number): string => new Date(at).toLocaleString('ko-KR', { month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' });

export function SaveSheet({
  playId,
  clock,
  locked,
  onClose,
  onLoaded,
}: {
  playId: string;
  clock: Clock;
  /** 대사를 기다리는 중이거나 시간을 넘기는 중. 그동안은 저장하지도 돌아가지도 않는다 */
  locked: boolean;
  onClose: () => void;
  onLoaded: (view: PlayView) => void;
}) {
  const [list, setList] = useState<SaveView[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState('');
  /** 돌아갈지 묻고 있는 장면, 지울지 묻고 있는 장면 */
  const [asking, setAsking] = useState<{ id: string; what: 'load' | 'drop' } | null>(null);

  useEffect(() => {
    api
      .saves(playId)
      .then(setList)
      .catch((e) => setErr(e instanceof ApiFail ? e.message : '저장한 장면을 불러오지 못했어요.'));
  }, [playId]);

  // 뒤의 화면이 따라 움직이지 않게 붙들어 둔다
  useEffect(() => {
    const root = document.documentElement;
    const before = root.style.overflow;
    root.style.overflow = 'hidden';
    return () => {
      root.style.overflow = before;
    };
  }, []);

  const run = async <T,>(work: () => Promise<T>, then: (r: T) => void, fail: string) => {
    setBusy(true);
    setErr('');
    setDone('');
    try {
      then(await work());
    } catch (e) {
      setErr(e instanceof ApiFail ? e.message : fail);
    }
    setBusy(false);
  };

  const save = () =>
    run(
      () => api.makeSave(playId),
      (next) => {
        setList(next);
        setDone('지금 장면을 저장했어요.');
      },
      '저장하지 못했어요.',
    );
  const load = (id: string) =>
    run(
      () => api.loadSave(playId, id),
      (view) => {
        setAsking(null);
        onLoaded(view);
      },
      '그 장면으로 돌아가지 못했어요.',
    );
  const drop = (id: string) =>
    run(
      () => api.dropSave(playId, id),
      (next) => {
        setAsking(null);
        setList(next);
      },
      '지우지 못했어요.',
    );

  const kept = (list ?? []).filter((s) => !s.auto).length;

  return createPortal(
    <>
      <div className="savedim" onClick={busy ? undefined : onClose} />
      <section className="savesheet" role="dialog" aria-modal="true" aria-label="장면 저장">
        <div className="grab" />
        <h3>
          장면 저장
          <span>
            {kept} / {RULES.saves.max}
          </span>
          <button className="ico" onClick={onClose} disabled={busy} aria-label="닫기">
            <Close />
          </button>
        </h3>
        <button className="btn play wide" disabled={busy || locked} onClick={() => void save()}>
          지금 장면 저장하기
        </button>
        {locked && <p className="note">대사를 다 받은 뒤에 저장할 수 있어요.</p>}
        {err && (
          <p className="warn" role="alert">
            {err}
          </p>
        )}
        {done && (
          <p className="note" role="status">
            {done}
          </p>
        )}

        <p className="k">저장한 장면</p>
        {list === null && !err && <p className="note">불러오는 중</p>}
        {list !== null && list.length === 0 && <p className="note">아직 저장한 장면이 없어요.</p>}
        <ul className="savelist">
          {(list ?? []).map((s) => (
            <li key={s.id} className={s.auto ? 'auto' : ''}>
              <div className="what">
                <b>
                  {formatWorld(clock, s.at)}
                  {s.place && ` · ${s.place}`}
                </b>
                <p>{s.line ? `「${s.line}」` : '처음 자리'}</p>
                <small>
                  {s.auto && '돌아가기 전 · '}
                  {savedWhen(s.savedAt)}
                </small>
              </div>
              {asking?.id === s.id ? (
                <div className="ask">
                  <p>{asking.what === 'load' ? '지금 장면은 남겨 두고 이 장면으로 돌아갈까요?' : '이 장면을 지울까요?'}</p>
                  <div>
                    <button className="btn play" disabled={busy} onClick={() => void (asking.what === 'load' ? load(s.id) : drop(s.id))}>
                      {asking.what === 'load' ? '돌아가기' : '지우기'}
                    </button>
                    <button className="textbtn" disabled={busy} onClick={() => setAsking(null)}>
                      취소
                    </button>
                  </div>
                </div>
              ) : (
                <div className="acts">
                  <button className="again" disabled={busy || locked} onClick={() => setAsking({ id: s.id, what: 'load' })}>
                    여기서 다시 살기
                  </button>
                  <button className="textbtn" disabled={busy} onClick={() => setAsking({ id: s.id, what: 'drop' })} aria-label="이 장면 지우기">
                    지우기
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
        <div className="safe" />
      </section>
    </>,
    document.body,
  );
}
