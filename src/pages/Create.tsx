import { type ChangeEvent, cloneElement, type ReactElement, type ReactNode, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { blankCast, blankDraft, blankRole, type Draft, type DraftBeat, type DraftCast, type DraftExtra, type DraftRole, editSlot, fromFilm, isBlank, previewFilm, toFilm } from '../../shared/draft';
import { FEED_KINDS, FEED_LABEL } from '../../shared/feed';
import { openingLength } from '../../shared/opening';
import { lengthOf } from '../../shared/reel';
import { josa, pick as pickJosa } from '../../shared/ko';
import { standIn } from '../../shared/roles';
import { DOW_NAMES, RULES } from '../../shared/rules';
import type { FeedKind, FeedPhoto } from '../../shared/types';
import { ApiFail, api, imgUrl, newId, uploadImage } from '../api';
import { FacePick } from '../crop';
import { drafts } from '../drafts';
import { Arrow, Close, Down, PlayFill, Plus, Up, Upload } from '../icons';
import { Face } from '../poster';
import { BgmPick } from '../bgm';
import { clock, ReelEditor } from '../reel';
import { Tabs } from '../tabs';
import { useMe } from '../me';
import { type PeekMode, Preview } from '../preview';
import { type Go, goBack, replaceUrl } from '../router';

/* 필름 만들기. 디렉터가 채우는 칸이다.
   며칠 치 일정을 쓰는 자리가 아니다 — 이 사람들이 어떤 사이이고 서로를 뭐라고 부르는지를 쓴다.
   칸마다 무엇을 쓰는지 알려 주고 예를 든다.
   개봉한 필름을 고칠 때도 이 화면을 쓴다(editId). 그때는 필름을 칸으로 되돌려 놓고 시작한다.
   새 필름은 쓰는 대로 이 기기에 임시저장된다. 임시저장한 필름을 이어서 만들 때도 이 화면이다(draftId). */

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

export function Create({ go, editId, draftId }: { go: Go; editId?: string; draftId?: string }) {
  /** 이 필름을 임시저장하는 자리의 표. 새 필름은 여기서 하나 받고, 개봉한 필름은 필름마다 한 자리다 */
  const [slot] = useState(() => (editId ? editSlot(editId) : (draftId ?? newId())));
  const [kept] = useState(() => (draftId ? drafts.load(draftId) : null));
  const [d, setD] = useState<Draft>(() => kept?.draft ?? blankDraft());
  /** 새 필름을 열었을 때, 전에 임시저장해 둔 필름이 몇 편 있었나 */
  const [waiting] = useState(() => (editId || draftId ? 0 : drafts.list().length));
  /** 고칠 필름을 불러오는 중인가, 못 불러왔다면 왜인가 */
  const [loading, setLoading] = useState(!!editId);
  const [loadErr, setLoadErr] = useState(() => (draftId && !kept ? '임시저장한 필름을 찾을 수 없어요.' : ''));
  const [step, setStep] = useState<Step>('plan');
  const [more, setMore] = useState<Record<number, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [toast, setToast] = useState('');
  /** 미리 보기를 띄우고 있으면 그 화면 */
  const [peek, setPeek] = useState<PeekMode | null>(null);
  const me0 = useMe();
  /** 고치는 필름: 서버에 저장돼 있는 내용. 임시저장한 것을 버리고 되돌릴 때 쓴다 */
  const stored = useRef<Draft | null>(null);
  /** 고치는 필름을 임시저장해 둔 데서 이어 열었나 */
  const [resumed, setResumed] = useState(false);

  /** 마지막으로 남긴 내용. 달라졌을 때만 다시 남긴다 — 열어만 본 필름의 저장한 때가 바뀌지 않게 */
  const last = useRef(JSON.stringify(d));

  /** 만들던 필름을 이 기기에 남긴다. 아무것도 적지 않았으면 남기지 않는다 */
  const keep = () => {
    const result = drafts.save(slot, d, editId);
    last.current = JSON.stringify(d);
    // 남긴 뒤에는 주소가 그 필름을 가리킨다. 새로 고치면 그 필름이 다시 열린다
    const here = window.location.pathname;
    if (result === 'saved' && here === '/create') replaceUrl(`/create/${slot}`);
    if (result !== 'saved' && here === `/create/${slot}`) replaceUrl('/create');
    return result;
  };

  // 쓰는 대로 남긴다 — 새로 고쳐도, 나갔다 와도 이어진다. 고치는 필름도 같다. 저장하면 그 자리는 비운다
  useEffect(() => {
    if (loading || loadErr || JSON.stringify(d) === last.current) return;
    keep();
  }, [d]);

  useEffect(() => {
    if (!editId) return;
    api
      .film(editId)
      .then(({ card, film }) => {
        if (!card.mine) return setLoadErr('만든 사람만 고칠 수 있어요.');
        const saved: Draft = { ...fromFilm(film), private: card.private };
        stored.current = saved;
        // 고치다 임시저장해 둔 것이 있으면 거기서 잇는다
        const kept = drafts.load(slot);
        const start = kept?.draft ?? saved;
        last.current = JSON.stringify(start);
        setD(start);
        setResumed(!!kept);
      })
      .catch((e) => setLoadErr(e instanceof ApiFail ? e.message : '필름을 불러오지 못했어요.'))
      .finally(() => setLoading(false));
  }, [editId]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(''), 1800);
    return () => clearTimeout(t);
  }, [toast]);

  /** 고치다 임시저장한 것을 버리고, 저장돼 있는 내용으로 되돌린다 */
  const revert = () => {
    if (!stored.current) return;
    drafts.drop(slot);
    last.current = JSON.stringify(stored.current);
    setD(stored.current);
    setResumed(false);
    setToast('저장된 내용으로 되돌렸어요');
  };

  const move = (to: Step) => {
    setStep(to);
    setErr('');
    window.scrollTo(0, 0);
  };

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));
  const setCastFeed = (i: number, v: FeedKind[]) => setD((x) => ({ ...x, casts: x.casts.map((c, j) => (j === i ? { ...c, feed: v } : c)) }));
  const setCastPhotos = (i: number, v: FeedPhoto[]) => setD((x) => ({ ...x, casts: x.casts.map((c, j) => (j === i ? { ...c, photos: v } : c)) }));
  const setCastExtras = (i: number, v: DraftExtra[]) => setD((x) => ({ ...x, casts: x.casts.map((c, j) => (j === i ? { ...c, extras: v } : c)) }));
  const setCast = (i: number, k: Exclude<keyof DraftCast, 'extras'>, v: string) =>
    setD((x) => ({ ...x, casts: x.casts.map((c, j) => (j === i ? { ...c, [k]: v } : c)) }));
  const setTie = (pair: string, k: 'relation' | 'calls', v: string) =>
    setD((x) => ({ ...x, ties: { ...x.ties, [pair]: { relation: '', calls: '', ...x.ties[pair], [k]: v } } }));
  const addCast = () => setD((x) => ({ ...x, casts: [...x.casts, blankCast()] }));
  /** 내 배역들. 첫째는 persona로 시작하는 칸이고, 둘째부터는 roles다 */
  const roles: DraftRole[] = [{ name: d.personaName, line: d.personaLine, face: d.personaFace, player: d.personaPlayer, extras: d.personaExtras }, ...(d.roles ?? [])];
  const asFirst = (x: Draft, r: DraftRole): Draft => ({ ...x, personaName: r.name, personaLine: r.line, personaFace: r.face, personaPlayer: r.player, personaExtras: r.extras });
  const setRole = (i: number, r: DraftRole) => setD((x) => (i === 0 ? asFirst(x, r) : { ...x, roles: x.roles.map((o, j) => (j === i - 1 ? r : o)) }));
  const addRole = () => setD((x) => ({ ...x, roles: [...(x.roles ?? []), blankRole()] }));
  /** 배역을 뺀다. 첫째를 빼면 둘째가 첫째가 된다 */
  const removeRole = (i: number) =>
    setD((x) => (i === 0 ? { ...asFirst(x, x.roles[0] ?? blankRole()), roles: x.roles.slice(1) } : { ...x, roles: x.roles.filter((_, j) => j !== i - 1) }));
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
  /** 캐스트 카드와 오프닝에서 내 배역을 부르는 말. 배역이 여럿이면 「내 배역」 */
  const me = roles.length > 1 ? '내 배역' : d.personaName.trim() || '나';
  const roleNames = roles.map((r, i) => r.name.trim() || (r.player ? '유저 이름' : roles.length > 1 ? `내 배역 ${i + 1}` : '내 배역'));
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
    { step: 'cast', label: roles.length > 1 ? '내 배역 모두의 이름' : '내 배역의 이름', done: roles.every((r) => r.player || r.name.trim().length > 0) },
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
      // 개봉했으니(고친 것은 저장했으니) 임시저장해 둔 자리는 비운다
      drafts.drop(slot);
      if (thenEnter) {
        const view = await api.enter(id, newId());
        go(`/play/${view.id}?open=1`, { replace: true });
      } else if (editId) {
        // 고친 것을 저장했다. 고치러 들어온 화면으로 돌아간다
        goBack(go, `/film/${id}`);
      } else {
        go(`/film/${id}`, { replace: true });
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
    <main className="app tabbed make">
      <div className="head">
        <button className="ico" onClick={() => goBack(go, editId ? `/film/${editId}` : '/mine')} aria-label="닫기">
          <Close />
        </button>
        <b>{editId ? '필름 고치기' : '필름 만들기'}</b>
        <div className="right">
          <button
            className="mini keep"
            onClick={() => {
              const result = keep();
              setToast(result === 'saved' ? '내 필름에 임시저장했어요' : result === 'blank' ? '아직 적은 내용이 없어요' : '저장하지 못했어요');
            }}
          >
            임시저장
          </button>
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
        {resumed && (
          <p className="sub resume">
            임시저장한 내용을 불러왔어요.
            <button className="textbtn" onClick={revert}>
              저장된 내용으로 되돌리기
            </button>
          </p>
        )}
        {step === 'plan' && (
          <>
            <p className="lead">필름의 제목과 포스터를 정해 주세요.</p>
            {waiting > 0 && isBlank(d) && (
              <p className="sub resume">
                임시저장한 필름이 {waiting}편 있어요.
                <button className="textbtn" onClick={() => go('/mine')}>
                  이어서 만들기
                </button>
              </p>
            )}

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

            {roles.map((r, i) => (
              <Card
                key={`role${i}`}
                title={roles.length > 1 ? `내 배역 ${i + 1}` : '내 배역'}
                count={roles.length > 1 ? `${i + 1} / ${RULES.limits.roles}` : undefined}
                sub={i === 0 ? (roles.length > 1 ? '들어가는 사람이 이 가운데 하나를 골라요.' : '필름 안에서 내가 맡는 인물이에요.') : undefined}
              >
                <RoleFields role={r} label={roleNames[i]!} busy={busy} onChange={(v) => setRole(i, v)} />
                {i === 0 && <p className="hint">플레이하는 사람은 사진과 정보를 자기 것으로 고칠 수 있어요.</p>}
                {roles.length > 1 && (
                  <p className="hint">
                    <button className="textbtn" onClick={() => removeRole(i)}>
                      {roleNames[i]} 빼기
                    </button>
                  </p>
                )}
              </Card>
            ))}

            {roles.length < RULES.limits.roles && (
              <div className="addrow">
                <button className="btn" onClick={addRole}>
                  <Plus />
                  내 배역 추가
                </button>
              </div>
            )}

            {d.casts.map((c, i) => (
              <Card key={i} title={`캐스트 ${i + 1}`} count={`${i + 1} / ${RULES.limits.casts}`} sub={i === 0 ? '필름에서 만나는 인물이에요.' : undefined}>
                <div className="castcard">
                  <div className="casthead">
                    <FacePick face={c.face} label={`${names[i]}의 사진 고르기`} disabled={busy} onPick={(id) => setCast(i, 'face', id)} />
                    <Field label="이름" must count={[c.name.length, 20]}>
                      <input value={c.name} maxLength={20} placeholder="예) 서하" onChange={(e) => setCast(i, 'name', e.target.value)} />
                    </Field>
                  </div>

                  <Field label="소개" optional count={[c.intro.length, RULES.limits.intro]} hint="프로필에만 보이고, 캐스트의 말과 행동에는 쓰이지 않아요.">
                    <textarea
                      rows={3}
                      value={c.intro}
                      maxLength={RULES.limits.intro}
                      placeholder="예) 방송부 부장. 무뚝뚝해 보여도 부원들의 생일은 다 외운다."
                      onChange={(e) => setCast(i, 'intro', e.target.value)}
                    />
                  </Field>
                  <Field label={`${josa(me, '과', '와')}의 관계`}>
                    <input value={c.role} maxLength={RULES.limits.short} placeholder="예) 방송부 부장. 같이 입학한 동기" onChange={(e) => setCast(i, 'role', e.target.value)} />
                  </Field>
                  <Field label={`${josa(me, '을', '를')} 부르는 말`}>
                    <input value={c.callsUser} maxLength={20} placeholder="예) 다온아" onChange={(e) => setCast(i, 'callsUser', e.target.value)} />
                  </Field>
                  <Field label="말투" count={[c.speech.length, RULES.limits.speech]}>
                    <textarea
                      rows={4}
                      value={c.speech}
                      maxLength={RULES.limits.speech}
                      placeholder={'예) 반말. 짧게 말하고 일 얘기부터 한다.\n기분이 좋으면 말끝을 늘인다.'}
                      onChange={(e) => setCast(i, 'speech', e.target.value)}
                    />
                  </Field>
                  <Field label="예시 대사" hint="한 줄에 하나씩, 세 줄까지 적을 수 있어요.">
                    <textarea value={c.samples} rows={3} placeholder={'예) 왔어?\n그건 내가 할게.\n내일 큐시트 봤어?'} onChange={(e) => setCast(i, 'samples', e.target.value)} />
                  </Field>
                  <Field label="성격" optional count={[c.nature.length, RULES.limits.trait]}>
                    <textarea rows={2} value={c.nature} maxLength={RULES.limits.trait} placeholder="예) 말수가 적다. 맡은 일은 끝까지 하고, 고맙다는 말을 잘 못 한다." onChange={(e) => setCast(i, 'nature', e.target.value)} />
                  </Field>
                  <Field label="습관" optional count={[c.habit.length, RULES.limits.trait]}>
                    <textarea rows={2} value={c.habit} maxLength={RULES.limits.trait} placeholder="예) 생각할 때 볼펜 끝으로 책상을 두드린다." onChange={(e) => setCast(i, 'habit', e.target.value)} />
                  </Field>
                  <Field label="트라우마" optional count={[c.trauma.length, RULES.limits.trait]}>
                    <textarea rows={2} value={c.trauma} maxLength={RULES.limits.trait} placeholder="예) 첫 방송에서 원고를 통째로 잊었다. 그 뒤로 방송 직전에는 말이 없어진다." onChange={(e) => setCast(i, 'trauma', e.target.value)} />
                  </Field>
                  <Field label="결핍" optional count={[c.lack.length, RULES.limits.trait]}>
                    <textarea rows={2} value={c.lack} maxLength={RULES.limits.trait} placeholder="예) 누구에게 먼저 기대 본 적이 없다." onChange={(e) => setCast(i, 'lack', e.target.value)} />
                  </Field>
                  <Field label="비밀" optional count={[c.secret.length, RULES.limits.trait]}>
                    <textarea rows={2} value={c.secret} maxLength={RULES.limits.trait} placeholder="예) 지난 학기에 방송부를 그만두려고 했다." onChange={(e) => setCast(i, 'secret', e.target.value)} />
                  </Field>
                  <p className="hint">선택 칸은 플레이하는 사람에게 보이지 않고, 캐스트의 말과 행동에 묻어나요.</p>
                  <Extras value={c.extras} onChange={(v) => setCastExtras(i, v)} examples={{ label: '예) 좋아하는 것', text: '예) 비 오는 날의 헌책방 냄새.' }} />

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

                  {d.feed && (
                    <CastFeed
                      feed={c.feed}
                      photos={c.photos}
                      busy={busy}
                      onFeed={(v) => setCastFeed(i, v)}
                      onPhotos={(v) => setCastPhotos(i, v)}
                      onPick={(e) => pick(e, 1280, (id) => setCastPhotos(i, [...c.photos, { id, about: '' }]))}
                    />
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

            <Card title="덧붙이는 칸" sub="세계에 대해 더 적을 것을 항목 이름부터 직접 정해요.">
              <Extras bare value={d.extras} onChange={(v) => set('extras', v)} examples={{ label: '예) 이 세계의 화폐', text: '예) 조개껍데기를 돈처럼 쓴다.' }} />
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
              {d.casts.length > 1 && (
                <>
                  <Toggle checked={d.aside} onChange={(v) => set('aside', v)} label="한편 보여 주기" desc="내가 없는 자리에서 캐스트끼리 나눈 장면을 읽을 수 있어요." />
                  {d.aside && !Object.values(d.ties).some((t) => t.relation.trim() || t.calls.trim()) && (
                    <p className="hint">캐스팅 탭의 「캐스트끼리」에 사이를 적어 둔 두 사람만 만나요.</p>
                  )}
                </>
              )}
            </Card>
          </>
        )}

        {step === 'open' && (
          <>
            <p className="lead">오프닝을 순서대로 쌓아 주세요.</p>
            <p className="sub">필름에 들어가면 이 순서대로 흘러요.</p>

            <Card title="오프닝 영상" count={d.reel ? clock(lengthOf(d.reel)) : undefined} sub="들어가면 맨 먼저 흘러요. 컷을 이어 붙여 만들어요.">
              <ReelEditor reel={d.reel} onChange={(v) => set('reel', v)} onError={setErr} />
            </Card>

            <Card title="배경 음악" sub="필름 안에서 처음부터 끝까지 이어서 흘러요.">
              <BgmPick id={d.bgm} name={d.bgmName} onChange={(id, name) => setD((x) => ({ ...x, bgm: id, bgmName: name }))} onError={setErr} />
            </Card>

            <div className="boardhead">
              <span className="kicker">첫 장면</span>
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
            <div className="addrow">
              <button className="btn peekbtn" onClick={() => setPeek('opening')}>
                <PlayFill />
                오프닝 미리 보기
              </button>
            </div>

            <Card title="장소와 첫 마디">
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
                  { value: 'cast', label: opener, desc: `첫 장면에 이어 ${josa(opener, '이', '가')} 먼저 말해요.` },
                  { value: 'persona', label: me, desc: '첫 장면에 이어 내가 먼저 말해요.' },
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
              <p className="lead">{ready ? '개봉할 준비가 됐어요.' : '개봉 전에 채워야 할 항목이 있어요.'}</p>
            )}

            <Card title="미리 보기" sub="들어가는 사람이 보는 화면이에요.">
              <div className="peekrow">
                <button className="btn more" onClick={() => setPeek('film')}>
                  필름 정보
                </button>
                <button className="btn more" onClick={() => setPeek('opening')}>
                  <PlayFill />
                  오프닝
                </button>
              </div>
            </Card>

            <Card title="공개 범위">
              <Chips
                label=""
                name="공개 범위"
                value={d.private ? 'private' : 'public'}
                options={[
                  { value: 'public', label: '공개', desc: '모두의 목록에 보여요.' },
                  { value: 'private', label: '비공개', desc: '나만 보고 들어갈 수 있어요.' },
                ]}
                onChange={(v) => set('private', v === 'private')}
              />
            </Card>

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
      {peek && <Preview film={previewFilm(d, me0.name)} start={peek} onClose={() => setPeek(null)} />}
      <Tabs path={'/create'} go={go} />
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
export function Card({ title, count, sub, children }: { title: string; count?: string; sub?: string; children: ReactNode }) {
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
export function Field({
  label,
  hint,
  must,
  optional,
  count,
  quiet,
  children,
}: {
  label: string;
  hint?: string;
  must?: boolean;
  /** 적지 않아도 되는 칸이라고 이름 옆에 알린다 */
  optional?: boolean;
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
        {optional && <i className="opt">선택</i>}
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

/** 캐스트의 피드: 켜고 끄는 여섯 가지와 올릴 사진. 하루에 하나만, 그날에 맞는 것을 대사 모델이 고른다.
    사진은 여기 붙인 것만 올라간다. 무슨 사진인지 적어 두면 그날에 맞는 사진을 고른다 */
function CastFeed({
  feed,
  photos,
  busy,
  onFeed,
  onPhotos,
  onPick,
}: {
  feed: FeedKind[];
  photos: FeedPhoto[];
  busy: boolean;
  onFeed: (v: FeedKind[]) => void;
  onPhotos: (v: FeedPhoto[]) => void;
  onPick: (e: ChangeEvent<HTMLInputElement>) => void;
}) {
  const [sel, setSel] = useState(0);
  const toggle = (k: FeedKind) => onFeed(feed.includes(k) ? feed.filter((x) => x !== k) : FEED_KINDS.filter((x) => x === k || feed.includes(x)));
  const cur = photos[Math.min(sel, photos.length - 1)];
  const at = Math.min(sel, photos.length - 1);
  return (
    <div className="fdset">
      <p className="exhead">피드</p>
      <p className="hint">켜 둔 것 가운데 그날에 맞는 것 하나만 올라와요. 안 올리는 날도 있어요.</p>
      <div className="toggles" role="group" aria-label="피드에 올라오는 것">
        {FEED_KINDS.map((k) => (
          <button key={k} className={feed.includes(k) ? 'on' : ''} aria-pressed={feed.includes(k)} onClick={() => toggle(k)}>
            <i aria-hidden="true">{feed.includes(k) ? '✓' : ''}</i>
            <span>{FEED_LABEL[k]}</span>
          </button>
        ))}
      </div>
      {feed.includes('photo') && (
        <>
          <div className="photos">
            {photos.map((p, i) => (
              <button key={p.id} className={i === at ? 'ph on' : 'ph'} aria-pressed={i === at} aria-label={`피드 사진 ${i + 1}`} onClick={() => setSel(i)}>
                <img src={imgUrl(p.id)} alt="" />
              </button>
            ))}
            {photos.length < RULES.feed.photos && (
              <label className={busy ? 'phadd off' : 'phadd'}>
                <Plus />
                <span>
                  사진 추가
                  <br />
                  {photos.length} / {RULES.feed.photos}
                </span>
                <input type="file" accept={PICTURES} disabled={busy} aria-label="피드에 올릴 사진 고르기" onChange={onPick} />
              </label>
            )}
          </div>
          {cur && (
            <>
              <Field label="무슨 사진" count={[cur.about.length, RULES.feed.about]}>
                <input
                  value={cur.about}
                  maxLength={RULES.feed.about}
                  placeholder="예) 셔터를 내린 뒤 가게 앞에서 본 하늘"
                  onChange={(e) => onPhotos(photos.map((p, i) => (i === at ? { ...p, about: e.target.value } : p)))}
                />
              </Field>
              <button
                className="textbtn exdel"
                onClick={() => {
                  onPhotos(photos.filter((_, i) => i !== at));
                  setSel(0);
                }}
              >
                이 사진 빼기
              </button>
            </>
          )}
          <p className="hint">사진은 여기 붙인 것만 올라와요.</p>
        </>
      )}
    </div>
  );
}

/** 덧붙이는 칸. 항목 이름과 내용을 디렉터가 직접 적는다. 처음에 빈 칸 셋, 「칸 추가」로 늘린다.
    내용이 빈 칸은 저장하지 않는다. 플레이하는 사람에게는 보이지 않고, 대사 모델에게 그대로 건네진다 */
function Extras({ value, onChange, examples, bare }: { value: DraftExtra[]; onChange: (v: DraftExtra[]) => void; examples: { label: string; text: string }; bare?: boolean }) {
  const edit = (i: number, k: 'label' | 'text', v: string) => onChange(value.map((e, j) => (j === i ? { ...e, [k]: v } : e)));
  return (
    <div className="extras">
      {!bare && <p className="exhead">덧붙이는 칸</p>}
      {value.map((e, i) => (
        <div className="extra" key={i}>
          <Field label="항목" count={[e.label.length, RULES.extras.label]}>
            <input value={e.label} maxLength={RULES.extras.label} placeholder={examples.label} onChange={(ev) => edit(i, 'label', ev.target.value)} />
          </Field>
          <Field label="내용" count={[e.text.length, RULES.extras.text]}>
            <textarea rows={2} value={e.text} maxLength={RULES.extras.text} placeholder={examples.text} onChange={(ev) => edit(i, 'text', ev.target.value)} />
          </Field>
          <button className="textbtn exdel" onClick={() => onChange(value.filter((_, j) => j !== i))}>
            이 칸 지우기
          </button>
        </div>
      ))}
      <button className="btn more wide" disabled={value.length >= RULES.extras.max} onClick={() => onChange([...value, { label: '', text: '' }])}>
        <Plus />칸 추가
      </button>
      <p className="hint">플레이하는 사람에게는 보이지 않고, 이야기에 묻어나요.</p>
      <p className="hint">칸이 많으면 대화가 무거워져서 {RULES.extras.recommend}개까지 권장해요.</p>
    </div>
  );
}

/** 눌러서 고르는 단추. 고른 것에 설명이 있으면 아래에 한 줄로 알려 준다 */
function Chips<T extends string | number>({
  label,
  name,
  value,
  options,
  onChange,
  week,
}: {
  /** 보이는 이름표. 묶음 제목이 이미 같은 말이면 비우고 name만 준다 */
  label: string;
  /** 읽어 주는 이름. 없으면 이름표와 같다 */
  name?: string;
  value: T;
  options: { value: T; label: string; desc?: string }[];
  onChange: (v: T) => void;
  week?: boolean;
}) {
  const picked = options.find((o) => o.value === value);
  return (
    <div className="field" role="group" aria-label={name ?? label}>
      {label && <label>{label}</label>}
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

/** 내 배역 한 칸: 사진, 이름, 「유저 이름」, 어떤 사람, 덧붙이는 칸.
    「유저 이름」을 켜면 들어가는 사람의 이름이 이 배역의 이름이 된다. 그때 이름 칸은 글에 대신 쓰는 이름이다 */
function RoleFields({ role, label, busy, onChange }: { role: DraftRole; label: string; busy: boolean; onChange: (r: DraftRole) => void }) {
  const put = <K extends keyof DraftRole>(k: K, v: DraftRole[K]) => onChange({ ...role, [k]: v });
  const stand = standIn(role);
  return (
    <>
      <div className="casthead">
        <FacePick face={role.face} label={`${label}의 사진 고르기`} disabled={busy} onPick={(id) => put('face', id)} />
        <Field label={role.player ? '글에 쓰는 이름' : '이름'} must={!role.player} count={[role.name.length, 20]}>
          <input value={role.name} maxLength={20} placeholder={role.player ? RULES.playerName : '예) 다온'} onChange={(e) => put('name', e.target.value)} />
        </Field>
      </div>
      <Toggle checked={role.player} onChange={(v) => put('player', v)} label="유저 이름" desc="들어가는 사람의 이름이 이 배역의 이름이 돼요." />
      {role.player && (
        <p className="hint">
          필름의 글에 「{stand}」{pickJosa(stand, '이라고', '라고')} 쓰면 들어가는 사람의 이름으로 바뀌어요.
        </p>
      )}
      <Field label="어떤 사람" count={[role.line.length, RULES.limits.persona]}>
        <textarea
          rows={2}
          value={role.line}
          maxLength={RULES.limits.persona}
          placeholder="예) 한 학기 만에 방송부로 돌아온 사람"
          onChange={(e) => put('line', e.target.value)}
        />
      </Field>
      <Extras value={role.extras} onChange={(v) => put('extras', v)} examples={{ label: '예) 나이', text: '예) 스물셋. 휴학 중이다.' }} />
    </>
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
