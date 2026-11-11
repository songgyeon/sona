import { describe, expect, it } from 'vitest';
import { RULES } from '../../shared/rules';
import { Fail } from '../../worker/engine/ctx';
import { createFilm, getFilm, listFilms, parseFilm } from '../../worker/engine/films';
import { loadImage, saveImage } from '../../worker/engine/images';
import { listPlays } from '../../worker/engine/store';
import { enter } from '../../worker/engine/turn';
import { DEV_FILM, testCtx, uid } from '../helpers/film';

/** 머리만 진짜인 작은 그림 */
const jpeg = (size = 64) => {
  const b = new Uint8Array(size);
  b.set([0xff, 0xd8, 0xff, 0xe0]);
  for (let i = 4; i < size; i++) b[i] = i % 251;
  return b;
};
const png = () => Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const webp = () => Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 9, 9]);

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'ok';
  } catch (e) {
    if (e instanceof Fail) return e.code;
    throw e;
  }
}

describe('그림', () => {
  it('올린 그림을 그대로 돌려준다', async () => {
    const ctx = testCtx();
    const sent = jpeg(300);
    const { id } = await saveImage(ctx, 'image/jpeg', sent);
    const got = await loadImage(ctx.db, id);
    expect(got?.mime).toBe('image/jpeg');
    expect(Array.from(got!.bytes)).toEqual(Array.from(sent));
  });

  it('JPG, PNG, WEBP만 받는다', async () => {
    const ctx = testCtx();
    expect(await code(saveImage(ctx, 'image/png', png()))).toBe('ok');
    expect(await code(saveImage(ctx, 'image/webp; charset=binary', webp()))).toBe('ok');
    expect(await code(saveImage(ctx, 'image/gif', jpeg()))).toBe('image_kind');
    expect(await code(saveImage(ctx, 'text/html', jpeg()))).toBe('image_kind');
  });

  it('이름표만 그림이고 속이 다르면 받지 않는다', async () => {
    const ctx = testCtx();
    const html = new TextEncoder().encode('<script>alert(1)</script>');
    expect(await code(saveImage(ctx, 'image/jpeg', html))).toBe('image_broken');
    expect(await code(saveImage(ctx, 'image/png', jpeg()))).toBe('image_broken');
  });

  it('비었거나 너무 크면 받지 않는다', async () => {
    const ctx = testCtx();
    expect(await code(saveImage(ctx, 'image/jpeg', new ArrayBuffer(0)))).toBe('image_empty');
    expect(await code(saveImage(ctx, 'image/jpeg', jpeg(RULES.limits.image + 1)))).toBe('image_big');
    expect(await code(saveImage(ctx, 'image/jpeg', jpeg(RULES.limits.image)))).toBe('ok');
  });

  it('없는 그림은 없다고 한다', async () => {
    expect(await loadImage(testCtx().db, uid())).toBeNull();
  });
});

describe('필름에 건 그림', () => {
  it('포스터, 캐스트의 얼굴, 컷이 필름과 함께 남는다', async () => {
    const ctx = testCtx();
    const poster = (await saveImage(ctx, 'image/jpeg', jpeg())).id;
    const face = (await saveImage(ctx, 'image/jpeg', jpeg())).id;
    const still = (await saveImage(ctx, 'image/jpeg', jpeg())).id;
    const casts = (DEV_FILM as { casts: object[] }).casts.map((c, i) => (i === 0 ? { ...c, face } : c));
    const { id } = await createFilm(ctx, { ...DEV_FILM, poster, stills: [still], casts });

    const { card, film } = await getFilm(ctx, id);
    expect(card.poster).toBe(poster);
    expect(film.casts[0]!.face).toBe(face);
    expect(film.casts[1]!.face).toBe('');
    expect(film.stills).toEqual([still]);
    expect((await listFilms(ctx))[0]!.poster).toBe(poster);

    // 살고 있는 삶의 카드에도 포스터가 따라온다
    await enter(ctx, id, uid());
    const plays = await listPlays(ctx);
    expect(plays[0]).toMatchObject({ poster, logline: film.logline, castNames: film.casts.map((c) => c.name) });
  });

  it('그림이 없어도 필름이 된다', () => {
    const film = parseFilm(DEV_FILM);
    expect(film.poster).toBe('');
    expect(film.stills).toEqual([]);
    expect(film.casts.every((c) => c.face === '')).toBe(true);
  });

  it('그림 자리에 다른 값을 넣으면 거절한다', async () => {
    expect(await code(Promise.resolve().then(() => parseFilm({ ...DEV_FILM, poster: 'javascript:alert(1)' })))).toBe('film_invalid');
    expect(await code(Promise.resolve().then(() => parseFilm({ ...DEV_FILM, stills: ['../etc'] })))).toBe('film_invalid');
    const many = Array.from({ length: RULES.limits.stills + 1 }, () => uid());
    expect(await code(Promise.resolve().then(() => parseFilm({ ...DEV_FILM, stills: many })))).toBe('film_invalid');
  });
});
