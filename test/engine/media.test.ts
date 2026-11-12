import { describe, expect, it } from 'vitest';
import { RULES } from '../../shared/rules';
import { Fail } from '../../worker/engine/ctx';
import { finishMedia, mediaType, putPart, serveMedia, startMedia } from '../../worker/engine/media';
import { OTHER_VISITOR, testCtx } from '../helpers/film';

const P = RULES.media.part;

/** 머리만 진짜인 음악 파일. 바이트마다 자리 값을 넣어 두어 어디를 내줬는지 알 수 있게 한다 */
function mp3(size: number): Uint8Array {
  const b = new Uint8Array(size);
  for (let i = 0; i < size; i++) b[i] = i % 251;
  b.set([0x49, 0x44, 0x33]); // ID3
  return b;
}
function mp4(size: number): Uint8Array {
  const b = mp3(size);
  b.set([0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70]); // ....ftyp
  return b;
}

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'ok';
  } catch (e) {
    if (e instanceof Fail) return e.code;
    throw e;
  }
}

/** 나눠서 다 올린다 */
async function upload(ctx: ReturnType<typeof testCtx>, mime: string, bytes: Uint8Array): Promise<string> {
  const { id, part } = await startMedia(ctx, { mime, size: bytes.length });
  for (let n = 0; n * part < bytes.length; n++) await putPart(ctx, id, n, bytes.slice(n * part, (n + 1) * part));
  await finishMedia(ctx, id);
  return id;
}

const body = async (r: Response) => new Uint8Array(await r.arrayBuffer());

describe('소리와 영상 올리기', () => {
  it('나눠 올린 것을 이어서 그대로 돌려준다', async () => {
    const ctx = testCtx();
    const sent = mp3(P * 2 + 1234);
    const id = await upload(ctx, 'audio/mpeg', sent);
    const r = await serveMedia(ctx.db, id, null);
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toBe('audio/mpeg');
    expect(r.headers.get('accept-ranges')).toBe('bytes');
    expect(Array.from(await body(r))).toEqual(Array.from(sent));
    expect(await mediaType(ctx.db, id)).toBe('audio');
  });

  it('범위를 달라고 하면 그만큼만 준다. 덩어리 경계를 넘는 범위도, 끝에서 세는 범위도', async () => {
    const ctx = testCtx();
    const sent = mp4(P * 3 + 10);
    const id = await upload(ctx, 'video/quicktime', sent);
    expect(await mediaType(ctx.db, id)).toBe('video');

    const head = await serveMedia(ctx.db, id, 'bytes=0-1');
    expect(head.status).toBe(206);
    expect(head.headers.get('content-type')).toBe('video/mp4');
    expect(head.headers.get('content-range')).toBe(`bytes 0-1/${sent.length}`);
    expect(Array.from(await body(head))).toEqual(Array.from(sent.slice(0, 2)));

    const across = await serveMedia(ctx.db, id, `bytes=${P - 5}-${P + 4}`);
    expect(Array.from(await body(across))).toEqual(Array.from(sent.slice(P - 5, P + 5)));

    const tail = await serveMedia(ctx.db, id, 'bytes=-7');
    expect(tail.headers.get('content-range')).toBe(`bytes ${sent.length - 7}-${sent.length - 1}/${sent.length}`);
    expect(Array.from(await body(tail))).toEqual(Array.from(sent.slice(-7)));
  });

  it('끝을 열어 두고 달라고 하면 한 번에 덩어리 몇 개까지만 준다. 나머지는 다음에 달라고 한다', async () => {
    const ctx = testCtx();
    const sent = mp4(P * 4);
    const id = await upload(ctx, 'video/mp4', sent);
    const r = await serveMedia(ctx.db, id, 'bytes=10-');
    const end = 10 + P * RULES.media.serve - 1;
    expect(r.headers.get('content-range')).toBe(`bytes 10-${end}/${sent.length}`);
    expect(Array.from(await body(r))).toEqual(Array.from(sent.slice(10, end + 1)));
  });

  it('줄 수 없는 범위는 416', async () => {
    const ctx = testCtx();
    const id = await upload(ctx, 'audio/mpeg', mp3(100));
    const r = await serveMedia(ctx.db, id, 'bytes=500-');
    expect(r.status).toBe(416);
    expect(r.headers.get('content-range')).toBe('bytes */100');
  });

  it('다 올리지 않았으면 끝나지 않고, 내주지도 않는다', async () => {
    const ctx = testCtx();
    const sent = mp3(P + 10);
    const { id } = await startMedia(ctx, { mime: 'audio/mpeg', size: sent.length });
    await putPart(ctx, id, 0, sent.slice(0, P));
    expect(await code(finishMedia(ctx, id))).toBe('media_missing');
    expect(await code(serveMedia(ctx.db, id, null))).toBe('no_media');
  });

  it('받는 종류와 크기만 받는다. 이름표만 음악인 파일은 받지 않는다', async () => {
    const ctx = testCtx();
    expect(await code(startMedia(ctx, { mime: 'application/zip', size: 10 }))).toBe('media_kind');
    expect(await code(startMedia(ctx, { mime: 'audio/mpeg', size: RULES.media.audio + 1 }))).toBe('media_big');
    expect(await code(startMedia(ctx, { mime: 'video/mp4', size: RULES.media.video + 1 }))).toBe('media_big');
    expect(await code(startMedia(ctx, { mime: 'audio/mpeg', size: 0 }))).toBe('media_empty');
    const { id } = await startMedia(ctx, { mime: 'audio/mpeg', size: 10 });
    expect(await code(putPart(ctx, id, 0, new Uint8Array(10)))).toBe('media_broken');
    expect(await code(putPart(ctx, id, 0, mp3(9)))).toBe('media_part');
    expect(await code(putPart(ctx, id, 1, mp3(10)))).toBe('media_part');
  });

  it('올린 사람만 이어서 올리고 끝낸다', async () => {
    const ctx = testCtx();
    const { id } = await startMedia(ctx, { mime: 'audio/mpeg', size: 10 });
    const other = { ...ctx, visitor: OTHER_VISITOR };
    expect(await code(putPart(other, id, 0, mp3(10)))).toBe('no_media');
    await putPart(ctx, id, 0, mp3(10));
    expect(await code(finishMedia(other, id))).toBe('no_media');
    await finishMedia(ctx, id);
    // 다 올린 뒤에는 누구에게나 내준다(주소는 짐작할 수 없는 값이다)
    expect((await serveMedia(ctx.db, id, null)).status).toBe(200);
  });

  it('가장자리에 담아 둔 덩어리는 저장소를 다시 오가지 않고 내준다', async () => {
    const ctx = testCtx();
    const sent = mp4(P * 2 + 99);
    const id = await upload(ctx, 'video/mp4', sent);
    const kept = new Map<string, ArrayBuffer>();
    const edge = {
      get: async (key: string) => kept.get(key) ?? null,
      put: (key: string, b: ArrayBuffer | string) => void kept.set(key, typeof b === 'string' ? (new TextEncoder().encode(b).buffer as ArrayBuffer) : b),
    };
    const first = await serveMedia(ctx.db, id, `bytes=0-${P * 2 + 98}`, edge);
    expect(Array.from(await body(first))).toEqual(Array.from(sent.slice(0, P * 2)));
    expect([...kept.keys()].sort()).toEqual([`meta/${id}`, `part/${id}/0`, `part/${id}/1`]);
    // 저장소에서 지워도 담아 둔 것으로 내준다
    await ctx.db.run('DELETE FROM media_parts WHERE media_id = ?', id);
    await ctx.db.run('DELETE FROM media WHERE id = ?', id);
    const again = await serveMedia(ctx.db, id, `bytes=${P - 3}-${P + 2}`, edge);
    expect(again.status).toBe(206);
    expect(Array.from(await body(again))).toEqual(Array.from(sent.slice(P - 3, P + 3)));
  });
});
