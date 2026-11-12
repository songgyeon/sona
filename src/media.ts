/* 소리와 영상 올리기 — 배경 음악, 오프닝 영상의 음악과 영상 컷.
   커서 나눠서 보낸다(RULES.media.part). 영상은 올리기 전에 이 기기에서 줄인다:
   긴 변 RULES.media.edge 픽셀, 초당 RULES.media.bitrate 비트로 다시 녹화한다. 그래서 화질이 떨어질 수 있다. */

import { RULES } from '../shared/rules';
import { ApiFail, getKey, visitor } from './api';

const M = RULES.media;

/** 올려 둔 소리나 영상의 주소 */
export const mediaUrl = (id: string): string => `/api/media/${id}`;

async function req<T>(method: string, path: string, body: BodyInit, type: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers: { 'x-sona-key': encodeURIComponent(getKey() ?? ''), 'x-sona-visitor': visitor(), 'content-type': type },
      body,
    });
  } catch {
    throw new ApiFail(0, 'network', '연결이 끊겼어요. 다시 시도해 주세요.');
  }
  const data = (await res.json().catch(() => null)) as { error?: string; message?: string } | null;
  if (!res.ok) throw new ApiFail(res.status, data?.error ?? 'http', data?.message ?? '파일을 올리지 못했어요.');
  return data as T;
}

/** 나눠서 올린다. 조각 하나가 연결 문제로 실패하면 두 번까지 다시 보낸다. done은 0~1 */
export async function uploadMedia(blob: Blob, mime: string, onProgress?: (done: number) => void): Promise<string> {
  const { id, part } = await req<{ id: string; part: number }>('POST', '/api/media', JSON.stringify({ mime, size: blob.size }), 'application/json');
  const n = Math.ceil(blob.size / part);
  for (let i = 0; i < n; i++) {
    const chunk = blob.slice(i * part, Math.min(blob.size, (i + 1) * part));
    for (let tries = 0; ; tries++) {
      try {
        await req('PUT', `/api/media/${id}/parts/${i}`, chunk, 'application/octet-stream');
        break;
      } catch (e) {
        if (tries >= 2 || (e instanceof ApiFail && e.status >= 400 && e.status < 500)) throw e;
      }
    }
    onProgress?.((i + 1) / n);
  }
  await req('POST', `/api/media/${id}/done`, '{}', 'application/json');
  return id;
}

/** 음악 파일의 종류. 브라우저가 이름표를 안 붙이는 파일은 이름 끝으로 본다 */
export function audioType(file: File): string {
  if (file.type) return file.type;
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  return { mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', wav: 'audio/wav', ogg: 'audio/ogg' }[ext] ?? '';
}

/** 소리나 영상의 길이(초). 못 읽으면 0 */
export function mediaSeconds(src: string, kind: 'audio' | 'video'): Promise<number> {
  return new Promise((done) => {
    const el = document.createElement(kind);
    el.preload = 'metadata';
    el.onloadedmetadata = () => done(Number.isFinite(el.duration) ? el.duration : 0);
    el.onerror = () => done(0);
    el.src = src;
  });
}

function openVideo(url: string): Promise<HTMLVideoElement> {
  return new Promise((ok, no) => {
    const v = document.createElement('video');
    v.preload = 'auto';
    v.playsInline = true;
    v.muted = true;
    v.onloadedmetadata = () => ok(v);
    v.onerror = () => no(new ApiFail(400, 'media_broken', '이 기기에서 열 수 없는 영상이에요.'));
    v.src = url;
  });
}

/** 다시 녹화할 때 쓰는 모양. 어디서나 재생되는 mp4를 먼저 */
const RECORD = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];

/** 영상을 줄인다. 영상 길이만큼 걸린다(끝까지 틀면서 다시 녹화한다). 이 브라우저가 다시 녹화하지 못하면 원래 파일을 그대로 쓴다 */
export async function shrinkVideo(file: File, onProgress?: (done: number) => void): Promise<{ blob: Blob; mime: string; seconds: number }> {
  const url = URL.createObjectURL(file);
  try {
    const v = await openVideo(url);
    const seconds = v.duration;
    if (!Number.isFinite(seconds) || seconds <= 0) throw new ApiFail(400, 'media_broken', '영상의 길이를 읽지 못했어요.');
    if (seconds > M.videoSec + 0.5) throw new ApiFail(413, 'media_long', `영상은 ${M.videoSec}초까지 올릴 수 있어요.`);
    const type = typeof MediaRecorder === 'undefined' ? undefined : RECORD.find((t) => MediaRecorder.isTypeSupported(t));
    // 그대로 재생되는 파일이 한도 안이면 다시 녹화하지 않는다 — 다시 녹화하면 화질이 떨어진다
    const small = /^video\/(mp4|webm)$/.test(file.type) && file.size <= M.keep;
    if (small || !type || !v.videoWidth) {
      if (file.size > M.video) throw new ApiFail(413, 'media_big', `영상은 ${M.video / 1_000_000}MB까지 올릴 수 있어요.`);
      return { blob: file, mime: file.type || 'video/mp4', seconds };
    }

    // 크기 한도 안에서 길이에 맞춰 가장 높은 비트로 녹화한다. 짧은 영상일수록 선명하다. 비트가 넉넉하면 더 크게
    const budget = (M.video * 8 * 0.85) / seconds - 128_000;
    const bitrate = Math.round(Math.min(M.bitrateMax, Math.max(M.bitrate, budget)));
    const edge = bitrate >= 5_000_000 ? M.edgeHigh : M.edge;
    const scale = Math.min(1, edge / Math.max(v.videoWidth, v.videoHeight));
    const w = Math.max(2, Math.round((v.videoWidth * scale) / 2) * 2);
    const h = Math.max(2, Math.round((v.videoHeight * scale) / 2) * 2);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const g = canvas.getContext('2d')!;
    const stream = canvas.captureStream(30);
    // 소리는 웹 오디오로 받아 녹화에 싣는다. 스피커로는 내보내지 않는다
    let ac: AudioContext | null = null;
    try {
      ac = new AudioContext();
      const dest = ac.createMediaStreamDestination();
      ac.createMediaElementSource(v).connect(dest);
      for (const t of dest.stream.getAudioTracks()) stream.addTrack(t);
      v.muted = false;
    } catch {
      ac = null;
      v.muted = true;
    }
    const rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: bitrate, audioBitsPerSecond: 128_000 });
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    const stopped = new Promise<void>((ok) => (rec.onstop = () => ok()));
    const ended = new Promise<void>((ok) => (v.onended = () => ok()));
    let running = true;
    const draw = () => {
      if (!running) return;
      g.drawImage(v, 0, 0, w, h);
      onProgress?.(Math.min(1, v.currentTime / seconds));
      requestAnimationFrame(draw);
    };
    rec.start(1000);
    try {
      await ac?.resume();
      await v.play();
    } catch {
      // 소리를 내며 틀 수 없는 때(자동 재생 막힘). 소리 없이 줄인다
      v.muted = true;
      await v.play();
    }
    draw();
    await ended;
    running = false;
    rec.stop();
    await stopped;
    await ac?.close().catch(() => {});
    const mime = type.split(';')[0]!;
    const blob = new Blob(chunks, { type: mime });
    if (blob.size > M.video) throw new ApiFail(413, 'media_big', `영상은 ${M.video / 1_000_000}MB까지 올릴 수 있어요.`);
    return { blob, mime, seconds };
  } finally {
    URL.revokeObjectURL(url);
  }
}
