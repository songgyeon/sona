import { describe, expect, it } from 'vitest';
import { fromFilm, readDraft, toFilm } from '../../shared/draft';
import { readFilm } from '../../shared/opening';
import { clipAt, layersOf, lengthOf, motionAt, musicVolume, newClip, newText, opacityOf, startsOf, textOpacity, underOf } from '../../shared/reel';
import { FONTS } from '../../shared/fonts';
import { RULES } from '../../shared/rules';
import type { Film, Reel } from '../../shared/types';
import { Fail } from '../../worker/engine/ctx';
import { createFilm, getFilm, parseFilm, updateFilm } from '../../worker/engine/films';
import { finishMedia, putPart, startMedia } from '../../worker/engine/media';
import { DEV_FILM, testCtx } from '../helpers/film';

const IMG = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

/** 그림 셋: 서서히 들어오는 첫 컷 3초, 바로 붙는 둘째 2초, 검은 화면 거쳐 오는 셋째 4초 */
const REEL: Reel = {
  ratio: 'wide',
  clips: [
    { ...newClip('image', IMG, 3), enter: 'fade', text: '금요일 오후', style: 'title' },
    { ...newClip('image', IMG, 2), enter: 'cut' },
    { ...newClip('black', '', 4), enter: 'black', text: '동네 서점', style: 'credit' },
  ],
  music: '',
  musicName: '',
  musicFrom: 0,
};

async function fail(p: () => unknown): Promise<string | null> {
  try {
    await p();
  } catch (e) {
    if (e instanceof Fail) return e.message;
    throw e;
  }
  return null;
}

/** 머리만 진짜인 소리·영상을 올린다 */
async function upload(ctx: ReturnType<typeof testCtx>, mime: string): Promise<string> {
  const b = new Uint8Array(64);
  if (mime.startsWith('video')) b.set([0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70]);
  else b.set([0x49, 0x44, 0x33]);
  const { id } = await startMedia(ctx, { mime, size: b.length });
  await putPart(ctx, id, 0, b);
  await finishMedia(ctx, id);
  return id;
}

describe('오프닝 영상의 셈', () => {
  it('컷마다 시작하는 때와 전체 길이', () => {
    expect(startsOf(REEL.clips)).toEqual([0, 3, 5]);
    expect(lengthOf(REEL)).toBe(9);
    expect(lengthOf(null)).toBe(0);
    expect([0, 2.9, 3, 4.99, 5, 9].map((t) => clipAt(REEL.clips, t))).toEqual([0, 0, 1, 1, 2, 2]);
  });

  it('서서히 들어오고, 다음 컷이 검은 화면을 거쳐 오면 끝에서 어두워진다. 바로 붙으면 그대로', () => {
    const f = RULES.reel.fade;
    expect(opacityOf(REEL.clips, 0, 0)).toBe(0);
    expect(opacityOf(REEL.clips, 0, f / 2)).toBeCloseTo(0.5);
    expect(opacityOf(REEL.clips, 0, 1.5)).toBe(1);
    expect(opacityOf(REEL.clips, 1, 3)).toBe(1); // 바로 붙는다
    expect(opacityOf(REEL.clips, 1, 5 - f / 2)).toBeCloseTo(0.5); // 다음이 검은 화면을 거쳐 온다
    expect(opacityOf(REEL.clips, 2, 5)).toBe(0);
  });

  it('서서히 넘어오는 동안에만 앞 컷을 밑에 깐다', () => {
    const fadeIn = [newClip('image', IMG, 3), { ...newClip('image', IMG, 3), enter: 'fade' as const }];
    expect(underOf(fadeIn, 1, 3.1)).toBe(0);
    expect(underOf(fadeIn, 1, 3 + RULES.reel.fade + 0.01)).toBeNull();
    expect(underOf(REEL.clips, 1, 3.1)).toBeNull();
  });

  it('움직임: 다가가면 커지고, 물러나면 작아지고, 옆으로 흐른다', () => {
    expect(motionAt('in', 0).scale).toBe(1);
    expect(motionAt('in', 1).scale).toBeCloseTo(1.12);
    expect(motionAt('out', 1).scale).toBe(1);
    expect(motionAt('left', 0).x).toBe(4);
    expect(motionAt('left', 1).x).toBe(-4);
    expect(motionAt('none', 0.5)).toEqual({ scale: 1, x: 0 });
  });

  it('글자는 컷의 처음과 끝에서 서서히. 음악은 끝에서 줄어든다', () => {
    expect(textOpacity(REEL.clips, 0, 0)).toBe(0);
    expect(textOpacity(REEL.clips, 0, 1.5)).toBe(1);
    expect(textOpacity(REEL.clips, 1, 4)).toBe(0); // 글자가 없다
    // 글자 여러 개로 넣은 컷(예전 글자 칸은 비어 있다)도 같다
    const layered = [{ ...REEL.clips[0]!, text: '', texts: [newText('금요일 오후'), newText('동네 서점')] }];
    expect(textOpacity(layered, 0, 1.5)).toBe(1);
    expect(textOpacity([{ ...layered[0]!, texts: [] }], 0, 1.5)).toBe(0);
    expect(musicVolume(REEL, 0)).toBe(1);
    expect(musicVolume(REEL, 9)).toBe(0);
  });
});

describe('오프닝 영상: 필름에 넣기', () => {
  it('그대로 저장되고, 컷이 없으면 없는 것이다', () => {
    const film = parseFilm({ ...DEV_FILM, reel: REEL });
    expect(film.reel).toEqual(REEL);
    expect(parseFilm({ ...DEV_FILM, reel: { ...REEL, clips: [] } }).reel).toBeNull();
    expect(parseFilm(DEV_FILM).reel).toBeNull();
  });

  it('길이, 컷 수, 전체 길이를 넘으면 어디인지 말하고 거절한다. 그림 없는 그림 컷도', async () => {
    expect(await fail(() => parseFilm({ ...DEV_FILM, reel: { ...REEL, clips: [{ ...REEL.clips[0], dur: RULES.reel.maxDur + 1 }] } }))).toContain('컷의 길이');
    expect(await fail(() => parseFilm({ ...DEV_FILM, reel: { ...REEL, clips: Array.from({ length: RULES.reel.clips + 1 }, () => REEL.clips[1]) } }))).toContain(`${RULES.reel.clips}개`);
    const long = Array.from({ length: 10 }, () => ({ ...REEL.clips[1], dur: RULES.reel.maxDur }));
    expect(await fail(() => parseFilm({ ...DEV_FILM, reel: { ...REEL, clips: long } }))).toContain('분까지');
    expect(await fail(() => parseFilm({ ...DEV_FILM, reel: { ...REEL, clips: [{ ...REEL.clips[0], src: '' }] } }))).toContain('그림이나 영상');
  });

  it('배경 음악, 영상 컷, 오프닝 음악은 정말 올라간 것이어야 하고 종류도 맞아야 한다', async () => {
    const ctx = testCtx();
    const song = await upload(ctx, 'audio/mpeg');
    const clip = await upload(ctx, 'video/mp4');
    const reel: Reel = { ...REEL, clips: [...REEL.clips, { ...newClip('video', clip, 4), from: 1.5 }], music: song, musicName: '비 오는 서점.mp3', musicFrom: 12 };
    const { id } = await createFilm(ctx, { ...DEV_FILM, bgm: song, bgmName: '비 오는 서점.mp3', reel });
    const got = (await getFilm(ctx, id)).film;
    expect(got.bgm).toBe(song);
    expect(got.reel!.clips[3]).toMatchObject({ kind: 'video', src: clip, from: 1.5, sound: true });
    expect(got.reel!.musicFrom).toBe(12);
    // 영상 자리에 음악, 음악 자리에 영상, 없는 파일
    expect(await fail(() => updateFilm(ctx, id, { ...DEV_FILM, bgm: clip }))).toContain('배경 음악');
    expect(await fail(() => updateFilm(ctx, id, { ...DEV_FILM, reel: { ...reel, clips: [newClip('video', song)] } }))).toContain('영상');
    expect(await fail(() => createFilm(ctx, { ...DEV_FILM, bgm: 'ffffffff-ffff-4fff-8fff-ffffffffffff' }))).toContain('배경 음악');
  });

  it('만드는 화면으로 되돌려도 남고, 이 칸이 없던 때의 필름과 쓰다 만 것은 없는 것으로 읽힌다', () => {
    const film = parseFilm({ ...DEV_FILM, reel: REEL, bgm: IMG, bgmName: 'a.mp3' });
    const d = fromFilm(film);
    expect(d.reel).toEqual(REEL);
    expect(d.bgm).toBe(IMG);
    const back = parseFilm(toFilm(d));
    expect(back.reel).toEqual(REEL);
    expect(back.bgmName).toBe('a.mp3');
    const old = JSON.parse(JSON.stringify(parseFilm(DEV_FILM))) as Film;
    delete old.reel;
    delete old.bgm;
    expect(readFilm(old).reel).toBeNull();
    expect(readFilm(old).bgm).toBe('');
    expect(readDraft({ title: '쓰다 만 것' }).reel).toBeNull();
  });
});

describe('오프닝 영상: 컷 위의 글자', () => {
  it('글자 덩이마다 글꼴, 크기, 자리, 정렬, 색이 저장된다. 비운 글자는 버리고, 모르는 글꼴은 첫 글꼴로 읽는다', () => {
    const texts = [
      { ...newText('금요일 오후'), font: 'nanum-brush-script', size: 12, x: 30, y: 20, align: 'left', color: 'black' },
      { ...newText(''), font: 'jua' },
      { ...newText('동네 서점'), font: '없는 글꼴' },
    ];
    const film = parseFilm({ ...DEV_FILM, reel: { ...REEL, clips: [{ ...REEL.clips[0], text: '', texts }] } });
    expect(film.reel!.clips[0]!.texts).toEqual([
      { text: '금요일 오후', font: 'nanum-brush-script', size: 12, x: 30, y: 20, align: 'left', color: 'black' },
      { text: '동네 서점', font: FONTS[0]!.key, size: RULES.reel.textSize, x: 50, y: 50, align: 'center', color: 'white' },
    ]);
  });

  it('컷 하나에 글자는 정해진 수까지. 크기와 자리는 정해진 범위 안이어야 한다', async () => {
    const many = Array.from({ length: RULES.reel.texts + 1 }, (_, i) => newText(`글자 ${i}`));
    expect(await fail(() => parseFilm({ ...DEV_FILM, reel: { ...REEL, clips: [{ ...REEL.clips[0], texts: many }] } }))).toContain(`${RULES.reel.texts}개`);
    expect(await fail(() => parseFilm({ ...DEV_FILM, reel: { ...REEL, clips: [{ ...REEL.clips[0], texts: [{ ...newText('가'), size: 99 }] }] } }))).toContain('글자 크기');
    expect(await fail(() => parseFilm({ ...DEV_FILM, reel: { ...REEL, clips: [{ ...REEL.clips[0], texts: [{ ...newText('가'), x: 140 }] }] } }))).toContain('글자 자리');
  });

  it('예전 컷의 글자 하나도 같은 모양으로 읽는다: 제목은 가운데 명조, 자막과 크레딧은 아래 고딕', () => {
    expect(layersOf(REEL.clips[0]!)).toEqual([{ ...newText('금요일 오후') }]);
    expect(layersOf(REEL.clips[1]!)).toEqual([]);
    const credit = layersOf(REEL.clips[2]!);
    expect(credit).toHaveLength(1);
    expect(credit[0]).toMatchObject({ text: '동네 서점', font: 'pretendard' });
    expect(credit[0]!.y).toBeGreaterThan(80);
    // 글자들이 있으면 그것을 읽는다
    expect(layersOf({ ...REEL.clips[0]!, texts: [] })).toEqual([]);
  });

  it('만드는 화면으로 되돌려도 글자들이 남는다', () => {
    const texts = [{ ...newText('금요일 오후'), font: 'jua', size: 9, x: 40, y: 70, align: 'right' as const, color: 'white' as const }];
    const film = parseFilm({ ...DEV_FILM, reel: { ...REEL, clips: [{ ...REEL.clips[0], text: '', texts }] } });
    const again = parseFilm(toFilm(fromFilm(film)));
    expect(again.reel!.clips[0]!.texts).toEqual(texts);
  });
});
