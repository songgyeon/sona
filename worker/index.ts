/* 길만 가른다. 일은 engine이 한다. */

import { d1 } from './db';
import { type Ctx, Fail } from './engine/ctx';
import { openFeed, postMine } from './engine/alive';
import { chooseAs, filmView } from './engine/entry';
import { createFilm, listFilms, updateFilm } from './engine/films';
import { getMe, setMe } from './engine/me';
import { addPersona, dropPersona, editPersona, listPersonas } from './engine/mypersonas';
import { dropSave, listSaves, loadSave, makeSave } from './engine/saves';
import { loadImage, saveImage } from './engine/images';
import { finishMedia, putPart, serveMedia, startMedia } from './engine/media';
import { skip } from './engine/skip';
import { dropPlay, listPlays, viewOf } from './engine/store';
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
  ['GET', /^\/api\/me$/, (ctx) => getMe(ctx)],
  ['PUT', /^\/api\/me$/, (ctx, _p, body) => setMe(ctx, body)],
  ['GET', /^\/api\/personas$/, (ctx) => listPersonas(ctx)],
  ['POST', /^\/api\/personas$/, (ctx, _p, body) => addPersona(ctx, body)],
  ['PUT', /^\/api\/personas\/([^/]+)$/, (ctx, p, body) => editPersona(ctx, p[0]!, body)],
  ['POST', /^\/api\/personas\/([^/]+)\/drop$/, (ctx, p) => dropPersona(ctx, p[0]!)],
  ['GET', /^\/api\/films\/([^/]+)$/, (ctx, p) => filmView(ctx, p[0]!)],
  ['PUT', /^\/api\/films\/([^/]+)\/as$/, (ctx, p, body) => chooseAs(ctx, p[0]!, body)],
  ['PUT', /^\/api\/films\/([^/]+)$/, (ctx, p, body) => updateFilm(ctx, p[0]!, body)],
  ['POST', /^\/api\/films\/([^/]+)\/enter$/, (ctx, p, body) => enter(ctx, p[0]!, body.playId)],
  ['POST', /^\/api\/media$/, (ctx, _p, body) => startMedia(ctx, body)],
  ['POST', /^\/api\/media\/([^/]+)\/done$/, (ctx, p) => finishMedia(ctx, p[0]!)],
  ['GET', /^\/api\/plays$/, (ctx) => listPlays(ctx)],
  ['GET', /^\/api\/plays\/([^/]+)$/, (ctx, p) => viewOf(ctx, p[0]!)],
  [
    'POST',
    /^\/api\/plays\/([^/]+)\/say$/,
    (ctx, p, body) => say(ctx, p[0]!, { text: body.text, tell: body.tell, requestId: body.requestId }),
  ],
  [
    'POST',
    /^\/api\/plays\/([^/]+)\/skip$/,
    (ctx, p, body) => skip(ctx, p[0]!, { kind: body.kind, requestId: body.requestId }),
  ],
  ['POST', /^\/api\/plays\/([^/]+)\/retry$/, (ctx, p) => retry(ctx, p[0]!)],
  ['POST', /^\/api\/plays\/([^/]+)\/feed$/, (ctx, p) => openFeed(ctx, p[0]!)],
  ['POST', /^\/api\/plays\/([^/]+)\/posts$/, (ctx, p, body) => postMine(ctx, p[0]!, body)],
  ['GET', /^\/api\/plays\/([^/]+)\/saves$/, (ctx, p) => listSaves(ctx, p[0]!)],
  ['POST', /^\/api\/plays\/([^/]+)\/saves$/, (ctx, p) => makeSave(ctx, p[0]!)],
  ['POST', /^\/api\/plays\/([^/]+)\/saves\/([^/]+)\/load$/, (ctx, p) => loadSave(ctx, p[0]!, p[1]!)],
  ['POST', /^\/api\/plays\/([^/]+)\/saves\/([^/]+)\/drop$/, (ctx, p) => dropSave(ctx, p[0]!, p[1]!)],
  ['POST', /^\/api\/plays\/([^/]+)\/next$/, (ctx, p) => nextDay(ctx, p[0]!)],
  ['POST', /^\/api\/plays\/([^/]+)\/drop$/, (ctx, p) => dropPlay(ctx, p[0]!)],
  ['POST', /^\/api\/plays\/([^/]+)\/persona$/, (ctx, p, body) => setMine(ctx, p[0]!, body)],
];

const IMAGE = /^\/api\/img\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;
const MEDIA = /^\/api\/media\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;
const PART = /^\/api\/media\/([0-9a-f-]{36})\/parts\/(\d{1,4})$/;

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

export default {
  async fetch(req: Request, env: Env, run?: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === '/api/health') return json({ ok: true });

    try {
      // 그림은 화면의 <img>가 바로 부른다. 열쇠를 실을 수 없어서 문지기 앞에서 내준다 — 주소는 짐작할 수 없는 값이다
      const img = IMAGE.exec(url.pathname);
      if (img && req.method === 'GET') {
        // 그림은 주소가 곧 내용이라 바뀌지 않는다. 한 번 내준 것은 가장자리에 담아 두고 거기서 내준다 — 저장소를 다시 오가지 않는다
        const edge = typeof caches === 'undefined' ? null : caches.default;
        const kept = edge ? await edge.match(req) : undefined;
        if (kept) return kept;
        const db = d1(env.DB);
        await ensureSchema(db);
        const found = await loadImage(db, img[1]!);
        if (!found) throw new Fail(404, 'no_image', '그림을 찾을 수 없어요.');
        const res = new Response(found.bytes, {
          headers: {
            'content-type': found.mime,
            'cache-control': 'public, max-age=31536000, immutable',
            'x-content-type-options': 'nosniff',
          },
        });
        if (edge && run) run.waitUntil(edge.put(req, res.clone()));
        return res;
      }

      // 소리와 영상도 화면의 <audio>, <video>가 바로 부른다. 그림처럼 문지기 앞에서 내준다
      const media = MEDIA.exec(url.pathname);
      if (media && (req.method === 'GET' || req.method === 'HEAD')) {
        const db = d1(env.DB);
        await ensureSchema(db);
        const res = await serveMedia(db, media[1]!, req.headers.get('range'));
        return req.method === 'HEAD' ? new Response(null, { status: res.status, headers: res.headers }) : res;
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

      // 소리와 영상의 조각. 몸통이 글자가 아니라서 따로 받는다
      const part = PART.exec(url.pathname);
      if (part && req.method === 'PUT') {
        const db = d1(env.DB);
        await ensureSchema(db);
        const ctx: Ctx = { db, model: pickModel(env), visitor: visitorOf(req), now: () => Date.now() };
        return json(await putPart(ctx, part[1]!, Number(part[2]), await req.arrayBuffer()));
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
