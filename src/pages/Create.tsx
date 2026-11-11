import { type ChangeEvent, cloneElement, type ReactElement, type ReactNode, useEffect, useId, useState } from 'react';
import { josa } from '../../shared/ko';
import { DOW_NAMES, RULES } from '../../shared/rules';
import { ApiFail, api, imgUrl, newId, uploadImage } from '../api';
import { Arrow, Close, Down, Plus, Upload } from '../icons';

/* 필름 만들기. 디렉터가 채우는 칸이다.
   며칠 치 일정을 쓰는 자리가 아니다 — 이 사람들이 어떤 사이이고 서로를 뭐라고 부르는지를 쓴다.
   칸마다 무엇을 쓰는지 알려 주고 예를 든다. */

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
/** 탭. 별표가 붙은 탭에는 꼭 채워야 하는 칸이 있다 */
const STEPS: { id: Step; label: string; must: boolean }[] = [
  { id: 'plan', label: '기획', must: true },
  { id: 'cast', label: '캐스팅', must: true },
  { id: 'world', label: '세계', must: false },
  { id: 'open', label: '오프닝', must: false },
  { id: 'release', label: '개봉', must: false },
];

const PICTURES = 'image/jpeg,image/png,image/webp';

export function Create({ go }: { go: (to: string) => void }) {
  const [d, setD] = useState<Draft>(loadDraft);
  const [step, setStep] = useState<Step>('plan');
  const [more, setMore] = useState<Record<number, boolean>>({});
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

  const move = (to: Step) => {
    setStep(to);
    setErr('');
    window.scrollTo(0, 0);
  };

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));
  const setCast = (i: number, k: keyof DraftCast, v: string) =>
    setD((x) => ({ ...x, casts: x.casts.map((c, j) => (j === i ? { ...c, [k]: v } : c)) }));
  const setTie = (pair: string, k: 'relation' | 'calls', v: string) =>
    setD((x) => ({ ...x, ties: { ...x.ties, [pair]: { relation: '', calls: '', ...x.ties[pair], [k]: v } } }));
  const addCast = () => setD((x) => ({ ...x, casts: [...x.casts, blankCast()] }));
  const removeCast = (i: number) => {
    setD((x) => ({ ...x, casts: x.casts.filter((_, j) => j !== i), ties: {}, room: 0 }));
    setMore({});
  };

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
      setErr(x instanceof ApiFail ? x.message : '그림을 올리지 못했어요.');
    }
    setBusy(false);
  };

  const names = d.casts.map((c, i) => c.name.trim() || `캐스트 ${i + 1}`);
  const pairs = d.casts.flatMap((_, a) => d.casts.map((__, b) => [a, b] as const)).filter(([a, b]) => a !== b);
  const me = d.personaName.trim() || '나';
  /** 첫 장면을 함께 여는 캐스트. 아직 이름이 없으면 「캐스트」라고 부른다 */
  const opener = d.casts[Math.min(d.room, d.casts.length - 1)]?.name.trim() || '캐스트';

  /** 개봉하려면 채워야 하는 칸 */
  const todo: { step: Step; label: string; done: boolean }[] = [
    { step: 'plan', label: '제목', done: d.title.trim().length > 0 },
    { step: 'cast', label: '내 배역의 이름', done: d.personaName.trim().length > 0 },
    { step: 'cast', label: d.casts.length > 1 ? '캐스트 모두의 이름' : '캐스트의 이름', done: d.casts.every((c) => c.name.trim().length > 0) },
  ];
  const ready = todo.every((t) => t.done);
  const left = (s: Step) => todo.some((t) => t.step === s && !t.done);

  const release = async (thenEnter: boolean) => {
    if (!ready) {
      move('release');
      setToast('필수 항목이 남았어요');
      return;
    }
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
      setErr(x instanceof ApiFail ? x.message : '개봉하지 못했어요.');
      setBusy(false);
    }
  };

  const at = STEPS.findIndex((s) => s.id === step);
  const next = STEPS[at + 1];

  return (
    <main className="app make">
      <div className="head">
        <button className="ico" onClick={() => go('/')} aria-label="닫기">
          <Close />
        </button>
        <b>필름 만들기</b>
        <div className="right">
          <button className="mini keep" onClick={() => setToast(keep() ? '이 기기에 저장했어요' : '저장하지 못했어요')}>
            임시저장
          </button>
          <button className="mini open" disabled={busy} onClick={() => release(false)}>
            개봉
          </button>
        </div>
      </div>
      <div className="slate" />

      <nav className="steps" aria-label="만드는 순서">
        {STEPS.map((s) => (
          <button key={s.id} className={s.id === step ? 'step on' : 'step'} onClick={() => move(s.id)}>
            {s.must && <sup aria-hidden="true">*</sup>}
            {s.label}
            {left(s.id) && (
              <span className="todo" aria-label="필수 항목이 남았어요">
                !
              </span>
            )}
          </button>
        ))}
      </nav>

      <section className="body">
        {step === 'plan' && (
          <>
            <p className="lead">필름의 제목과 포스터를 정해 주세요.</p>

            <Card title="포스터">
              <div className="posterrow">
                <label className={d.poster ? 'drop poster has' : 'drop poster'}>
                  {d.poster ? (
                    <>
                      <img src={imgUrl(d.poster)} alt="" />
                      <span className="ontitle">{d.title.trim() || '제목'}</span>
                    </>
                  ) : (
                    <>
                      <Upload />
                      <b>포스터 올리기</b>
                      <small>세로로 긴 그림</small>
                    </>
                  )}
                  <input type="file" accept={PICTURES} disabled={busy} aria-label="포스터 그림 고르기" onChange={(e) => pick(e, 1440, (id) => set('poster', id))} />
                </label>
                <div className="side">
                  <p>{d.poster ? '홈 맨 위에 이렇게 걸려요.' : '올리지 않으면 홈에 제목만 걸려요.'}</p>
                  {d.poster && (
                    <button className="textbtn" onClick={() => set('poster', '')}>
                      그림 빼기
                    </button>
                  )}
                </div>
              </div>
            </Card>

            <Card title="기본 정보">
              <Field label="제목" must count={[d.title.length, RULES.limits.title]}>
                <input value={d.title} maxLength={RULES.limits.title} placeholder="예) 방송부의 금요일" onChange={(e) => set('title', e.target.value)} />
              </Field>
              <Field label="한 줄 소개" count={[d.logline.length, RULES.limits.logline]} hint="포스터의 제목 아래에 보여요.">
                <textarea
                  className="serif"
                  rows={2}
                  value={d.logline}
                  maxLength={RULES.limits.logline}
                  placeholder="예) 한 학기 만에 돌아온 방송부, 첫 방송을 하루 앞둔 저녁."
                  onChange={(e) => set('logline', e.target.value)}
                />
              </Field>
            </Card>
          </>
        )}

        {step === 'cast' && (
          <>
            <p className="lead">필름에 나오는 인물을 적어 주세요.</p>

            <Card title="내 배역" sub="필름 안에서 내가 맡는 인물이에요.">
              <Field label="이름" must count={[d.personaName.length, 20]}>
                <input value={d.personaName} maxLength={20} placeholder="예) 다온" onChange={(e) => set('personaName', e.target.value)} />
              </Field>
              <Field label="어떤 사람">
                <input
                  value={d.personaLine}
                  maxLength={RULES.limits.short}
                  placeholder="예) 한 학기 만에 방송부로 돌아온 사람"
                  onChange={(e) => set('personaLine', e.target.value)}
                />
              </Field>
            </Card>

            {d.casts.map((c, i) => (
              <Card key={i} title={`캐스트 ${i + 1}`} count={`${i + 1} / ${RULES.limits.casts}`} sub={i === 0 ? '필름에서 만나는 인물이에요.' : undefined}>
                <div className="castcard">
                  <div className="casthead">
                    <label className={c.face ? 'drop facepick has' : 'drop facepick'}>
                      {c.face ? (
                        <img src={imgUrl(c.face)} alt="" />
                      ) : (
                        <>
                          <Upload />
                          <b>사진</b>
                        </>
                      )}
                      <input type="file" accept={PICTURES} disabled={busy} aria-label={`${names[i]}의 사진 고르기`} onChange={(e) => pick(e, 640, (id) => setCast(i, 'face', id))} />
                    </label>
                    <Field label="이름" must count={[c.name.length, 20]}>
                      <input value={c.name} maxLength={20} placeholder="예) 서하" onChange={(e) => setCast(i, 'name', e.target.value)} />
                    </Field>
                  </div>

                  <Field label={`${josa(me, '과', '와')}의 관계`}>
                    <input value={c.role} maxLength={RULES.limits.short} placeholder="예) 방송부 부장. 같이 입학한 동기" onChange={(e) => setCast(i, 'role', e.target.value)} />
                  </Field>
                  <Field label={`${josa(me, '을', '를')} 부르는 말`}>
                    <input value={c.callsUser} maxLength={20} placeholder="예) 다온아" onChange={(e) => setCast(i, 'callsUser', e.target.value)} />
                  </Field>
                  <Field label="말투">
                    <input value={c.speech} maxLength={RULES.limits.short} placeholder="예) 반말. 짧게 말하고 일 얘기부터 한다" onChange={(e) => setCast(i, 'speech', e.target.value)} />
                  </Field>
                  <Field label="예시 대사" hint="한 줄에 하나씩, 세 줄까지 적을 수 있어요.">
                    <textarea value={c.samples} rows={3} placeholder={'예) 왔어?\n그건 내가 할게.\n내일 큐시트 봤어?'} onChange={(e) => setCast(i, 'samples', e.target.value)} />
                  </Field>

                  <button className={more[i] ? 'fold open' : 'fold'} aria-expanded={!!more[i]} onClick={() => setMore((m) => ({ ...m, [i]: !m[i] }))}>
                    더 적기
                    <Down />
                  </button>
                  {more[i] && (
                    <>
                      <Field label="불리는 이름들" hint="다른 인물이 부르는 이름을 쉼표로 나눠 적어 주세요.">
                        <input value={c.aliases} placeholder="예) 서하 씨, 부장" onChange={(e) => setCast(i, 'aliases', e.target.value)} />
                      </Field>
                      <Field label="낮에 주로 있는 곳">
                        <input value={c.dayPlace} maxLength={40} placeholder="예) 방송부 부실" onChange={(e) => setCast(i, 'dayPlace', e.target.value)} />
                      </Field>
                      <div className="two">
                        <Field label="자는 시간">
                          <input type="time" value={c.sleepFrom} onChange={(e) => setCast(i, 'sleepFrom', e.target.value)} />
                        </Field>
                        <Field label="일어나는 시간">
                          <input type="time" value={c.sleepTo} onChange={(e) => setCast(i, 'sleepTo', e.target.value)} />
                        </Field>
                      </div>
                      <p className="hint">자는 동안에는 먼저 연락하지 않아요.</p>
                    </>
                  )}

                  {d.casts.length > 1 && (
                    <p className="hint">
                      <button className="textbtn" onClick={() => removeCast(i)}>
                        {names[i]} 빼기
                      </button>
                    </p>
                  )}
                </div>
              </Card>
            ))}

            {d.casts.length < RULES.limits.casts && (
              <div className="addrow">
                <button className="btn" onClick={addCast}>
                  <Plus />
                  캐스트 추가
                </button>
              </div>
            )}

            {pairs.length > 0 && (
              <Card title="캐스트끼리" sub="서로 아는 사이라면 적어 주세요.">
                {pairs.map(([a, b]) => {
                  const pair = `${a}>${b}`;
                  const t = d.ties[pair] ?? { relation: '', calls: '' };
                  return (
                    <div className="pair" key={pair}>
                      <b>
                        {names[a]} → {names[b]}
                      </b>
                      <Field label="어떤 사이">
                        <input value={t.relation} maxLength={RULES.limits.short} placeholder="예) 한 해 선배" onChange={(e) => setTie(pair, 'relation', e.target.value)} />
                      </Field>
                      <Field label={`${josa(names[a]!, '이', '가')} ${josa(names[b]!, '을', '를')} 부르는 말`}>
                        <input value={t.calls} maxLength={20} placeholder="예) 오빠" onChange={(e) => setTie(pair, 'calls', e.target.value)} />
                      </Field>
                    </div>
                  );
                })}
              </Card>
            )}
          </>
        )}

        {step === 'world' && (
          <>
            <p className="lead">이야기가 벌어지는 곳과 때를 정해 주세요.</p>

            <Card title="배경" count={`${d.setting.length} / ${RULES.limits.setting}`}>
              <Field label="배경" quiet>
                <textarea
                  className="serif"
                  rows={5}
                  value={d.setting}
                  maxLength={RULES.limits.setting}
                  placeholder="두세 문장이면 충분해요. 예) 대학교 방송부. 금요일 저녁이면 다음 날 방송을 준비하느라 부실에 불이 늦게까지 켜져 있다."
                  onChange={(e) => set('setting', e.target.value)}
                />
              </Field>
            </Card>

            <Card title="시작하는 때" sub="이때부터 24시간이 첫 하루예요.">
              <Chips
                label="요일"
                week
                value={d.startDow}
                options={DOW_NAMES.map((n, i) => ({ value: i, label: n[0]! }))}
                onChange={(v) => set('startDow', v)}
              />
              <Field label="시각">
                <input type="time" value={d.startTime} onChange={(e) => set('startTime', e.target.value)} />
              </Field>
            </Card>

            <Card title="캐스트의 하루" sub="시간을 건너뛴 사이에도 캐스트는 자기 하루를 보내요.">
              <Toggle checked={d.feed} onChange={(v) => set('feed', v)} label="프로필에 피드 열기" desc="캐스트가 프로필에 자기 하루를 남겨요." />
              <Toggle checked={d.ping} onChange={(v) => set('ping', v)} label="먼저 연락하기" desc="돌아왔을 때 캐스트의 메시지가 와 있을 수 있어요." />
            </Card>
          </>
        )}

        {step === 'open' && (
          <>
            <p className="lead">필름의 첫 장면을 만들어 주세요.</p>

            <Card title="컷" count={`${d.stills.length} / ${RULES.limits.stills}`} sub="가로로 긴 그림이 잘 맞고, 첫 컷은 필름 정보와 재생 화면에 걸려요.">
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
                  <label className="drop">
                    <Upload />
                    <b>컷 올리기</b>
                    <input type="file" accept={PICTURES} disabled={busy} aria-label="컷 그림 고르기" onChange={(e) => pick(e, 1440, (id) => set('stills', [...d.stills, id]))} />
                  </label>
                )}
              </div>
            </Card>

            <Card title="첫 장면">
              <Field label="장소">
                <input value={d.place} maxLength={40} placeholder="예) 방송부 부실" onChange={(e) => set('place', e.target.value)} />
              </Field>
              <Field label="장면" count={[d.situation.length, RULES.limits.opening]} hint="필름에 들어갔을 때 보이는 모습을 적어 주세요.">
                <textarea
                  className="serif"
                  rows={7}
                  value={d.situation}
                  maxLength={RULES.limits.opening}
                  placeholder="예) 오랜만에 문을 열고 들어왔다. 서하가 큐시트를 넘기고 있다."
                  onChange={(e) => set('situation', e.target.value)}
                />
              </Field>
            </Card>

            <Card title="첫 대사">
              {d.casts.length > 1 && (
                <Chips
                  label="함께 시작하는 캐스트"
                  value={Math.min(d.room, d.casts.length - 1)}
                  options={names.map((n, i) => ({ value: i, label: n }))}
                  onChange={(v) => set('room', v)}
                />
              )}
              <Chips
                label="먼저 말하는 사람"
                value={d.speaker}
                options={[
                  { value: 'cast', label: opener, desc: `${josa(opener, '이', '가')} 첫 대사로 장면을 열어요.` },
                  { value: 'persona', label: me, desc: '첫 장면만 보이고, 내가 먼저 말해요.' },
                ]}
                onChange={(v) => set('speaker', v)}
              />
              {d.speaker === 'cast' && (
                <Field label="대사" hint="비워 두면 장면에 맞는 대사가 들어가요.">
                  <input value={d.firstLine} maxLength={200} placeholder="예) 어, 진짜 왔네." onChange={(e) => set('firstLine', e.target.value)} />
                </Field>
              )}
            </Card>
          </>
        )}

        {step === 'release' && (
          <>
            <p className="lead">{ready ? '개봉할 준비가 됐어요.' : '개봉 전에 채워야 할 항목이 있어요.'}</p>
            <p className="sub">개봉한 필름은 만든 사람에게만 보여요.</p>

            <Card title="필수 항목">
              <ul className="checklist">
                {todo.map((t) => (
                  <li key={t.label}>
                    <button className={t.done ? 'done' : ''} onClick={() => move(t.step)}>
                      <span className="mark">✓</span>
                      {t.label}
                      {!t.done && <span className="go">채우기</span>}
                    </button>
                  </li>
                ))}
              </ul>
            </Card>
          </>
        )}

        {err && (
          <p className="warn" style={{ marginTop: 20 }}>
            {err}
          </p>
        )}

        <div className="next">
          {next ? (
            <button className="btn more" onClick={() => move(next.id)}>
              다음 · {next.label}
              <Arrow />
            </button>
          ) : (
            <>
              <button className="btn play" disabled={busy} onClick={() => release(true)}>
                개봉하고 바로 들어가기
              </button>
              <button className="btn more" disabled={busy} onClick={() => release(false)}>
                개봉만 하기
              </button>
              <button className="textbtn" disabled={busy} onClick={() => setD(blank())}>
                모두 지우기
              </button>
            </>
          )}
        </div>
      </section>

      {toast && (
        <p className="toast" role="status">
          {toast}
        </p>
      )}
    </main>
  );
}

/** 관련된 칸을 묶은 한 장 */
function Card({ title, count, sub, children }: { title: string; count?: string; sub?: string; children: ReactNode }) {
  return (
    <section className="card">
      <h3>
        {title}
        {count && <span className="count">{count}</span>}
      </h3>
      {sub && <p className="sub">{sub}</p>}
      {children}
    </section>
  );
}

/** 칸 하나. 이름표는 짧게 두고, 도움말은 따로 달아 읽어 주는 순서를 지킨다 */
function Field({
  label,
  hint,
  must,
  count,
  quiet,
  children,
}: {
  label: string;
  hint?: string;
  must?: boolean;
  count?: [number, number];
  /** 묶음 제목이 이미 같은 말을 하면 이름표를 화면에서 감춘다. 읽어 주는 기기에는 그대로 들린다 */
  quiet?: boolean;
  children: ReactElement<Record<string, unknown>>;
}) {
  const id = useId();
  return (
    <div className={quiet ? 'field quiet' : 'field'}>
      <label htmlFor={id} className={quiet ? 'sr' : undefined}>
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

/** 눌러서 고르는 단추. 고른 것에 설명이 있으면 아래에 한 줄로 알려 준다 */
function Chips<T extends string | number>({
  label,
  value,
  options,
  onChange,
  week,
}: {
  label: string;
  value: T;
  options: { value: T; label: string; desc?: string }[];
  onChange: (v: T) => void;
  week?: boolean;
}) {
  const picked = options.find((o) => o.value === value);
  return (
    <div className="field" role="group" aria-label={label}>
      <label>{label}</label>
      <div className={week ? 'chips week' : 'chips'}>
        {options.map((o) => (
          <button key={String(o.value)} className={o.value === value ? 'chip on' : 'chip'} aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
            {o.label}
          </button>
        ))}
      </div>
      {picked?.desc && <p className="picked">{picked.desc}</p>}
    </div>
  );
}

/** 켜고 끄는 것. 무엇이 켜지는지 한 줄로 알려 준다 */
function Toggle({ checked, onChange, label, desc }: { checked: boolean; onChange: (v: boolean) => void; label: string; desc: string }) {
  return (
    <button className="toggle" role="switch" aria-checked={checked} onClick={() => onChange(!checked)}>
      <span>
        <strong>{label}</strong>
        <small>{desc}</small>
      </span>
      <span className="switch" />
    </button>
  );
}
