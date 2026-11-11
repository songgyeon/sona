/* 길만 가른다. 일은 engine이 한다. */

import { d1 } from './db';
import { type Ctx, Fail } from './engine/ctx';
import { createFilm, getFilm, listFilms, updateFilm } from './engine/films';
import { loadImage, saveImage } from './engine/images';
import { skip } from './engine/skip';
import { listPlays, viewOf } from './engine/store';
import { setMine } from './engine/persona';
import { enter, nextDay, retry, say } from './engine/turn';
import { checkKey, visitorOf } from './guard';
import { demoScript, fakeModel } from './model/fake';
import type { Model } from './model/index';
import { openRouter } from './model/openrouter';
import { ensureSchema } from './schema';

export interface Env {
  DB: D1Database;
  /** 주소를 잠그고 싶을 때만 Cloudflare 대시보드에 넣는다. 없으면 열려 있다 */
  ACCESS_KEY?: string;
  /** 오픈라우터 열쇠. Cloudflare 대시보드에 넣는다 */
  OPENROUTER_API_KEY?: string;
  /** 어떤 모델을 부르나. wrangler.jsonc의 vars */
  MODEL_ID?: string;
  /** fake로 두면 열쇠 없이 대역이 선다(로컬에서만 쓴다) */
  MODEL_KIND?: string;
}

const modelReady = (env: Env) => env.MODEL_KIND === 'fake' || (!!env.OPENROUTER_API_KEY && !!env.MODEL_ID);

function pickModel(env: Env): Model {
  if (env.MODEL_KIND === 'fake') return fakeModel(demoScript);
  if (env.OPENROUTER_API_KEY && env.MODEL_ID) return openRouter(env.OPENROUTER_API_KEY, env.MODEL_ID);
  // 열쇠가 없으면 가짜 답을 내지 않는다. 무엇이 빠졌는지 말한다
  return {
    id: 'none',
    async run() {
      throw new Fail(
        503,
        'no_model_key',
        '대사 모델이 연결되지 않았어요.',
      );
    },
  };
}

type Handler = (ctx: Ctx, p: string[], body: Record<string, unknown>) => Promise<unknown>;

const ROUTES: [string, RegExp, Handler][] = [
  ['GET', /^\/api\/films$/, (ctx) => listFilms(ctx)],
  ['POST', /^\/api\/films$/, (ctx, _p, body) => createFilm(ctx, body)],
  ['GET', /^\/api\/films\/([^/]+)$/, (ctx, p) => getFilm(ctx, p[0]!)],
  ['PUT', /^\/api\/films\/([^/]+)$/, (ctx, p, body) => updateFilm(ctx, p[0]!, body)],
  ['POST', /^\/api\/films\/([^/]+)\/enter$/, (ctx, p, body) => enter(ctx, p[0]!, body.playId)],
  ['GET', /^\/api\/plays$/, (ctx) => listPlays(ctx)],
  ['GET', /^\/api\/plays\/([^/]+)$/, (ctx, p) => viewOf(ctx, p[0]!)],
  [
    'POST',
    /^\/api\/plays\/([^/]+)\/say$/,
    (ctx, p, body) => say(ctx, p[0]!, { room: body.room, text: body.text, requestId: body.requestId }),
  ],
  [
    'POST',
    /^\/api\/plays\/([^/]+)\/skip$/,
    (ctx, p, body) => skip(ctx, p[0]!, { kind: body.kind, requestId: body.requestId }),
  ],
  ['POST', /^\/api\/plays\/([^/]+)\/retry$/, (ctx, p) => retry(ctx, p[0]!)],
  ['POST', /^\/api\/plays\/([^/]+)\/next$/, (ctx, p) => nextDay(ctx, p[0]!)],
  ['POST', /^\/api\/plays\/([^/]+)\/persona$/, (ctx, p, body) => setMine(ctx, p[0]!, body)],
];

const IMAGE = /^\/api\/img\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === '/api/health') return json({ ok: true });

    try {
      // 그림은 화면의 <img>가 바로 부른다. 열쇠를 실을 수 없어서 문지기 앞에서 내준다 — 주소는 짐작할 수 없는 값이다
      const img = IMAGE.exec(url.pathname);
      if (img && req.method === 'GET') {
        const db = d1(env.DB);
        await ensureSchema(db);
        const found = await loadImage(db, img[1]!);
        if (!found) throw new Fail(404, 'no_image', '그림을 찾을 수 없어요.');
        return new Response(found.bytes, {
          headers: {
            'content-type': found.mime,
            'cache-control': 'public, max-age=31536000, immutable',
            'x-content-type-options': 'nosniff',
          },
        });
      }

      await checkKey(req, env.ACCESS_KEY);
      // 화면이 켜질 때 부르는 길. 잠긴 주소면 여기서 걸리고, 모델 열쇠가 빠졌으면 알린다
      if (url.pathname === '/api/key') return json({ ok: true, fake: env.MODEL_KIND === 'fake', modelReady: modelReady(env) });

      // 그림 올리기. 몸통이 글자가 아니라서 따로 받는다
      if (url.pathname === '/api/img' && req.method === 'POST') {
        const db = d1(env.DB);
        await ensureSchema(db);
        const ctx: Ctx = { db, model: pickModel(env), visitor: visitorOf(req), now: () => Date.now() };
        return json(await saveImage(ctx, req.headers.get('content-type') ?? '', await req.arrayBuffer()));
      }

      for (const [method, pattern, handler] of ROUTES) {
        const m = pattern.exec(url.pathname);
        if (!m || req.method !== method) continue;
        const db = d1(env.DB);
        await ensureSchema(db);
        const ctx: Ctx = { db, model: pickModel(env), visitor: visitorOf(req), now: () => Date.now() };
        let body: Record<string, unknown> = {};
        if (method === 'POST' || method === 'PUT') {
          try {
            const parsed: unknown = await req.json();
            if (parsed && typeof parsed === 'object') body = parsed as Record<string, unknown>;
          } catch {
            throw new Fail(400, 'bad_json', '요청을 읽지 못했어요.');
          }
        }
        return json(await handler(ctx, m.slice(1), body));
      }
      throw new Fail(404, 'no_route', '없는 주소예요.');
    } catch (e) {
      if (e instanceof Fail) return json({ error: e.code, message: e.message }, e.status);
      console.error(e);
      return json({ error: 'server', message: '문제가 생겼어요. 잠시 뒤에 다시 시도해 주세요.' }, 500);
    }
  },
} satisfies ExportedHandler<Env>;
