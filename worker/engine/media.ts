/* 소리와 영상 — 배경 음악, 오프닝 영상의 음악과 영상 컷.
   커서 한 번에 받지 않는다. 화면이 RULES.media.part 바이트씩 나눠 보내고, 다 보내면 끝낸다(finishMedia).
   내줄 때는 달라는 범위만 내준다(Range). 소리와 영상은 그렇게 조금씩 읽는다 — Safari는 범위로 안 주면 틀지 않는다. */

import { RULES } from '../../shared/rules';
import { type Db, newId } from '../db';
import { isUuid } from '../guard';
import { type Ctx, Fail } from './ctx';

const M = RULES.media;

const at = (b: Uint8Array, i: number, s: string) => [...s].every((ch, k) => b[i + k] === ch.charCodeAt(0));

/** 파일 머리가 정말 그 종류인지 */
const SNIFF = {
  mp3: (b: Uint8Array) => at(b, 0, 'ID3') || (b[0] === 0xff && ((b[1] ?? 0) & 0xe0) === 0xe0),
  mp4: (b: Uint8Array) => at(b, 4, 'ftyp'),
  aac: (b: Uint8Array) => b[0] === 0xff && ((b[1] ?? 0) & 0xf6) === 0xf0,
  ogg: (b: Uint8Array) => at(b, 0, 'OggS'),
  wav: (b: Uint8Array) => at(b, 0, 'RIFF') && at(b, 8, 'WAVE'),
  webm: (b: Uint8Array) => b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3,
};

/** 받는 종류: 화면이 알려 준 종류 → 저장하는 종류, 소리인가 영상인가, 머리 보는 법 */
const KINDS: Record<string, { mime: string; type: 'audio' | 'video'; sniff: (b: Uint8Array) => boolean }> = {
  'audio/mpeg': { mime: 'audio/mpeg', type: 'audio', sniff: SNIFF.mp3 },
  'audio/mp3': { mime: 'audio/mpeg', type: 'audio', sniff: SNIFF.mp3 },
  'audio/mp4': { mime: 'audio/mp4', type: 'audio', sniff: SNIFF.mp4 },
  'audio/x-m4a': { mime: 'audio/mp4', type: 'audio', sniff: SNIFF.mp4 },
  'audio/m4a': { mime: 'audio/mp4', type: 'audio', sniff: SNIFF.mp4 },
  'audio/aac': { mime: 'audio/aac', type: 'audio', sniff: SNIFF.aac },
  'audio/ogg': { mime: 'audio/ogg', type: 'audio', sniff: SNIFF.ogg },
  'audio/wav': { mime: 'audio/wav', type: 'audio', sniff: SNIFF.wav },
  'audio/x-wav': { mime: 'audio/wav', type: 'audio', sniff: SNIFF.wav },
  'audio/webm': { mime: 'audio/webm', type: 'audio', sniff: SNIFF.webm },
  'video/mp4': { mime: 'video/mp4', type: 'video', sniff: SNIFF.mp4 },
  // 아이폰이 찍은 영상. 속은 mp4와 같은 모양이라 mp4로 내준다
  'video/quicktime': { mime: 'video/mp4', type: 'video', sniff: SNIFF.mp4 },
  'video/webm': { mime: 'video/webm', type: 'video', sniff: SNIFF.webm },
};

export type MediaType = 'audio' | 'video';

interface MediaRow {
  id: string;
  owner: string;
  mime: string;
  size: number;
  parts: number;
  done: number;
}

/** 올리기 시작한다. 종류와 크기를 먼저 받고, 나눠 보낼 덩어리의 크기를 알려 준다 */
export async function startMedia(ctx: Ctx, input: unknown): Promise<{ id: string; part: number }> {
  const o = (input && typeof input === 'object' ? input : {}) as { mime?: unknown; size?: unknown };
  const kind = KINDS[String(o.mime ?? '').split(';')[0]!.trim().toLowerCase()];
  if (!kind) throw new Fail(415, 'media_kind', 'MP3, M4A, WAV, OGG 음악이나 MP4, MOV, WEBM 영상만 올릴 수 있어요.');
  const size = Number(o.size);
  if (!Number.isInteger(size) || size <= 0) throw new Fail(400, 'media_empty', '파일이 비어 있어요.');
  const max = kind.type === 'audio' ? M.audio : M.video;
  if (size > max) throw new Fail(413, 'media_big', `${kind.type === 'audio' ? '음악' : '영상'}은 ${Math.floor(max / 1_000_000)}MB까지 올릴 수 있어요.`);
  const id = newId();
  await ctx.db.run(
    'INSERT INTO media (id, owner, mime, size, parts, done, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)',
    id,
    ctx.visitor,
    kind.mime,
    size,
    Math.ceil(size / M.part),
    ctx.now(),
  );
  return { id, part: M.part };
}

async function mine(ctx: Ctx, id: string): Promise<MediaRow> {
  const row = isUuid(id) ? await ctx.db.first<MediaRow>('SELECT id, owner, mime, size, parts, done FROM media WHERE id = ?', id) : null;
  if (!row || row.owner !== ctx.visitor) throw new Fail(404, 'no_media', '올리던 파일을 찾을 수 없어요.');
  return row;
}

/** 덩어리 하나를 받는다. 같은 덩어리를 다시 보내면 새 것으로 바꾼다 */
export async function putPart(ctx: Ctx, id: string, n: number, body: ArrayBuffer | Uint8Array): Promise<{ ok: true }> {
  const row = await mine(ctx, id);
  if (row.done) throw new Fail(409, 'media_done', '이미 다 올린 파일이에요.');
  if (!Number.isInteger(n) || n < 0 || n >= row.parts) throw new Fail(400, 'media_part', '파일 조각이 올바르지 않아요.');
  const bytes = body instanceof Uint8Array ? body : new Uint8Array(body);
  const want = n === row.parts - 1 ? row.size - n * M.part : M.part;
  if (bytes.length !== want) throw new Fail(400, 'media_part', '파일 조각의 크기가 맞지 않아요.');
  // 이름표만 음악이고 속은 다른 것을 받지 않는다
  if (n === 0) {
    const same = Object.values(KINDS).filter((k) => k.mime === row.mime);
    if (!same.some((k) => k.sniff(bytes))) throw new Fail(400, 'media_broken', `${same[0]?.type === 'video' ? '영상' : '음악'} 파일이 아니에요.`);
  }
  await ctx.db.run('INSERT OR REPLACE INTO media_parts (media_id, n, bytes) VALUES (?, ?, ?)', id, n, bytes);
  return { ok: true };
}

/** 다 보냈다. 빠진 조각이 없으면 내줄 수 있게 된다 */
export async function finishMedia(ctx: Ctx, id: string): Promise<{ id: string; mime: string; size: number }> {
  const row = await mine(ctx, id);
  if (!row.done) {
    const got = await ctx.db.first<{ n: number; size: number }>('SELECT COUNT(*) AS n, COALESCE(SUM(LENGTH(bytes)), 0) AS size FROM media_parts WHERE media_id = ?', id);
    if ((got?.n ?? 0) !== row.parts || (got?.size ?? 0) !== row.size) throw new Fail(409, 'media_missing', '파일이 다 올라가지 않았어요. 다시 올려 주세요.');
    await ctx.db.run('UPDATE media SET done = 1 WHERE id = ?', id);
  }
  return { id, mime: row.mime, size: row.size };
}

/** 저장소마다 덩어리를 돌려주는 모양이 다르다 */
function toBytes(v: unknown): Uint8Array {
  if (v instanceof Uint8Array) return v;
  if (v instanceof ArrayBuffer) return new Uint8Array(v);
  if (ArrayBuffer.isView(v)) return new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
  if (Array.isArray(v)) return Uint8Array.from(v as number[]);
  return new Uint8Array();
}

/** 달라는 범위. bytes=a-b, bytes=a-, bytes=-n. 여러 범위는 받지 않는다(앞의 하나만) */
function rangeOf(header: string | null, size: number): { start: number; end: number } | 'bad' | null {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)/.exec(header.trim());
  if (!m || (m[1] === '' && m[2] === '')) return 'bad';
  let start: number;
  let end: number;
  if (m[1] === '') {
    const n = Number(m[2]);
    if (n === 0) return 'bad';
    start = Math.max(0, size - n);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (start >= size || end < start) return 'bad';
  return { start, end };
}

/** 가장자리(Cloudflare가 가까운 곳에 담아 두는 캐시). 다 올린 파일은 바뀌지 않아서 덩어리를 오래 담아 둔다.
    두 번째부터는 저장소를 오가지 않고 가장자리에서 내준다. 없으면(시험, 로컬) 저장소에서만 읽는다 */
export interface Edge {
  get(key: string): Promise<ArrayBuffer | null>;
  put(key: string, body: ArrayBuffer | string): void;
}

type Meta = { mime: string; size: number; parts: number };

/** 파일의 모양(종류, 크기, 덩어리 수). 가장자리에 있으면 거기서 */
async function metaOf(db: Db, id: string, edge?: Edge): Promise<Meta | null> {
  const kept = await edge?.get(`meta/${id}`);
  if (kept) return JSON.parse(new TextDecoder().decode(kept)) as Meta;
  const row = isUuid(id) ? await db.first<MediaRow>('SELECT id, owner, mime, size, parts, done FROM media WHERE id = ? AND done = 1', id) : null;
  if (!row) return null;
  const meta = { mime: row.mime, size: row.size, parts: row.parts };
  edge?.put(`meta/${id}`, JSON.stringify(meta));
  return meta;
}

/** 덩어리 first..last. 가장자리에 없는 것만 저장소에서 한 번에 읽고, 읽은 것은 가장자리에 담는다 */
async function partsOf(db: Db, id: string, first: number, last: number, edge?: Edge): Promise<Map<number, Uint8Array>> {
  const out = new Map<number, Uint8Array>();
  if (edge) {
    const kept = await Promise.all(Array.from({ length: last - first + 1 }, (_, i) => edge.get(`part/${id}/${first + i}`)));
    kept.forEach((b, i) => b && out.set(first + i, new Uint8Array(b)));
  }
  const need = Array.from({ length: last - first + 1 }, (_, i) => first + i).filter((n) => !out.has(n));
  if (need.length === 0) return out;
  const rows = await db.all<{ n: number; bytes: unknown }>(
    `SELECT n, bytes FROM media_parts WHERE media_id = ? AND n IN (${need.map(() => '?').join(', ')}) ORDER BY n`,
    id,
    ...need,
  );
  for (const r of rows) {
    const bytes = toBytes(r.bytes);
    out.set(r.n, bytes);
    edge?.put(`part/${id}/${r.n}`, bytes.slice().buffer);
  }
  return out;
}

/** 내준다. 범위를 달라고 하면 그만큼만(많아야 덩어리 serve개), 아니면 처음부터 끝까지 조각을 이어서 흘려보낸다 */
export async function serveMedia(db: Db, id: string, range: string | null, edge?: Edge): Promise<Response> {
  const row = await metaOf(db, id, edge);
  if (!row) throw new Fail(404, 'no_media', '파일을 찾을 수 없어요.');
  const base = {
    'content-type': row.mime,
    'accept-ranges': 'bytes',
    'cache-control': 'public, max-age=31536000, immutable',
    'x-content-type-options': 'nosniff',
  };
  const r = rangeOf(range, row.size);
  if (r === 'bad') return new Response(null, { status: 416, headers: { ...base, 'content-range': `bytes */${row.size}` } });

  if (!r) {
    let n = 0;
    const stream = new ReadableStream<Uint8Array>({
      async pull(c) {
        if (n >= row.parts) {
          c.close();
          return;
        }
        const part = (await partsOf(db, id, n, n, edge)).get(n);
        n += 1;
        if (!part) {
          c.error(new Error('조각이 없다'));
          return;
        }
        c.enqueue(part);
      },
    });
    return new Response(stream, { status: 200, headers: { ...base, 'content-length': String(row.size) } });
  }

  const end = Math.min(r.end, r.start + M.part * M.serve - 1);
  const first = Math.floor(r.start / M.part);
  const last = Math.floor(end / M.part);
  const parts = await partsOf(db, id, first, last, edge);
  const out = new Uint8Array(end - r.start + 1);
  for (const [n, bytes] of parts) {
    const from = Math.max(r.start, n * M.part);
    const to = Math.min(end, n * M.part + bytes.length - 1);
    if (to < from) continue;
    out.set(bytes.subarray(from - n * M.part, to - n * M.part + 1), from - r.start);
  }
  return new Response(out, { status: 206, headers: { ...base, 'content-range': `bytes ${r.start}-${end}/${row.size}`, 'content-length': String(out.length) } });
}

/** 다 올라간 소리나 영상인가, 무엇인가. 없으면 null */
export async function mediaType(db: Db, id: string): Promise<MediaType | null> {
  const row = await db.first<{ mime: string }>('SELECT mime FROM media WHERE id = ? AND done = 1', id);
  if (!row) return null;
  return row.mime.startsWith('video/') ? 'video' : 'audio';
}
