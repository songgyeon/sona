/* 길만 가른다. 일은 engine이 한다. */

import { d1 } from './db';
import { type Ctx, Fail } from './engine/ctx';
import { createFilm, getFilm, listFilms } from './engine/films';
import { skip } from './engine/skip';
import { listPlays, viewOf } from './engine/store';
import { enter, retry, say } from './engine/turn';
import { checkKey, visitorOf } from './guard';
import { demoScript, fakeModel } from './model/fake';
import type { Model } from './model/index';
import { openRouter } from './model/openrouter';
import { ensureSchema } from './schema';

export interface Env {
  DB: D1Database;
  /** 이 주소를 여는 열쇠. Cloudflare 대시보드에 넣는다 */
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
        '모델 열쇠가 아직 없어. Cloudflare에서 이 Worker의 변수와 시크릿에 OPENROUTER_API_KEY를 넣으면 대화가 돼.',
      );
    },
  };
}

type Handler = (ctx: Ctx, p: string[], body: Record<string, unknown>) => Promise<unknown>;

const ROUTES: [string, RegExp, Handler][] = [
  ['GET', /^\/api\/films$/, (ctx) => listFilms(ctx)],
  ['POST', /^\/api\/films$/, (ctx, _p, body) => createFilm(ctx, body)],
  ['GET', /^\/api\/films\/([^/]+)$/, (ctx, p) => getFilm(ctx, p[0]!)],
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
];

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
      await checkKey(req, env.ACCESS_KEY);
      // 열쇠만 확인하는 길. 화면이 문을 열지 정하고, 모델 열쇠가 빠졌으면 알린다
      if (url.pathname === '/api/key') return json({ ok: true, fake: env.MODEL_KIND === 'fake', modelReady: modelReady(env) });

      for (const [method, pattern, handler] of ROUTES) {
        const m = pattern.exec(url.pathname);
        if (!m || req.method !== method) continue;
        const db = d1(env.DB);
        await ensureSchema(db);
        const ctx: Ctx = { db, model: pickModel(env), visitor: visitorOf(req), now: () => Date.now() };
        let body: Record<string, unknown> = {};
        if (method === 'POST') {
          try {
            const parsed: unknown = await req.json();
            if (parsed && typeof parsed === 'object') body = parsed as Record<string, unknown>;
          } catch {
            throw new Fail(400, 'bad_json', '보낸 내용을 읽지 못했어.');
          }
        }
        return json(await handler(ctx, m.slice(1), body));
      }
      throw new Fail(404, 'no_route', '그런 길은 없어.');
    } catch (e) {
      if (e instanceof Fail) return json({ error: e.code, message: e.message }, e.status);
      console.error(e);
      return json({ error: 'server', message: '서버에서 문제가 생겼어. 잠깐 뒤에 다시 해 줘.' }, 500);
    }
  },
} satisfies ExportedHandler<Env>;
