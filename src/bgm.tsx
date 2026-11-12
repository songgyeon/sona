/* 배경 음악 — 필름 안에서 처음부터 끝까지 반복해 흐른다.
   재생 화면 위의 스피커로 켜고 끈다. 끈 것은 이 기기에 기억한다(오프닝 영상의 소리와 같이).
   휴대폰은 누르지 않으면 소리를 못 낸다. 막히면 꺼진 것으로 보이고, 누르면 그 자리에서 튼다. */

import { type ChangeEvent, useEffect, useRef, useState } from 'react';
import { ApiFail } from './api';
import { Plus } from './icons';
import { audioType, mediaUrl, uploadMedia } from './media';
import { setSoundOff, soundOff } from './reel';
import { soundEl } from './sound';

/** 재생 화면에서 배경 음악을 튼다. active가 거짓이면(오프닝 영상이 흐르는 동안 등) 멈춘다 */
export function useBgm(id: string, active: boolean): { has: boolean; on: boolean; toggle: () => void } {
  const [off, setOff] = useState(soundOff);
  const [blocked, setBlocked] = useState(false);
  const audio = useRef<HTMLAudioElement | null>(null);

  // 앱을 처음 누를 때 깨워 둔 소리 칸으로 낸다(src/sound.ts) — 휴대폰에서도 바로 나온다
  useEffect(() => {
    if (!id) return;
    const a = soundEl('bgm');
    a.src = mediaUrl(id);
    a.loop = true;
    a.volume = 0.45;
    a.preload = 'auto';
    audio.current = a;
    return () => {
      a.pause();
      audio.current = null;
    };
  }, [id]);

  useEffect(() => {
    const a = audio.current;
    if (!a) return;
    if (!active || off) {
      a.pause();
      return;
    }
    a.play()
      .then(() => setBlocked(false))
      .catch(() => setBlocked(true));
  }, [id, active, off]);

  const toggle = () => {
    const a = audio.current;
    if (off || blocked) {
      setOff(false);
      setSoundOff(false);
      a?.play()
        .then(() => setBlocked(false))
        .catch(() => setBlocked(true));
    } else {
      setOff(true);
      setSoundOff(true);
      a?.pause();
    }
  };
  return { has: !!id, on: !off && !blocked, toggle };
}

/** 필름 만들기의 배경 음악 칸: 넣기, 들어 보기, 빼기 */
export function BgmPick({ id, name, onChange, onError }: { id: string; name: string; onChange: (id: string, name: string) => void; onError: (msg: string) => void }) {
  const [work, setWork] = useState('');
  const [playing, setPlaying] = useState(false);
  const audio = useRef<HTMLAudioElement>(null);

  const pick = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setWork('음악을 올리는 중');
    onError('');
    try {
      const next = await uploadMedia(file, audioType(file), (p) => setWork(`음악을 올리는 중 ${Math.round(p * 100)}%`));
      onChange(next, file.name.slice(0, 80));
    } catch (x) {
      onError(x instanceof ApiFail ? x.message : '음악을 올리지 못했어요.');
    }
    setWork('');
  };

  const listen = () => {
    const a = audio.current;
    if (!a) return;
    if (playing) {
      a.pause();
      setPlaying(false);
    } else {
      void a.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
    }
  };

  return (
    <>
      {id ? (
        <div className="bgm">
          <span className={playing ? 'disc spin' : 'disc'} aria-hidden="true" />
          <div>
            <b>{name || '배경 음악'}</b>
            <small>반복해서 흘러요.</small>
          </div>
          <button onClick={listen}>{playing ? '멈추기' : '들어 보기'}</button>
          <button
            onClick={() => {
              audio.current?.pause();
              setPlaying(false);
              onChange('', '');
            }}
          >
            빼기
          </button>
          <audio ref={audio} src={mediaUrl(id)} loop preload="none" onPause={() => setPlaying(false)} />
        </div>
      ) : (
        <label className={work ? 'add off' : 'add'}>
          <Plus />
          음악 넣기
          <input type="file" accept="audio/*,.mp3,.m4a,.wav,.ogg" disabled={!!work} aria-label="배경 음악 고르기" onChange={(e) => void pick(e)} />
        </label>
      )}
      {work && (
        <p className="hint" role="status">
          {work}
        </p>
      )}
      <p className="hint">MP3, M4A, WAV, OGG 파일을 12MB까지 넣을 수 있어요.</p>
    </>
  );
}
