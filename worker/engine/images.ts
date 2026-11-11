/* 그림 — 포스터, 캐스트의 얼굴, 장면의 컷. 화면이 줄여서 보낸 것을 그대로 둔다. */

import { RULES } from '../../shared/rules';
import { type Db, newId } from '../db';
import { type Ctx, Fail } from './ctx';

/** 받는 종류와, 파일 머리가 정말 그 종류인지 보는 법 */
const KINDS: Record<string, (b: Uint8Array) => boolean> = {
  'image/jpeg': (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/png': (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  'image/webp': (b) =>
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && // RIFF
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50, // WEBP
};

export async function saveImage(ctx: Ctx, mime: string, body: ArrayBuffer | Uint8Array): Promise<{ id: string }> {
  const kind = (mime.split(';')[0] ?? '').trim().toLowerCase();
  const looksRight = KINDS[kind];
  if (!looksRight) throw new Fail(415, 'image_kind', 'JPG, PNG, WEBP 그림만 올릴 수 있어.');
  const bytes = body instanceof Uint8Array ? body : new Uint8Array(body);
  if (bytes.length === 0) throw new Fail(400, 'image_empty', '그림이 비었어.');
  if (bytes.length > RULES.limits.image) throw new Fail(413, 'image_big', '그림이 너무 커.');
  // 이름표만 그림이고 속은 다른 것을 받지 않는다
  if (!looksRight(bytes)) throw new Fail(400, 'image_broken', '그림 파일이 아니야.');

  const id = newId();
  await ctx.db.run(
    'INSERT INTO images (id, owner, mime, bytes, size, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    id,
    ctx.visitor,
    kind,
    bytes,
    bytes.length,
    ctx.now(),
  );
  return { id };
}

/** 저장소마다 덩어리를 돌려주는 모양이 다르다 */
function toBytes(v: unknown): Uint8Array {
  if (v instanceof Uint8Array) return v;
  if (v instanceof ArrayBuffer) return new Uint8Array(v);
  if (ArrayBuffer.isView(v)) return new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
  if (Array.isArray(v)) return Uint8Array.from(v as number[]);
  return new Uint8Array();
}

export async function loadImage(db: Db, id: string): Promise<{ mime: string; bytes: Uint8Array } | null> {
  const row = await db.first<{ mime: string; bytes: unknown }>('SELECT mime, bytes FROM images WHERE id = ?', id);
  if (!row) return null;
  return { mime: row.mime, bytes: toBytes(row.bytes) };
}
