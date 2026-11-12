import { describe, expect, it } from 'vitest';
import { RULES } from '../../shared/rules';
import { Fail } from '../../worker/engine/ctx';
import { createFilm } from '../../worker/engine/films';
import { enter, say } from '../../worker/engine/turn';
import type { ModelCall } from '../../worker/model/index';
import { ModelError, openRouter, readOut } from '../../worker/model/openrouter';
import { addColumns, ensureSchema, SCHEMA, TEST_FILM } from '../../worker/schema';
import { memoryDb } from '../helpers/db';
import { DEV_FILM, testCtx, uid } from '../helpers/film';

const call: ModelCall = {
  purpose: 'reply',
  layers: { system: '시스템', cast: '캐릭터', scene: '시나리오' },
  user: '안녕',
  temperature: 0.8,
  maxTokens: 400,
};

const respond = (status: number, body: unknown) =>
  (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

describe('오픈라우터로 부르기', () => {
  it('세 층을 시스템 자리에, 유저의 말을 마지막에 실어 보낸다', async () => {
    let seen: { url: string; headers: Headers; body: any } | null = null;
    const fetcher = (async (url: string, init: RequestInit) => {
      seen = { url, headers: new Headers(init.headers), body: JSON.parse(String(init.body)) };
      return new Response(JSON.stringify({ choices: [{ message: { content: '응.\n왔어?' } }], usage: { prompt_tokens: 12, completion_tokens: 5 } }));
    }) as unknown as typeof fetch;

    const out = await openRouter('sk-or-test', 'some/model', fetcher).run(call);
    expect(seen!.url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(seen!.headers.get('authorization')).toBe('Bearer sk-or-test');
    expect(seen!.body).toMatchObject({
      model: 'some/model',
      temperature: 0.8,
      max_tokens: 400,
      // 빠른 제공처부터, 생각하는 과정 없이
      provider: { sort: 'latency' },
      reasoning: { effort: 'none' },
      messages: [
        { role: 'system', content: '시스템\n\n캐릭터\n\n시나리오' },
        { role: 'user', content: '안녕' },
      ],
    });
    expect(out).toMatchObject({ text: '응.\n왔어?', thinking: null, tokensIn: 12, tokensOut: 5 });
  });

  it('사고 과정이 따로 오면 대사에 섞지 않는다', () => {
    const out = readOut({ choices: [{ message: { content: '왔어?', reasoning: '유저가 인사를 했다. 짧게 답하자.' } }] });
    expect(out.text).toBe('왔어?');
    expect(out.thinking).toBe('유저가 인사를 했다. 짧게 답하자.');
  });

  it('열쇠가 틀리거나 모델이 없으면 까닭을 달고 넘어진다', async () => {
    const bad = openRouter('sk-or-wrong', 'some/model', respond(401, { error: { message: 'No auth credentials found', code: 401 } }));
    await expect(bad.run(call)).rejects.toThrow(ModelError);
    await expect(bad.run(call)).rejects.toThrow('오픈라우터 401: No auth credentials found');
    // 200으로 오는 오류도 있다
    const soft = openRouter('sk-or-test', 'no/such', respond(200, { error: { message: 'model not found' } }));
    await expect(soft.run(call)).rejects.toThrow('model not found');
  });
});

describe('모델 열쇠가 없을 때', () => {
  it('가짜 답을 내지 않는다. 그 턴은 멈추고 무엇이 빠졌는지 말한다', async () => {
    const ctx = testCtx();
    const { id: filmId } = await createFilm(ctx, DEV_FILM);
    const playId = uid();
    await enter(ctx, filmId, playId);
    const noKey = {
      ...ctx,
      model: {
        id: 'none',
        async run(): Promise<never> {
          throw new Fail(503, 'no_model_key', '모델 열쇠가 아직 없어.');
        },
      },
    };
    await expect(say(noKey, playId, { room: 'c1', text: '안녕', requestId: uid() })).rejects.toMatchObject({ code: 'no_model_key' });
    const turn = await ctx.db.first<{ status: string; fail_reason: string }>(
      'SELECT status, fail_reason FROM turns WHERE play_id = ? ORDER BY turn_no DESC LIMIT 1',
      playId,
    );
    expect(turn).toEqual({ status: 'failed', fail_reason: 'no_model_key' });
    // 유저의 말은 남고 시계는 갔다. 인물의 말은 없다
    const said = await ctx.db.all<{ speaker: string }>("SELECT speaker FROM messages WHERE play_id = ? AND kind = 'chat'", playId);
    expect(said.map((m) => m.speaker)).toEqual(['persona']);
    const play = await ctx.db.first<{ elapsed: number }>('SELECT elapsed FROM plays WHERE id = ?', playId);
    expect(play!.elapsed).toBe(RULES.minutesPerSend);
  });
});

describe('저장소의 표', () => {
  it('Worker가 스스로 만든다. 몇 번 불러도 같다', async () => {
    const db = memoryDb();
    await db.run('INSERT INTO usage (day, who, calls) VALUES (?, ?, ?)', '2026-11-11', 'all', 7);
    await ensureSchema(db);
    await ensureSchema(db);
    for (const sql of SCHEMA) db.raw.exec(sql); // 이미 있는 표에 다시 돌려도 넘어지지 않는다
    const row = await db.first<{ calls: number }>('SELECT calls FROM usage WHERE day = ?', '2026-11-11');
    expect(row!.calls).toBe(7);
    const tables = await db.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name");
    expect(tables.map((t) => t.name)).toEqual(['asides', 'events', 'feed_days', 'films', 'gen_log', 'images', 'media', 'media_parts', 'messages', 'meta', 'mypersonas', 'personas', 'plays', 'posts', 'saves', 'turns', 'usage', 'visitors']);
  });

  it('먼저 만들어진 저장소에는 나중에 생긴 칸을 붙인다. 있던 삶은 첫 하루로 읽힌다', async () => {
    const db = memoryDb();
    // 날 수를 적는 칸이 없던 때의 표로 되돌린다
    db.raw.exec('DROP TABLE plays');
    db.raw.exec(
      'CREATE TABLE plays (id TEXT PRIMARY KEY, film_id TEXT NOT NULL, owner TEXT NOT NULL, film TEXT NOT NULL, start_dow INTEGER NOT NULL, start_min INTEGER NOT NULL, elapsed INTEGER NOT NULL DEFAULT 0, ended INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL)',
    );
    db.raw.exec("INSERT INTO plays (id, film_id, owner, film, start_dow, start_min, created_at) VALUES ('p', 'f', 'o', '{}', 5, 960, 1)");

    await addColumns(db);
    await addColumns(db); // 두 번 불러도 같다
    expect(await db.first<{ days: number }>("SELECT days FROM plays WHERE id = 'p'")).toEqual({ days: 1 });
  });

  it('비공개 칸을 붙일 때 초반에 만든 시험 필름만 비공개로 돌린다. 다른 필름은 공개 그대로다', async () => {
    const db = memoryDb();
    db.raw.exec('DROP TABLE films');
    db.raw.exec(
      'CREATE TABLE films (id TEXT PRIMARY KEY, owner TEXT NOT NULL, title TEXT NOT NULL, logline TEXT NOT NULL, featured INTEGER NOT NULL DEFAULT 0, data TEXT NOT NULL, created_at INTEGER NOT NULL)',
    );
    db.raw.exec(`INSERT INTO films (id, owner, title, logline, data, created_at) VALUES ('${TEST_FILM}', 'o', '시험 인물', '', '{}', 1), ('mine', 'o', '수몰지구', '', '{}', 2)`);
    await addColumns(db);
    await addColumns(db); // 두 번 불러도 같다
    expect(await db.all<{ id: string; private: number }>('SELECT id, private FROM films ORDER BY created_at')).toEqual([
      { id: TEST_FILM, private: 1 },
      { id: 'mine', private: 0 },
    ]);
  });
});
