import { type ChangeEvent, cloneElement, type ReactElement, type ReactNode, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { blankCast, blankDraft, type Draft, type DraftBeat, type DraftCast, fromFilm, readDraft, toFilm } from '../../shared/draft';
import { openingLength } from '../../shared/opening';
import { josa } from '../../shared/ko';
import { DOW_NAMES, RULES } from '../../shared/rules';
import { ApiFail, api, imgUrl, newId, uploadImage } from '../api';
import { Arrow, Close, Down, Plus, Up, Upload } from '../icons';
import { Face } from '../poster';

/* 필름 만들기. 디렉터가 채우는 칸이다.
   며칠 치 일정을 쓰는 자리가 아니다 — 이 사람들이 어떤 사이이고 서로를 뭐라고 부르는지를 쓴다.
   칸마다 무엇을 쓰는지 알려 주고 예를 든다.
   개봉한 필름을 고칠 때도 이 화면을 쓴다(editId). 그때는 필름을 칸으로 되돌려 놓고 시작한다. */

const DRAFT_KEY = 'sona.draft';

function loadDraft(): Draft {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    // 예전 모양으로 남겨 둔 것도 지금의 칸으로 읽는다
    if (raw) return readDraft(JSON.parse(raw));
  } catch {
    /* 저장이 막혀 있으면 빈 칸에서 시작한다 */
  }
  return blankDraft();
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

export function Create({ go, editId }: { go: (to: string) => void; editId?: string }) {
  const [d, setD] = useState<Draft>(() => (editId ? blankDraft() : loadDraft()));
  /** 고칠 필름을 불러오는 중인가, 못 불러왔다면 왜인가 */
  const [loading, setLoading] = useState(!!editId);
  const [loadErr, setLoadErr] = useState('');
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

  // 새 필름은 쓰다가 새로 고쳐도 남게 한다. 고치는 중인 필름은 남기지 않는다 — 저장된 필름이 원본이다
  useEffect(() => {
    if (!editId) keep();
  }, [d]);

  useEffect(() => {
    if (!editId) return;
    api
      .film(editId)
      .then(({ card, film }) => {
        if (card.mine) setD(fromFilm(film));
        else setLoadErr('만든 사람만 고칠 수 있어요.');
      })
      .catch((e) => setLoadErr(e instanceof ApiFail ? e.message : '필름을 불러오지 못했어요.'))
      .finally(() => setLoading(false));
  }, [editId]);

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
    setD((x) => ({
      ...x,
      casts: x.casts.filter((_, j) => j !== i),
      ties: {},
      room: 0,
      // 그 캐스트가 오프닝에서 한 말도 같이 빠진다. 뒤 캐스트는 한 칸씩 당겨진다
      beats: x.beats.filter((b) => !(b.kind === 'say' && b.cast === i)).map((b) => (b.kind === 'say' && b.cast > i ? { ...b, cast: b.cast - 1 } : b)),
    }));
    setMore({});
  };

  /* 오프닝의 칸들 */
  const [sel, setSel] = useState('');
  const beatId = () => `n${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const setBeats = (f: (b: DraftBeat[]) => DraftBeat[]) => setD((x) => ({ ...x, beats: f(x.beats) }));
  const addBeat = (kind: 'tell' | 'say') => {
    const id = beatId();
    setBeats((b) => [...b, { id, kind, image: '', text: '', cast: Math.min(d.room, d.casts.length - 1) }]);
    setSel(id);
  };
  const addCut = (image: string) => {
    const id = beatId();
    setBeats((b) => [...b, { id, kind: 'cut', image, text: '', cast: 0 }]);
    setSel(id);
  };
  const editBeat = (id: string, patch: Partial<DraftBeat>) => setBeats((b) => b.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  const dropBeat = (id: string) => setBeats((b) => b.filter((x) => x.id !== id));
  const moveBeat = (id: string, by: -1 | 1) =>
    setBeats((b) => {
      const i = b.findIndex((x) => x.id === id);
      const j = i + by;
      if (i < 0 || j < 0 || j >= b.length) return b;
      const next = [...b];
      [next[i], next[j]] = [next[j]!, next[i]!];
      return next;
    });

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
  /** 오프닝에 쓴 글자 수와 남은 자리 */
  const used = openingLength(d.beats);
  const spare = Math.max(0, RULES.limits.opening - used);
  const cuts = d.beats.filter((b) => b.kind === 'cut').length;
  const full = d.beats.length >= RULES.limits.beats;

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
      const { id } = editId ? await api.updateFilm(editId, toFilm(d)) : await api.createFilm(toFilm(d));
      if (!editId) {
        try {
          localStorage.removeItem(DRAFT_KEY);
        } catch {
          /* 무시 */
        }
      }
      if (thenEnter) {
        const view = await api.enter(id, newId());
        go(`/play/${view.id}?open=1`);
      } else {
        go(`/film/${id}`);
      }
    } catch (x) {
      setErr(x instanceof ApiFail ? x.message : editId ? '저장하지 못했어요.' : '개봉하지 못했어요.');
      setBusy(false);
    }
  };

  const at = STEPS.findIndex((s) => s.id === step);
  const next = STEPS[at + 1];
  /** 고칠 때는 마지막 탭이 「저장」이다 */
  const labelOf = (s: { id: Step; label: string }) => (editId && s.id === 'release' ? '저장' : s.label);

  if (loading) return <p className="center">불러오는 중</p>;
  if (loadErr) return <p className="center">{loadErr}</p>;

  return (
    <main className="app make">
      <div className="head">
        <button className="ico" onClick={() => go(editId ? `/film/${editId}` : '/')} aria-label="닫기">
          <Close />
        </button>
        <b>{editId ? '필름 고치기' : '필름 만들기'}</b>
        <div className="right">
          {!editId && (
            <button className="mini keep" onClick={() => setToast(keep() ? '이 기기에 저장했어요' : '저장하지 못했어요')}>
              임시저장
            </button>
          )}
          <button className="mini open" disabled={busy} onClick={() => release(false)}>
            {editId ? '저장' : '개봉'}
          </button>
        </div>
      </div>
      <div className="slate" />

      <nav className="steps" aria-label="만드는 순서">
        {STEPS.map((s) => (
          <button key={s.id} className={s.id === step ? 'step on' : 'step'} onClick={() => move(s.id)}>
            {s.must && <sup aria-hidden="true">*</sup>}
            {labelOf(s)}
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
            <p className="lead">오프닝을 순서대로 쌓아 주세요.</p>
            <p className="sub">필름에 들어가면 이 순서대로 흘러요.</p>

            <div className="boardhead">
              <span className="kicker">오프닝</span>
              <span className="count">
                {used.toLocaleString('ko-KR')} / {RULES.limits.opening.toLocaleString('ko-KR')}
              </span>
            </div>

            {/* 왼쪽 여백에 무엇인지 적고, 오른쪽에는 재생될 모습 그대로 둔다. 고른 칸은 그 자리에서 고친다 */}
            <div className="board">
              {d.beats.length === 0 && (
                <div className="blk">
                  <span className="kind" />
                  <div className="what">
                    <p className="none">지문이나 대사로 첫 장면을 시작해 보세요.</p>
                  </div>
                </div>
              )}

              {d.beats.map((b, i) => {
                const on = sel === b.id;
                const no = d.beats.slice(0, i + 1).filter((x) => x.kind === 'cut').length;
                const who = Math.min(b.cast, d.casts.length - 1);
                return (
                  <div className={on ? 'blk on' : 'blk'} key={b.id}>
                    <span className="kind">{b.kind === 'cut' ? `컷 ${no}` : b.kind === 'tell' ? '지문' : '대사'}</span>
                    <div className="what">
                      {b.kind === 'cut' && (
                        <button className="frame" onClick={() => setSel(on ? '' : b.id)} aria-pressed={on} aria-label={`컷 ${no}`}>
                          <span className="pic grain">
                            <img src={imgUrl(b.image)} alt="" />
                          </span>
                        </button>
                      )}

                      {b.kind === 'tell' &&
                        (on ? (
                          <div className="edit">
                            <Grow
                              label="지문"
                              value={b.text}
                              maxLength={b.text.length + spare}
                              placeholder="예) 오랜만에 문을 열고 들어왔다. 서하가 큐시트를 넘기고 있다."
                              onChange={(v) => editBeat(b.id, { text: v })}
                            />
                          </div>
                        ) : (
                          <button className="peek" onClick={() => setSel(b.id)}>
                            <p className={b.text.trim() ? 'tell' : 'tell empty'}>{b.text.trim() || '지문을 적어 주세요.'}</p>
                          </button>
                        ))}

                      {b.kind === 'say' &&
                        (on ? (
                          <div className="edit">
                            {d.casts.length > 1 && (
                              <div className="chips" role="group" aria-label="말하는 캐스트">
                                {names.map((n, j) => (
                                  <button key={j} className={j === who ? 'chip on' : 'chip'} aria-pressed={j === who} onClick={() => editBeat(b.id, { cast: j })}>
                                    {n}
                                  </button>
                                ))}
                              </div>
                            )}
                            <input
                              className="line"
                              autoFocus
                              value={b.text}
                              maxLength={Math.min(RULES.limits.line, b.text.length + spare)}
                              placeholder="예) 어, 진짜 왔네."
                              aria-label={`${names[who]}의 대사`}
                              onChange={(e) => editBeat(b.id, { text: e.target.value })}
                            />
                          </div>
                        ) : (
                          <button className="peek" onClick={() => setSel(b.id)}>
                            <span className="say">
                              <Face id={d.casts[who]?.face ?? ''} name={names[who] ?? ''} />
                              <span>
                                <small>{names[who]}</small>
                                <p className={b.text.trim() ? '' : 'empty'}>{b.text.trim() || '대사를 적어 주세요.'}</p>
                              </span>
                            </span>
                          </button>
                        ))}

                      {on && (
                        <div className="tools">
                          <button disabled={i === 0} onClick={() => moveBeat(b.id, -1)}>
                            <Up />
                            위로
                          </button>
                          <button disabled={i === d.beats.length - 1} onClick={() => moveBeat(b.id, 1)}>
                            <Down />
                            아래로
                          </button>
                          <button onClick={() => dropBeat(b.id)}>빼기</button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}

              <div className="adder">
                <span />
                <div className="row">
                  <label className={busy || full || cuts >= RULES.limits.stills ? 'add off' : 'add'}>
                    <Plus />
                    컷
                    <input
                      type="file"
                      accept={PICTURES}
                      disabled={busy || full || cuts >= RULES.limits.stills}
                      aria-label="컷으로 넣을 그림 고르기"
                      onChange={(e) => pick(e, 1440, addCut)}
                    />
                  </label>
                  <button className="add" disabled={full} onClick={() => addBeat('tell')}>
                    <Plus />
                    지문
                  </button>
                  <button className="add" disabled={full} onClick={() => addBeat('say')}>
                    <Plus />
                    대사
                  </button>
                </div>
              </div>
            </div>
            <p className="hint boardhint">컷을 넣은 자리부터 화면의 그림이 바뀌어요.</p>

            <Card title="첫 장면">
              <Field label="장소">
                <input value={d.place} maxLength={40} placeholder="예) 방송부 부실" onChange={(e) => set('place', e.target.value)} />
              </Field>
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
                  { value: 'cast', label: opener, desc: `오프닝에 이어 ${josa(opener, '이', '가')} 먼저 말해요.` },
                  { value: 'persona', label: me, desc: '오프닝이 끝나면 내가 먼저 말해요.' },
                ]}
                onChange={(v) => set('speaker', v)}
              />
            </Card>
          </>
        )}

        {step === 'release' && (
          <>
            {editId ? (
              <>
                <p className="lead">{ready ? '저장할 준비가 됐어요.' : '저장 전에 채워야 할 항목이 있어요.'}</p>
                <p className="sub">고친 내용은 새로 들어갈 때부터 반영돼요.</p>
              </>
            ) : (
              <>
                <p className="lead">{ready ? '개봉할 준비가 됐어요.' : '개봉 전에 채워야 할 항목이 있어요.'}</p>
                <p className="sub">개봉한 필름은 내 목록에만 보이고, 링크를 보내면 다른 사람도 들어올 수 있어요.</p>
              </>
            )}

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
              다음 · {labelOf(next)}
              <Arrow />
            </button>
          ) : editId ? (
            <button className="btn play" disabled={busy} onClick={() => release(false)}>
              저장
            </button>
          ) : (
            <>
              <button className="btn play" disabled={busy} onClick={() => release(true)}>
                개봉하고 바로 들어가기
              </button>
              <button className="btn more" disabled={busy} onClick={() => release(false)}>
                개봉만 하기
              </button>
              <button className="textbtn" disabled={busy} onClick={() => setD(blankDraft())}>
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

/** 지문을 고치는 칸. 쓴 만큼 자라고, 고르면 맨 끝에서 이어 쓴다 */
function Grow({ label, value, maxLength, placeholder, onChange }: { label: string; value: string; maxLength: number; placeholder: string; onChange: (v: string) => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);
  return <textarea ref={ref} rows={2} value={value} maxLength={maxLength} placeholder={placeholder} aria-label={label} onChange={(e) => onChange(e.target.value)} />;
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
