/* 오프닝 영상 — 디렉터가 컷을 이어 붙여 만든다. AI가 만든 영상이 아니다.
   영상 파일로 굽지 않는다. 앱이 컷을 차례로 틀어 준다: 그림과 영상, 움직임, 전환, 글자, 음악.
   그래서 그림 컷은 올린 그대로 선명하다. 영상 컷은 올릴 때 줄여서 화질이 떨어질 수 있다. */

import { type ChangeEvent, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { blankReel, clipAt, lengthOf, motionAt, musicVolume, newClip, opacityOf, progressIn, startsOf, textOpacity, underOf } from '../shared/reel';
import { RULES } from '../shared/rules';
import type { Reel, ReelClip, ReelEnter, ReelMotion, ReelRatio, ReelStyle } from '../shared/types';
import { ApiFail, imgUrl, uploadImage } from './api';
import { Next, Pause, PlayFill, Sound, SoundOff } from './icons';
import { audioType, mediaSeconds, mediaUrl, shrinkVideo, uploadMedia } from './media';

const R = RULES.reel;
const SOUND = 'sona.sound';

/** 이 기기에서 소리를 꺼 두었나. 배경 음악과 오프닝 영상이 같이 쓴다 */
export function soundOff(): boolean {
  try {
    return localStorage.getItem(SOUND) === 'off';
  } catch {
    return false;
  }
}
export function setSoundOff(off: boolean): void {
  try {
    localStorage.setItem(SOUND, off ? 'off' : 'on');
  } catch {
    /* 저장이 막혀 있으면 이번에만 */
  }
}

/** 「0:07」 */
export const clock = (sec: number): string => {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/** 화면. 그때(t)의 컷을 그린다. 틀고 있으면 스스로 시간을 민다(onTick) */
export function ReelStage({
  reel,
  t,
  playing,
  muted,
  onTick,
  onEnd,
}: {
  reel: Reel;
  t: number;
  playing: boolean;
  muted: boolean;
  onTick: (t: number) => void;
  onEnd?: () => void;
}) {
  const clips = reel.clips;
  const total = lengthOf(reel);
  const starts = startsOf(clips);
  const tRef = useRef(t);
  tRef.current = t;
  const videos = useRef<Record<number, HTMLVideoElement | null>>({});
  const audio = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    if (!playing || total <= 0) return;
    let raf = 0;
    let last = performance.now();
    const step = (now: number) => {
      const next = tRef.current + (now - last) / 1000;
      last = now;
      if (next >= total) {
        onTick(total);
        onEnd?.();
        return;
      }
      onTick(next);
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [playing, total]);

  const i = clipAt(clips, t);
  const under = underOf(clips, i, t);

  // 영상 컷: 보이는 동안만 튼다. 시간이 어긋나면 맞춘다
  useEffect(() => {
    clips.forEach((c, k) => {
      const v = videos.current[k];
      if (!v || c.kind !== 'video') return;
      const shown = k === i || k === under;
      if (!shown) {
        if (!v.paused) v.pause();
        return;
      }
      const local = c.from + Math.min(c.dur, Math.max(0, t - starts[k]!));
      if (Math.abs(v.currentTime - local) > 0.35) v.currentTime = local;
      v.muted = muted || !c.sound;
      if (!playing) {
        if (!v.paused) v.pause();
      } else if (v.paused) {
        v.play().catch(() => {
          v.muted = true;
          v.play().catch(() => {});
        });
      }
    });
  });

  // 음악: 영상과 같이 가고, 끝에서 줄어든다
  useEffect(() => {
    const a = audio.current;
    if (!a || !reel.music) return;
    const want = reel.musicFrom + t;
    if (Math.abs(a.currentTime - want) > 0.35) a.currentTime = want;
    a.volume = musicVolume(reel, t);
    a.muted = muted;
    if (!playing) {
      if (!a.paused) a.pause();
    } else if (a.paused) a.play().catch(() => {});
  });

  const cur = clips[i];
  return (
    <div className={`reelstage ${reel.ratio}`}>
      {clips.map((c, k) => {
        const shown = k === i || k === under;
        const m = motionAt(c.motion, k === i ? progressIn(clips, k, t) : 1);
        const style = {
          opacity: k === i ? opacityOf(clips, k, t) : 1,
          zIndex: k === i ? 2 : 1,
          transform: `scale(${m.scale}) translateX(${m.x}%)`,
          visibility: shown ? ('visible' as const) : ('hidden' as const),
        };
        if (c.kind === 'image') return <img key={k} className="layer" src={imgUrl(c.src)} alt="" style={style} />;
        if (c.kind === 'video')
          return (
            <video
              key={k}
              className="layer"
              ref={(el) => {
                videos.current[k] = el;
              }}
              src={mediaUrl(c.src)}
              playsInline
              muted
              preload="auto"
              style={style}
            />
          );
        return <div key={k} className="layer black" style={style} />;
      })}
      {cur?.text && (
        <p className={`rtext ${cur.style}`} style={{ opacity: textOpacity(clips, i, t) }}>
          {cur.text}
        </p>
      )}
      {reel.music && <audio ref={audio} src={mediaUrl(reel.music)} preload="auto" />}
    </div>
  );
}

/** 필름에 들어가면 맨 먼저 흐르는 오프닝 영상. 건너뛸 수 있다 */
export function ReelOverlay({ reel, onDone }: { reel: Reel; onDone: () => void }) {
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [muted, setMuted] = useState(soundOff);
  const [leaving, setLeaving] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const total = lengthOf(reel);

  const end = () => {
    if (leaving) return;
    setPlaying(false);
    setLeaving(true);
    setTimeout(onDone, 600);
  };

  // 소리를 켜는 것은 누른 그 자리에서 튼다 — 휴대폰은 누르지 않으면 소리를 못 낸다
  const toggle = () => {
    const next = !muted;
    setMuted(next);
    setSoundOff(next);
    if (!next) box.current?.querySelectorAll<HTMLMediaElement>('audio, video').forEach((el) => void el.play().catch(() => {}));
  };

  return createPortal(
    <div className={leaving ? 'opener out' : 'opener'} role="dialog" aria-label="오프닝 영상" ref={box}>
      <div className="prog" aria-hidden="true">
        <i style={{ width: `${total > 0 ? (t / total) * 100 : 0}%` }} />
      </div>
      <ReelStage reel={reel} t={t} playing={playing} muted={muted} onTick={setT} onEnd={end} />
      <div className="ctl">
        <button className="snd" onClick={toggle} aria-label={muted ? '소리 켜기' : '소리 끄기'}>
          {muted ? <SoundOff /> : <Sound />}
        </button>
        <button className="skip" onClick={end}>
          건너뛰기
          <Next />
        </button>
      </div>
    </div>,
    document.body,
  );
}

const RATIOS: { value: ReelRatio; label: string }[] = [
  { value: 'tall', label: '세로' },
  { value: 'wide', label: '가로' },
  { value: 'cine', label: '시네마' },
];
const MOTIONS: { value: ReelMotion; label: string }[] = [
  { value: 'none', label: '없음' },
  { value: 'in', label: '다가가기' },
  { value: 'out', label: '물러나기' },
  { value: 'left', label: '왼쪽으로' },
  { value: 'right', label: '오른쪽으로' },
];
const ENTERS: { value: ReelEnter; label: string }[] = [
  { value: 'cut', label: '바로' },
  { value: 'fade', label: '서서히' },
  { value: 'black', label: '암전' },
];
const STYLES: { value: ReelStyle; label: string }[] = [
  { value: 'title', label: '제목' },
  { value: 'sub', label: '자막' },
  { value: 'credit', label: '크레딧' },
];

/** 타임라인에서 1초의 너비(px) */
const PX = 16;

function Pick<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="row2">
      <p className="lbl">{label}</p>
      <div className="chips2" role="group" aria-label={label}>
        {options.map((o) => (
          <button key={o.value} className={o.value === value ? 'on' : ''} aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function Slider({ label, value, min, max, step = 0.5, unit = '초', onChange }: { label: string; value: number; min: number; max: number; step?: number; unit?: string; onChange: (v: number) => void }) {
  return (
    <div className="row2">
      <p className="lbl">{label}</p>
      <div className="slider">
        <input type="range" min={min} max={Math.max(min, max)} step={step} value={value} aria-label={label} onChange={(e) => onChange(Number(e.target.value))} />
        <b>
          {value.toFixed(1)}
          {unit}
        </b>
      </div>
    </div>
  );
}

/** 오프닝 영상 편집기. 미리 보기, 타임라인, 고른 컷의 길이·움직임·전환·글자, 음악 */
export function ReelEditor({ reel, onChange, onError }: { reel: Reel | null; onChange: (r: Reel | null) => void; onError: (msg: string) => void }) {
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [sel, setSel] = useState(0);
  const [work, setWork] = useState('');
  const r = reel ?? blankReel();
  const clips = r.clips;
  const total = lengthOf(r);
  const starts = startsOf(clips);
  const at = Math.min(sel, Math.max(0, clips.length - 1));
  const cur = clips[at];

  useEffect(() => {
    if (t > total) setT(total);
  }, [total]);

  const put = (next: Reel) => onChange(next.clips.length === 0 && !next.music ? null : next);
  const setClip = (patch: Partial<ReelClip>) => put({ ...r, clips: clips.map((c, k) => (k === at ? { ...c, ...patch } : c)) });
  const seek = (v: number) => {
    setPlaying(false);
    setT(Math.max(0, Math.min(total, v)));
  };
  /** 컷의 첫 화면. 서서히 들어오는 컷은 다 밝아진 자리를 보인다 */
  const shownAt = (list: ReelClip[], k: number) => (startsOf(list)[k] ?? 0) + (list[k] && list[k]!.enter !== 'cut' ? Math.min(R.fade, list[k]!.dur / 2) : 0);
  const add = (c: ReelClip) => {
    if (clips.length >= R.clips) return onError(`컷은 ${R.clips}개까지 넣을 수 있어요.`);
    if (total + c.dur > R.total) return onError(`오프닝 영상은 ${R.total / 60}분까지예요.`);
    const next = [...clips.slice(0, at + 1), c, ...clips.slice(at + 1)];
    const k = clips.length === 0 ? 0 : at + 1;
    const list = clips.length === 0 ? [c] : next;
    put({ ...r, clips: list });
    setSel(k);
    setPlaying(false);
    setT(shownAt(list, k));
  };
  const move = (by: number) => {
    const j = at + by;
    if (j < 0 || j >= clips.length) return;
    const next = [...clips];
    [next[at], next[j]] = [next[j]!, next[at]!];
    put({ ...r, clips: next });
    setSel(j);
  };

  const run = async (label: string, job: () => Promise<void>) => {
    setWork(label);
    onError('');
    try {
      await job();
    } catch (e) {
      onError(e instanceof ApiFail ? e.message : '파일을 올리지 못했어요.');
    }
    setWork('');
  };
  const pickImage = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) void run('그림을 올리는 중', async () => add(newClip('image', await uploadImage(file, 1440))));
  };
  const pickVideo = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    void run('영상을 줄이는 중', async () => {
      const small = await shrinkVideo(file, (p) => setWork(`영상을 줄이는 중 ${Math.round(p * 100)}%`));
      const id = await uploadMedia(small.blob, small.mime, (p) => setWork(`영상을 올리는 중 ${Math.round(p * 100)}%`));
      const len = Math.round(small.seconds * 10) / 10;
      add({ ...newClip('video', id, Math.max(R.minDur, Math.min(R.maxDur, Math.floor(len * 2) / 2))), len });
    });
  };
  const pickMusic = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    void run('음악을 올리는 중', async () => {
      const url = URL.createObjectURL(file);
      const len = await mediaSeconds(url, 'audio');
      URL.revokeObjectURL(url);
      const id = await uploadMedia(file, audioType(file), (p) => setWork(`음악을 올리는 중 ${Math.round(p * 100)}%`));
      put({ ...r, music: id, musicName: file.name.slice(0, 80), musicFrom: 0, musicLen: Math.round(len * 10) / 10 });
    });
  };

  return (
    <div className="ed">
      {clips.length > 0 && (
        <>
          <ReelStage reel={r} t={t} playing={playing} muted={false} onTick={setT} onEnd={() => setPlaying(false)} />
          <div className="transport">
            <button
              className="pl"
              aria-label={playing ? '멈추기' : '틀기'}
              onClick={() => {
                if (!playing && t >= total) setT(0);
                setPlaying(!playing);
              }}
            >
              {playing ? <Pause /> : <PlayFill />}
            </button>
            <span className="t">
              {clock(t)} / {clock(total)}
            </span>
            <div className="ratio" role="group" aria-label="화면비">
              {RATIOS.map((o) => (
                <button key={o.value} className={r.ratio === o.value ? 'on' : ''} aria-pressed={r.ratio === o.value} onClick={() => put({ ...r, ratio: o.value })}>
                  {o.label}
                </button>
              ))}
            </div>
          </div>
          <input className="scrub" type="range" min={0} max={total} step={0.1} value={t} aria-label="재생 위치" onChange={(e) => seek(Number(e.target.value))} />

          <div className="tl">
            <div className="film" style={{ width: Math.max(total * PX, 10) + 24 }}>
              <div className="clips">
                {clips.map((c, k) => (
                  <button
                    key={k}
                    className={`clip ${c.kind}${k === at ? ' on' : ''}`}
                    style={{ width: Math.max(28, c.dur * PX - 2) }}
                    aria-label={`컷 ${k + 1}`}
                    aria-pressed={k === at}
                    onClick={() => {
                      setSel(k);
                      seek(shownAt(clips, k));
                    }}
                  >
                    {c.kind === 'image' && <img src={imgUrl(c.src)} alt="" />}
                    {c.kind === 'video' && <span className="vid">영상</span>}
                    {k > 0 && c.enter !== 'cut' && <i className={`tr ${c.enter}`} aria-hidden="true" />}
                    {c.text && <span className="tx">글자</span>}
                    <b>{c.dur.toFixed(1)}</b>
                  </button>
                ))}
              </div>
              <span className="phead" style={{ left: 12 + t * PX }} aria-hidden="true" />
            </div>
            {r.music && (
              <div className="music">
                <span>음악</span>
                <b>{r.musicName || '음악'}</b>
              </div>
            )}
          </div>
        </>
      )}

      <div className="adds">
        <label className={work ? 'add off' : 'add'}>
          + 그림
          <input type="file" accept="image/jpeg,image/png,image/webp" disabled={!!work} aria-label="그림 컷 넣기" onChange={pickImage} />
        </label>
        <label className={work ? 'add off' : 'add'}>
          + 영상
          <input type="file" accept="video/*" disabled={!!work} aria-label="영상 컷 넣기" onChange={pickVideo} />
        </label>
        <button className="add" disabled={!!work} onClick={() => add(newClip('black', '', 2))}>
          + 검은 화면
        </button>
        <label className={work ? 'add off' : 'add'}>
          + 음악
          <input type="file" accept="audio/*,.mp3,.m4a,.wav,.ogg" disabled={!!work} aria-label="음악 넣기" onChange={pickMusic} />
        </label>
      </div>
      {work && (
        <p className="hint" role="status">
          {work}
        </p>
      )}
      <p className="hint">영상은 올릴 때 줄여서 화질이 깨질 수 있어요.</p>

      {cur && (
        <div className="selbox">
          <p className="h">
            컷 {at + 1}
            <span>
              {cur.kind === 'image' ? '그림' : cur.kind === 'video' ? '영상' : '검은 화면'} · {clock(starts[at]!)} ~ {clock(starts[at]! + cur.dur)}
            </span>
          </p>
          <Slider
            label="길이"
            value={cur.dur}
            min={R.minDur}
            max={cur.kind === 'video' && cur.len ? Math.min(R.maxDur, Math.max(R.minDur, cur.len - cur.from)) : R.maxDur}
            onChange={(v) => setClip({ dur: v })}
          />
          {cur.kind === 'video' && cur.len ? (
            <Slider label="시작 지점" value={cur.from} min={0} max={Math.max(0, cur.len - cur.dur)} onChange={(v) => setClip({ from: v })} />
          ) : null}
          {cur.kind !== 'black' && <Pick label="움직임" value={cur.motion} options={MOTIONS} onChange={(v) => setClip({ motion: v })} />}
          <Pick label="전환" value={cur.enter} options={ENTERS} onChange={(v) => setClip({ enter: v })} />
          <div className="row2">
            <p className="lbl">글자</p>
            <input value={cur.text} maxLength={R.text} placeholder="예) 금요일 오후" aria-label="글자" onChange={(e) => setClip({ text: e.target.value })} />
          </div>
          {cur.text && <Pick label="글자 모양" value={cur.style} options={STYLES} onChange={(v) => setClip({ style: v })} />}
          {cur.kind === 'video' && (
            <Pick label="소리" value={cur.sound ? 'on' : 'off'} options={[{ value: 'on', label: '켜기' }, { value: 'off', label: '끄기' }]} onChange={(v) => setClip({ sound: v === 'on' })} />
          )}
          <div className="acts2">
            <button disabled={at === 0} onClick={() => move(-1)}>
              ← 앞으로
            </button>
            <button disabled={at === clips.length - 1} onClick={() => move(1)}>
              뒤로 →
            </button>
            <button onClick={() => add({ ...cur })}>복제</button>
            <button
              onClick={() => {
                put({ ...r, clips: clips.filter((_, k) => k !== at) });
                setSel(Math.max(0, at - 1));
              }}
            >
              지우기
            </button>
          </div>
        </div>
      )}

      {r.music && (
        <div className="selbox">
          <p className="h">
            음악<span>{r.musicName}</span>
          </p>
          {r.musicLen ? <Slider label="시작 지점" value={r.musicFrom} min={0} max={Math.max(0, r.musicLen - 1)} onChange={(v) => put({ ...r, musicFrom: v })} /> : null}
          <div className="acts2">
            <button onClick={() => put({ ...r, music: '', musicName: '', musicFrom: 0, musicLen: undefined })}>음악 빼기</button>
          </div>
        </div>
      )}
    </div>
  );
}
