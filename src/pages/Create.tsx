import { cloneElement, type FormEvent, type ReactElement, useEffect, useId, useState } from 'react';
import { josa } from '../../shared/ko';
import { DOW_NAMES, RULES } from '../../shared/rules';
import { ApiFail, api, newId } from '../api';

/* 필름 만들기. 디렉터가 채우는 칸이다.
   며칠 치 일정을 쓰는 자리가 아니다 — 이 사람들이 어떤 사이이고 서로를 뭐라고 부르는지를 쓴다. */

interface DraftCast {
  name: string;
  aliases: string;
  role: string;
  callsUser: string;
  speech: string;
  samples: string;
  sleepFrom: string;
  sleepTo: string;
  dayPlace: string;
}

interface Draft {
  title: string;
  logline: string;
  setting: string;
  startDow: number;
  startTime: string;
  feed: boolean;
  ping: boolean;
  personaName: string;
  personaLine: string;
  casts: DraftCast[];
  /** 「0>1」 = 첫째 캐스트가 둘째 캐스트를 */
  ties: Record<string, { relation: string; calls: string }>;
  place: string;
  situation: string;
  room: number;
  speaker: 'persona' | 'cast';
  firstLine: string;
}

const blankCast = (): DraftCast => ({
  name: '',
  aliases: '',
  role: '',
  callsUser: '',
  speech: '',
  samples: '',
  sleepFrom: '00:00',
  sleepTo: '07:00',
  dayPlace: '',
});

const blank = (): Draft => ({
  title: '',
  logline: '',
  setting: '',
  startDow: 5,
  startTime: '16:00',
  feed: true,
  ping: true,
  personaName: '',
  personaLine: '',
  casts: [blankCast()],
  ties: {},
  place: '',
  situation: '',
  room: 0,
  speaker: 'cast',
  firstLine: '',
});

const DRAFT_KEY = 'sona.draft';

function loadDraft(): Draft {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (raw) return { ...blank(), ...(JSON.parse(raw) as Partial<Draft>) };
  } catch {
    /* 저장이 막혀 있으면 빈 칸에서 시작한다 */
  }
  return blank();
}

const toMin = (hhmm: string): number => {
  const [h, m] = hhmm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

const split = (s: string, by: RegExp): string[] =>
  s
    .split(by)
    .map((x) => x.trim())
    .filter((x) => x.length > 0);

/** 화면의 칸을 서버가 받는 필름 모양으로 바꾼다 */
export function toFilm(d: Draft): unknown {
  const key = (i: number) => `c${i + 1}`;
  return {
    title: d.title,
    logline: d.logline,
    setting: d.setting,
    startDow: d.startDow,
    startMin: toMin(d.startTime),
    opens: { feed: d.feed, ping: d.ping },
    persona: { name: d.personaName, line: d.personaLine },
    casts: d.casts.map((c) => ({
      name: c.name,
      aliases: split(c.aliases, /[,，\n]/),
      role: c.role,
      callsUser: c.callsUser,
      speech: c.speech,
      samples: split(c.samples, /\n/).slice(0, 3),
      sleepFrom: toMin(c.sleepFrom),
      sleepTo: toMin(c.sleepTo),
      dayPlace: c.dayPlace,
    })),
    ties: Object.entries(d.ties)
      .map(([pair, t]) => {
        const [from, to] = pair.split('>').map(Number);
        return { from: key(from ?? 0), to: key(to ?? 0), relation: t.relation, calls: t.calls, ok: (from ?? 0) < d.casts.length && (to ?? 0) < d.casts.length };
      })
      .filter((t) => t.ok && (t.relation.trim() || t.calls.trim()))
      .map(({ ok: _ok, ...t }) => t),
    firstScene: {
      place: d.place,
      situation: d.situation,
      room: key(Math.min(d.room, d.casts.length - 1)),
      speaker: d.speaker,
      firstLine: d.speaker === 'cast' ? d.firstLine : '',
    },
  };
}

export function Create({ go }: { go: (to: string) => void }) {
  const [d, setD] = useState<Draft>(loadDraft);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  // 쓰다가 새로 고쳐도 남게 한다
  useEffect(() => {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(d));
    } catch {
      /* 저장이 막혀 있으면 이 탭에서만 기억한다 */
    }
  }, [d]);

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));
  const setCast = (i: number, k: keyof DraftCast, v: string) =>
    setD((x) => ({ ...x, casts: x.casts.map((c, j) => (j === i ? { ...c, [k]: v } : c)) }));
  const setTie = (pair: string, k: 'relation' | 'calls', v: string) =>
    setD((x) => ({ ...x, ties: { ...x.ties, [pair]: { relation: '', calls: '', ...x.ties[pair], [k]: v } } }));
  const addCast = () => setD((x) => ({ ...x, casts: [...x.casts, blankCast()] }));
  const removeCast = (i: number) =>
    setD((x) => ({ ...x, casts: x.casts.filter((_, j) => j !== i), ties: {}, room: 0 }));

  const save = async (thenEnter: boolean, e?: FormEvent) => {
    e?.preventDefault();
    setBusy(true);
    setErr('');
    try {
      const { id } = await api.createFilm(toFilm(d));
      try {
        localStorage.removeItem(DRAFT_KEY);
      } catch {
        /* 무시 */
      }
      if (thenEnter) {
        const view = await api.enter(id, newId());
        go(`/play/${view.id}`);
      } else {
        go('/');
      }
    } catch (x) {
      setErr(x instanceof ApiFail ? x.message : '저장하지 못했어.');
      setBusy(false);
    }
  };

  const names = d.casts.map((c, i) => c.name.trim() || `캐스트 ${i + 1}`);
  const pairs = d.casts.flatMap((_, a) => d.casts.map((__, b) => [a, b] as const)).filter(([a, b]) => a !== b);
  const me = d.personaName.trim() || '나';

  return (
    <main className="create">
      <header className="top">
        <button className="ghost" onClick={() => go('/')} aria-label="필름 목록으로">
          ←
        </button>
        <h1>필름 만들기</h1>
      </header>

      <form onSubmit={(e) => save(false, e)}>
        <fieldset>
          <legend>필름</legend>
          <Field label="제목">
            <input value={d.title} maxLength={RULES.limits.title} onChange={(e) => set('title', e.target.value)} required />
          </Field>
          <Field label="한 줄 소개">
            <input value={d.logline} maxLength={RULES.limits.logline} onChange={(e) => set('logline', e.target.value)} />
          </Field>
          <Field label="배경" hint="이 세계가 어떤 곳인지 두세 문장.">
            <textarea value={d.setting} maxLength={RULES.limits.setting} rows={3} onChange={(e) => set('setting', e.target.value)} />
          </Field>
          <div className="row">
            <Field label="이야기가 시작되는 요일">
              <select value={d.startDow} onChange={(e) => set('startDow', Number(e.target.value))}>
                {DOW_NAMES.map((n, i) => (
                  <option key={n} value={i}>
                    {n}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="시각">
              <input type="time" value={d.startTime} onChange={(e) => set('startTime', e.target.value)} />
            </Field>
          </div>
          <div className="row checks">
            <label className="check">
              <input type="checkbox" checked={d.feed} onChange={(e) => set('feed', e.target.checked)} />
              일상 피드를 연다
            </label>
            <label className="check">
              <input type="checkbox" checked={d.ping} onChange={(e) => set('ping', e.target.checked)} />
              먼저 오는 연락을 연다
            </label>
          </div>
        </fieldset>

        <fieldset>
          <legend>내가 맡을 인물</legend>
          <Field label="이름">
            <input value={d.personaName} maxLength={20} onChange={(e) => set('personaName', e.target.value)} required />
          </Field>
          <Field label="이 필름에서 나는…" hint="예) 한 학기 만에 돌아온 사람">
            <input value={d.personaLine} maxLength={RULES.limits.short} onChange={(e) => set('personaLine', e.target.value)} />
          </Field>
        </fieldset>

        {d.casts.map((c, i) => (
          <fieldset key={i}>
            <legend>
              캐스트 {i + 1}
              {d.casts.length > 1 && (
                <button type="button" className="ghost" onClick={() => removeCast(i)}>
                  빼기
                </button>
              )}
            </legend>
            <Field label="이름">
              <input value={c.name} maxLength={20} onChange={(e) => setCast(i, 'name', e.target.value)} required />
            </Field>
            <Field
              label="불리는 이름들"
              hint={`${josa(me, '이나', '나')} 주변 사람이 이 사람을 가리킬 때 쓰는 말을 쉼표로 다 적어 줘. 성 뺀 이름, 직함, 별명. 「그 사람 얘기 하지 마」라고 선을 그었을 때 다른 이름으로 꺼내도 같은 사람으로 알아보는 데 써.`}
            >
              <input value={c.aliases} onChange={(e) => setCast(i, 'aliases', e.target.value)} placeholder="예) 보건 선생님, 재언 쌤" />
            </Field>
            <Field label={`${me}에게 누구인가`}>
              <input value={c.role} maxLength={RULES.limits.short} onChange={(e) => setCast(i, 'role', e.target.value)} />
            </Field>
            <div className="row">
              <Field label={`${josa(me, '을', '를')} 부르는 말`}>
                <input value={c.callsUser} maxLength={20} onChange={(e) => setCast(i, 'callsUser', e.target.value)} />
              </Field>
              <Field label="낮에 주로 있는 곳">
                <input value={c.dayPlace} maxLength={40} onChange={(e) => setCast(i, 'dayPlace', e.target.value)} />
              </Field>
            </div>
            <Field label="말투" hint="말높이와 말버릇을 한 줄로.">
              <input value={c.speech} maxLength={RULES.limits.short} onChange={(e) => setCast(i, 'speech', e.target.value)} />
            </Field>
            <Field label="예시 대사" hint="한 줄에 하나씩, 세 줄까지. 설명보다 예시가 말투를 잘 옮겨.">
              <textarea value={c.samples} rows={3} onChange={(e) => setCast(i, 'samples', e.target.value)} />
            </Field>
            <div className="row">
              <Field label="자는 시간">
                <input type="time" value={c.sleepFrom} onChange={(e) => setCast(i, 'sleepFrom', e.target.value)} />
              </Field>
              <Field label="일어나는 시간">
                <input type="time" value={c.sleepTo} onChange={(e) => setCast(i, 'sleepTo', e.target.value)} />
              </Field>
            </div>
          </fieldset>
        ))}

        {d.casts.length < RULES.limits.casts && (
          <button type="button" className="ghost add" onClick={addCast}>
            + 캐스트 더하기
          </button>
        )}

        {pairs.length > 0 && (
          <fieldset>
            <legend>캐스트끼리</legend>
            <p className="muted">
              서로 아는 사이라면 적어 줘. 같은 사람도 부르는 쪽에 따라 이름이 달라. 그래서 방향마다 따로 적어.
            </p>
            {pairs.map(([a, b]) => {
              const pair = `${a}>${b}`;
              const t = d.ties[pair] ?? { relation: '', calls: '' };
              return (
                <div className="row" key={pair}>
                  <Field label={`${names[a]} → ${names[b]} · 어떤 사이`}>
                    <input value={t.relation} maxLength={RULES.limits.short} onChange={(e) => setTie(pair, 'relation', e.target.value)} />
                  </Field>
                  <Field label={`${josa(names[a]!, '이', '가')} ${josa(names[b]!, '을', '를')} 부르는 말`}>
                    <input value={t.calls} maxLength={20} onChange={(e) => setTie(pair, 'calls', e.target.value)} />
                  </Field>
                </div>
              );
            })}
          </fieldset>
        )}

        <fieldset>
          <legend>첫 장면</legend>
          <Field label="장소">
            <input value={d.place} maxLength={40} onChange={(e) => set('place', e.target.value)} />
          </Field>
          <Field label="상황">
            <textarea value={d.situation} maxLength={200} rows={2} onChange={(e) => set('situation', e.target.value)} />
          </Field>
          <div className="row">
            {d.casts.length > 1 && (
              <Field label="누구와의 대화로 시작하나">
                <select value={Math.min(d.room, d.casts.length - 1)} onChange={(e) => set('room', Number(e.target.value))}>
                  {names.map((n, i) => (
                    <option key={i} value={i}>
                      {n}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            <Field label="누가 먼저 말하나">
              <select value={d.speaker} onChange={(e) => set('speaker', e.target.value as Draft['speaker'])}>
                <option value="cast">캐스트</option>
                <option value="persona">{me}</option>
              </select>
            </Field>
          </div>
          {d.speaker === 'cast' && (
            <Field label="첫 마디" hint="비워 두면 모델이 써.">
              <input value={d.firstLine} maxLength={200} onChange={(e) => set('firstLine', e.target.value)} />
            </Field>
          )}
        </fieldset>

        {err && <p className="warn">{err}</p>}

        <div className="actions">
          <button type="submit" disabled={busy}>
            저장하기
          </button>
          <button type="button" disabled={busy} onClick={() => save(true)}>
            저장하고 바로 들어가기
          </button>
          <button type="button" className="ghost" disabled={busy} onClick={() => setD(blank())}>
            칸 비우기
          </button>
        </div>
      </form>
    </main>
  );
}

/** 칸 하나. 이름표는 짧게 두고, 도움말은 따로 달아 읽어 주는 순서를 지킨다 */
function Field({ label, hint, children }: { label: string; hint?: string; children: ReactElement<Record<string, unknown>> }) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {cloneElement(children, { id, 'aria-describedby': hint ? `${id}-hint` : undefined })}
      {hint && <small id={`${id}-hint`}>{hint}</small>}
    </div>
  );
}
