import { type ChangeEvent, cloneElement, type ReactElement, useEffect, useId, useState } from 'react';
import { josa } from '../../shared/ko';
import { DOW_NAMES, RULES } from '../../shared/rules';
import { ApiFail, api, imgUrl, newId, uploadImage } from '../api';
import { Arrow, Close, Plus, Upload } from '../icons';
import { Face } from '../poster';

/* 필름 만들기. 디렉터가 채우는 칸이다.
   며칠 치 일정을 쓰는 자리가 아니다 — 이 사람들이 어떤 사이이고 서로를 뭐라고 부르는지를 쓴다. */

interface DraftCast {
  name: string;
  face: string;
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
  poster: string;
  stills: string[];
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
  face: '',
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
  poster: '',
  stills: [],
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
    if (raw) {
      const d = { ...blank(), ...(JSON.parse(raw) as Partial<Draft>) };
      // 예전에 쓰다 만 초안에는 그림 칸이 없다
      return { ...d, stills: d.stills ?? [], casts: d.casts.map((c) => ({ ...blankCast(), ...c })) };
    }
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
    poster: d.poster,
    stills: d.stills,
    setting: d.setting,
    startDow: d.startDow,
    startMin: toMin(d.startTime),
    opens: { feed: d.feed, ping: d.ping },
    persona: { name: d.personaName, line: d.personaLine },
    casts: d.casts.map((c) => ({
      name: c.name,
      face: c.face,
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

type Step = 'plan' | 'cast' | 'world' | 'open' | 'release';
const STEPS: [Step, string][] = [
  ['plan', '기획'],
  ['cast', '캐스팅'],
  ['world', '세계'],
  ['open', '오프닝'],
  ['release', '공개'],
];

export function Create({ go }: { go: (to: string) => void }) {
  const [d, setD] = useState<Draft>(loadDraft);
  const [step, setStep] = useState<Step>('plan');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [toast, setToast] = useState('');

  const keep = (): boolean => {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(d));
      return true;
    } catch {
      return false;
    }
  };

  // 쓰다가 새로 고쳐도 남게 한다
  useEffect(() => {
    keep();
  }, [d]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(''), 1800);
    return () => clearTimeout(t);
  }, [toast]);

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));
  const setCast = (i: number, k: keyof DraftCast, v: string) =>
    setD((x) => ({ ...x, casts: x.casts.map((c, j) => (j === i ? { ...c, [k]: v } : c)) }));
  const setTie = (pair: string, k: 'relation' | 'calls', v: string) =>
    setD((x) => ({ ...x, ties: { ...x.ties, [pair]: { relation: '', calls: '', ...x.ties[pair], [k]: v } } }));
  const addCast = () => setD((x) => ({ ...x, casts: [...x.casts, blankCast()] }));
  const removeCast = (i: number) => setD((x) => ({ ...x, casts: x.casts.filter((_, j) => j !== i), ties: {}, room: 0 }));

  /** 그림을 골라 올리고, 올린 그림을 가리키는 값을 받는다 */
  const pick = async (e: ChangeEvent<HTMLInputElement>, max: number, done: (id: string) => void) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    setErr('');
    try {
      done(await uploadImage(file, max));
    } catch (x) {
      setErr(x instanceof ApiFail ? x.message : '그림을 올리지 못했어.');
    }
    setBusy(false);
  };

  const release = async (thenEnter: boolean) => {
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
        go(`/film/${id}`);
      }
    } catch (x) {
      setErr(x instanceof ApiFail ? x.message : '개봉하지 못했어.');
      setBusy(false);
    }
  };

  const names = d.casts.map((c, i) => c.name.trim() || `캐스트 ${i + 1}`);
  const pairs = d.casts.flatMap((_, a) => d.casts.map((__, b) => [a, b] as const)).filter(([a, b]) => a !== b);
  const me = d.personaName.trim() || '나';
  /** 꼭 채워야 하는 칸이 빈 곳 */
  const missing: Record<Step, boolean> = {
    plan: !d.title.trim(),
    cast: !d.personaName.trim() || d.casts.some((c) => !c.name.trim()),
    world: false,
    open: false,
    release: false,
  };
  const ready = !Object.values(missing).some(Boolean);
  const at = STEPS.findIndex(([s]) => s === step);
  const next = STEPS[at + 1];

  return (
    <main className="app make">
      <div className="head">
        <button className="ico" onClick={() => go('/')} aria-label="닫기">
          <Close />
        </button>
        <b>필름 만들기</b>
        <div className="right">
          <button className="mini keep" onClick={() => setToast(keep() ? '이 기기에 저장했어' : '저장하지 못했어')}>
            임시저장
          </button>
          <button className="mini open" disabled={busy || !ready} onClick={() => release(false)}>
            개봉
          </button>
        </div>
      </div>
      <div className="slate" />

      <nav className="steps" aria-label="만드는 순서">
        {STEPS.map(([s, label]) => (
          <button key={s} className={s === step ? 'step on' : 'step'} onClick={() => setStep(s)}>
            {label}
            {missing[s] && <i aria-label="채울 칸이 남았어" />}
          </button>
        ))}
      </nav>

      <section className="body">
        {step === 'plan' && (
          <>
            <p className="label">포스터</p>
            <div className="posterrow">
              <div className={d.poster ? 'pic has grain' : 'pic'}>
                {d.poster ? <img src={imgUrl(d.poster)} alt="" /> : <div className="blank" />}
                <b>{d.title.trim() || '제목'}</b>
              </div>
              <div className="side">
                <p>홈과 필름 정보의 맨 위에 걸려. 세로로 긴 그림이 잘 맞아.</p>
                <label className="btn more pick">
                  <Upload />
                  {d.poster ? '바꾸기' : '올리기'}
                  <input type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={(e) => pick(e, 1440, (id) => set('poster', id))} />
                </label>
                {d.poster && (
                  <button className="textbtn" onClick={() => set('poster', '')}>
                    그림 빼기
                  </button>
                )}
              </div>
            </div>

            <Field label="제목" must count={[d.title.length, RULES.limits.title]}>
              <input value={d.title} maxLength={RULES.limits.title} onChange={(e) => set('title', e.target.value)} />
            </Field>
            <Field label="한 줄" count={[d.logline.length, RULES.limits.logline]} hint="포스터에서 제목 아래에 놓이는 문장이야.">
              <input className="serif" value={d.logline} maxLength={RULES.limits.logline} onChange={(e) => set('logline', e.target.value)} />
            </Field>
          </>
        )}

        {step === 'cast' && (
          <>
            <p className="label">내 배역</p>
            <Field label="이름" must>
              <input value={d.personaName} maxLength={20} onChange={(e) => set('personaName', e.target.value)} />
            </Field>
            <Field label="어떤 사람" hint="예) 한 학기 만에 돌아온 사람">
              <input value={d.personaLine} maxLength={RULES.limits.short} onChange={(e) => set('personaLine', e.target.value)} />
            </Field>

            {d.casts.map((c, i) => (
              <div className="castcard" key={i}>
                <div className="casthead">
                  <Face id={c.face} name={c.name || `${i + 1}`} />
                  <div className="grow">
                    <label className="sr" htmlFor={`cast-name-${i}`}>
                      캐스트 {i + 1}의 이름
                    </label>
                    <input id={`cast-name-${i}`} value={c.name} maxLength={20} placeholder={`캐스트 ${i + 1}의 이름`} onChange={(e) => setCast(i, 'name', e.target.value)} />
                  </div>
                  <label className="mini pick">
                    {c.face ? '사진 바꾸기' : '사진'}
                    <input type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={(e) => pick(e, 640, (id) => setCast(i, 'face', id))} />
                  </label>
                </div>

                <Field label={`${me}에게 누구인가`}>
                  <input value={c.role} maxLength={RULES.limits.short} onChange={(e) => setCast(i, 'role', e.target.value)} />
                </Field>
                <div className="two">
                  <Field label={`${josa(me, '을', '를')} 부르는 말`}>
                    <input value={c.callsUser} maxLength={20} onChange={(e) => setCast(i, 'callsUser', e.target.value)} />
                  </Field>
                  <Field label="낮에 있는 곳">
                    <input value={c.dayPlace} maxLength={40} onChange={(e) => setCast(i, 'dayPlace', e.target.value)} />
                  </Field>
                </div>
                <Field label="불리는 이름들" hint="주변 사람이 이 사람을 가리킬 때 쓰는 말을 쉼표로. 성 뺀 이름, 직함, 별명.">
                  <input value={c.aliases} onChange={(e) => setCast(i, 'aliases', e.target.value)} />
                </Field>
                <Field label="말투" hint="말높이와 말버릇을 한 줄로.">
                  <input value={c.speech} maxLength={RULES.limits.short} onChange={(e) => setCast(i, 'speech', e.target.value)} />
                </Field>
                <Field label="예시 대사" hint="한 줄에 하나씩, 세 줄까지. 설명보다 예시가 말투를 잘 옮겨.">
                  <textarea value={c.samples} rows={3} onChange={(e) => setCast(i, 'samples', e.target.value)} />
                </Field>
                <div className="two">
                  <Field label="자는 시간">
                    <input type="time" value={c.sleepFrom} onChange={(e) => setCast(i, 'sleepFrom', e.target.value)} />
                  </Field>
                  <Field label="일어나는 시간">
                    <input type="time" value={c.sleepTo} onChange={(e) => setCast(i, 'sleepTo', e.target.value)} />
                  </Field>
                </div>
                {d.casts.length > 1 && (
                  <p className="hint">
                    <button className="textbtn" onClick={() => removeCast(i)}>
                      {names[i]} 빼기
                    </button>
                  </p>
                )}
              </div>
            ))}

            {d.casts.length < RULES.limits.casts && (
              <div className="addrow">
                <button className="btn more" onClick={addCast}>
                  <Plus />
                  캐스트 더하기
                </button>
              </div>
            )}

            {pairs.length > 0 && (
              <div className="castcard">
                <p className="label">캐스트끼리</p>
                <p className="hint">서로 아는 사이라면 적어 줘. 같은 사람도 부르는 쪽에 따라 이름이 달라서 방향마다 따로 적어.</p>
                {pairs.map(([a, b]) => {
                  const pair = `${a}>${b}`;
                  const t = d.ties[pair] ?? { relation: '', calls: '' };
                  return (
                    <div className="two" key={pair}>
                      <Field label={`${names[a]} → ${names[b]} · 어떤 사이`}>
                        <input value={t.relation} maxLength={RULES.limits.short} onChange={(e) => setTie(pair, 'relation', e.target.value)} />
                      </Field>
                      <Field label={`${josa(names[a]!, '이', '가')} ${josa(names[b]!, '을', '를')} 부르는 말`}>
                        <input value={t.calls} maxLength={20} onChange={(e) => setTie(pair, 'calls', e.target.value)} />
                      </Field>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}

        {step === 'world' && (
          <>
            <Field label="배경" count={[d.setting.length, RULES.limits.setting]} hint="이 세계가 어떤 곳인지 두세 문장.">
              <textarea className="serif" value={d.setting} maxLength={RULES.limits.setting} rows={5} onChange={(e) => set('setting', e.target.value)} />
            </Field>
            <div className="two">
              <Field label="시작하는 요일">
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
            <div className="checks">
              <label className="check">
                <input type="checkbox" checked={d.feed} onChange={(e) => set('feed', e.target.checked)} />
                캐스트의 프로필에 피드를 연다
              </label>
              <label className="check">
                <input type="checkbox" checked={d.ping} onChange={(e) => set('ping', e.target.checked)} />
                캐스트가 먼저 연락할 수 있다
              </label>
            </div>
          </>
        )}

        {step === 'open' && (
          <>
            <p className="label">
              컷<span>{d.stills.length} / {RULES.limits.stills}</span>
            </p>
            <div className="stillgrid">
              {d.stills.map((id) => (
                <div className="tile grain" key={id}>
                  <img src={imgUrl(id)} alt="" />
                  <button onClick={() => set('stills', d.stills.filter((s) => s !== id))} aria-label="이 컷 빼기">
                    <Close />
                  </button>
                </div>
              ))}
              {d.stills.length < RULES.limits.stills && (
                <label className="tile add pick">
                  <Plus />
                  <span className="sr">컷 올리기</span>
                  <input type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={(e) => pick(e, 1440, (id) => set('stills', [...d.stills, id]))} />
                </label>
              )}
            </div>
            <p className="hint">첫 컷이 필름 정보 맨 위와 재생 화면에 걸려. 가로로 긴 그림이 잘 맞아.</p>

            <Field label="장소">
              <input value={d.place} maxLength={40} onChange={(e) => set('place', e.target.value)} />
            </Field>
            <Field label="첫 장면" count={[d.situation.length, 200]} hint="들어갔을 때 눈앞에 있는 장면.">
              <textarea className="serif" value={d.situation} maxLength={200} rows={5} onChange={(e) => set('situation', e.target.value)} />
            </Field>
            <div className="two">
              {d.casts.length > 1 && (
                <Field label="누구와 시작하나">
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
              <Field label="첫 대사" hint="비워 두면 대사 모델이 써.">
                <input value={d.firstLine} maxLength={200} onChange={(e) => set('firstLine', e.target.value)} />
              </Field>
            )}
          </>
        )}

        {step === 'release' && (
          <>
            <p className="label">공개</p>
            <p className="hint">지금은 만든 사람에게만 보여. 내 필름에 걸리고, 바로 들어가 살 수 있어.</p>
            {!ready && <p className="hint">점이 찍힌 탭에 꼭 채워야 하는 칸이 남아 있어.</p>}
          </>
        )}

        {err && <p className="warn" style={{ marginTop: 22 }}>{err}</p>}

        <div className="next">
          {next ? (
            <button className="btn more" onClick={() => setStep(next[0])}>
              다음 · {next[1]}
              <Arrow />
            </button>
          ) : (
            <>
              <button className="btn play" disabled={busy || !ready} onClick={() => release(true)}>
                개봉하고 바로 들어가기
              </button>
              <button className="btn more" disabled={busy || !ready} onClick={() => release(false)}>
                개봉만 하기
              </button>
              <button className="textbtn" disabled={busy} onClick={() => setD(blank())}>
                칸 비우기
              </button>
            </>
          )}
        </div>
      </section>

      {toast && <p className="toast" role="status">{toast}</p>}
    </main>
  );
}

/** 칸 하나. 이름표는 짧게 두고, 도움말은 따로 달아 읽어 주는 순서를 지킨다 */
function Field({
  label,
  hint,
  must,
  count,
  children,
}: {
  label: string;
  hint?: string;
  must?: boolean;
  count?: [number, number];
  children: ReactElement<Record<string, unknown>>;
}) {
  const id = useId();
  return (
    <div className="field">
      <label className="label" htmlFor={id}>
        {label}
        {must && <em>*</em>}
        {count && (
          <span>
            {count[0]} / {count[1]}
          </span>
        )}
      </label>
      {cloneElement(children, { id, 'aria-describedby': hint ? `${id}-hint` : undefined })}
      {hint && (
        <p className="hint" id={`${id}-hint`}>
          {hint}
        </p>
      )}
    </div>
  );
}
