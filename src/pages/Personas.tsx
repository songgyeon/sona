/* 내 페르소나. 플레이하는 사람이 여러 개 만들어 두고, 필름 정보에서 하나를 골라 그 사람으로 들어간다.
   이름, 사진, 소개. 맨 위에는 입장권에 적은 내 이름이 있고, 여기서 고친다. */

import { useEffect, useState } from 'react';
import { RULES } from '../../shared/rules';
import type { MyPersona } from '../../shared/types';
import { ApiFail, api } from '../api';
import { FacePick } from '../crop';
import { Back, Plus } from '../icons';
import { LinkPop, useMe } from '../me';
import { Face } from '../poster';
import { goBack } from '../router';
import { Tabs } from '../tabs';
import { Card, Field } from './Create';

const blank = { name: '', line: '', face: '' };

export function Personas({ go }: { go: (to: string) => void }) {
  const me = useMe();
  const [list, setList] = useState<MyPersona[] | null>(null);
  /** 고치는 중인 페르소나. new면 새로 만드는 중 */
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState(blank);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [asking, setAsking] = useState(false);
  /** 다른 기기에서 이어 하기: 코드 받기(get), 코드 넣기(put) */
  const [linking, setLinking] = useState<'get' | 'put' | null>(null);

  /** 필름 정보의 「고치기」로 왔으면 그 페르소나를 바로 열고, 다 고치면 그 필름으로 돌아간다 */
  const [ask] = useState(() => {
    const q = new URLSearchParams(window.location.search);
    return { edit: q.get('edit'), back: q.get('back') };
  });

  useEffect(() => {
    api
      .personas()
      .then((l) => {
        setList(l);
        const p = ask.edit ? l.find((x) => x.id === ask.edit) : undefined;
        if (p && editing === null) open(p);
      })
      .catch((e) => setErr(e instanceof ApiFail ? e.message : '페르소나를 불러오지 못했어요.'));
  }, [me.name]);

  /** 돌아갈 곳. 필름 정보에서 왔으면 그 필름으로 */
  const leave = () => goBack(go, ask.back && ask.back.startsWith('/film/') ? ask.back : '/');

  const open = (p: MyPersona | null) => {
    setEditing(p ? p.id : 'new');
    setForm(p ? { name: p.name, line: p.line, face: p.face } : blank);
    setErr('');
    setAsking(false);
  };

  const run = async (work: () => Promise<MyPersona[]>) => {
    setBusy(true);
    setErr('');
    try {
      setList(await work());
      setEditing(null);
      // 필름 정보에서 고치러 왔으면 그 필름으로 돌아간다
      if (ask.back) {
        leave();
        return;
      }
    } catch (e) {
      setErr(e instanceof ApiFail ? e.message : '저장하지 못했어요.');
    }
    setBusy(false);
  };

  const save = () => run(() => (editing === 'new' ? api.addPersona(form) : api.editPersona(editing!, form)));
  const drop = () => run(() => api.dropPersona(editing!));

  if (!list) return <p className="center">{err || '불러오는 중'}</p>;
  const full = list.length >= RULES.personas.max;

  const editor = (
    <div className="pedit">
      <div className="casthead">
        <FacePick face={form.face} label="페르소나 사진 고르기" disabled={busy} onPick={(face) => setForm((f) => ({ ...f, face }))} />
        <Field label="이름" must count={[form.name.length, 20]}>
          <input value={form.name} maxLength={20} placeholder="예) 서하" onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
        </Field>
      </div>
      <Field label="소개" count={[form.line.length, RULES.limits.persona]} hint="이 페르소나로 들어가는 필름에 고친 대로 적혀요.">
        <textarea rows={3} value={form.line} maxLength={RULES.limits.persona} placeholder="예) 낯을 가리지만 한번 친해지면 말이 많다." onChange={(e) => setForm((f) => ({ ...f, line: e.target.value }))} />
      </Field>
      {err && <p className="warn">{err}</p>}
      {asking ? (
        <div className="row">
          <span className="sub">이 페르소나를 지울까요?</span>
          <button className="textbtn" disabled={busy} onClick={() => void drop()}>
            지우기
          </button>
          <button className="textbtn" disabled={busy} onClick={() => setAsking(false)}>
            취소
          </button>
        </div>
      ) : (
        <div className="row">
          <button className="btn play" disabled={busy || !form.name.trim()} onClick={() => void save()}>
            저장
          </button>
          <button className="textbtn" disabled={busy} onClick={() => (ask.back ? leave() : setEditing(null))}>
            취소
          </button>
          {editing !== 'new' && (
            <button className="textbtn del" disabled={busy} onClick={() => setAsking(true)}>
              지우기
            </button>
          )}
        </div>
      )}
    </div>
  );

  return (
    <main className="app tabbed make">
      <div className="head">
        <button className="ico" onClick={leave} aria-label="돌아가기">
          <Back />
        </button>
        <b>내 페르소나</b>
      </div>

      <section className="body">
        <Card title="내 이름">
          <div className="myname">
            <strong>{me.name || '아직 정하지 않았어요.'}</strong>
            <button className="textbtn" onClick={me.rename}>
              바꾸기
            </button>
          </div>
        </Card>

        <Card title="페르소나" count={`${list.length} / ${RULES.personas.max}`} sub="필름 정보에서 골라 그 사람으로 들어가요.">
          <ul className="plist">
            {list.map((p) => (
              <li key={p.id}>
                {editing === p.id ? (
                  editor
                ) : (
                  <button className="castrow" onClick={() => open(p)}>
                    <Face id={p.face} name={p.name} />
                    <span>
                      <strong>{p.name}</strong>
                      {p.line && <small>{p.line}</small>}
                    </span>
                    <span className="go">고치기</span>
                  </button>
                )}
              </li>
            ))}
          </ul>
          {editing === 'new' ? (
            editor
          ) : (
            <button className="btn more wide" disabled={full} onClick={() => open(null)}>
              <Plus />
              새 페르소나
            </button>
          )}
          {full && <p className="hint">페르소나는 {RULES.personas.max}개까지 만들 수 있어요.</p>}
        </Card>

        <Card title="다른 기기" sub="코드를 넣으면 다른 기기에서도 같은 사람으로 이어져요.">
          <div className="twobtn">
            <button className="btn more" onClick={() => setLinking('get')}>
              코드 받기
            </button>
            <button className="btn more" onClick={() => setLinking('put')}>
              코드 넣기
            </button>
          </div>
        </Card>
      </section>
      {linking && <LinkPop mode={linking} onClose={() => setLinking(null)} />}
      <Tabs path="/personas" go={go} />
    </main>
  );
}
