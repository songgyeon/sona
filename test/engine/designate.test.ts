import { describe, expect, it } from 'vitest';
import { Fail } from '../../worker/engine/ctx';
import { chooseAs, filmView } from '../../worker/engine/entry';
import { createFilm } from '../../worker/engine/films';
import { addPersona, dropPersona, editPersona, listPersonas } from '../../worker/engine/mypersonas';
import { setMine } from '../../worker/engine/persona';
import { addColumns } from '../../worker/schema';
import { viewOf } from '../../worker/engine/store';
import { enter, say } from '../../worker/engine/turn';
import { DEV_FILM, testCtx, uid } from '../helpers/film';

const FACE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const FACE2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

/* 들어가는 사람으로 고른 내 페르소나 — 고치면 그 페르소나로 들어가는 필름과 삶에 같이 적힌다 */
async function setup() {
  const ctx = testCtx();
  const [p] = await addPersona(ctx, { name: '문리현', line: '밤에만 깨어 있는 사람.', face: FACE });
  const persona = p!;
  const a = (await createFilm(ctx, DEV_FILM)).id;
  const b = (await createFilm(ctx, { ...DEV_FILM, title: '개발용 — 둘째' })).id;
  await chooseAs(ctx, a, { as: 'persona', id: persona.id });
  await chooseAs(ctx, b, { as: 'persona', id: persona.id });
  return { ctx, persona, a, b };
}

describe('고른 페르소나 고치기', () => {
  it('내 페르소나를 고치면 그 페르소나로 들어가는 필름마다, 살던 삶마다 적힌다', async () => {
    const { ctx, persona, a, b } = await setup();
    const playId = uid();
    await enter(ctx, a, playId);
    await editPersona(ctx, persona.id, { name: '문리현', line: '낮에도 깨어 있는 사람.', face: FACE2 });
    for (const id of [a, b]) {
      const { mine } = await filmView(ctx, id);
      expect(mine).toMatchObject({ name: '문리현', line: '낮에도 깨어 있는 사람.', face: FACE2, as: 'me', personaId: persona.id });
    }
    expect((await viewOf(ctx, playId)).film.persona).toMatchObject({ line: '낮에도 깨어 있는 사람.', face: FACE2 });
  });

  it('이름을 고쳐도 고른 페르소나 그대로다. 살던 삶의 이름도 바뀐다', async () => {
    const { ctx, persona, a } = await setup();
    const playId = uid();
    await enter(ctx, a, playId);
    await editPersona(ctx, persona.id, { name: '문해든', line: '', face: '' });
    const { mine } = await filmView(ctx, a);
    // 사진과 소개를 비우면 배역의 것을 빌려 쓴다
    expect(mine).toMatchObject({ name: '문해든', as: 'me', personaId: persona.id, line: DEV_FILM.persona.line });
    const v = await viewOf(ctx, playId);
    expect(v.film.persona.name).toBe('문해든');
    await say(ctx, playId, { text: '안녕하세요.', requestId: uid() });
    expect(ctx.model.calls.filter((c) => c.purpose === 'reply').at(-1)!.layers.cast).toContain('문해든');
  });

  it('캐스트와 이름이 겹치는 필름은 건너뛴다. 다른 필름에는 적힌다', async () => {
    const { ctx, persona, a } = await setup();
    const other = (await createFilm(ctx, { ...DEV_FILM, title: '개발용 — 셋째', casts: [{ ...DEV_FILM.casts[0], name: '문해든' }, DEV_FILM.casts[1]] })).id;
    await chooseAs(ctx, other, { as: 'persona', id: persona.id });
    await editPersona(ctx, persona.id, { name: '문해든', line: '', face: '' });
    expect((await filmView(ctx, a)).mine.name).toBe('문해든');
    expect((await filmView(ctx, other)).mine.name).toBe('문리현');
  });

  it('재생 중에 그 필름에서만 고치면 고른 페르소나와 끊긴다. 그 뒤 페르소나를 고쳐도 덮지 않는다', async () => {
    const { ctx, persona, a } = await setup();
    const playId = uid();
    await enter(ctx, a, playId);
    await setMine(ctx, playId, { name: '문리현', line: '이 필름에서만 다른 사람.', face: '' });
    await editPersona(ctx, persona.id, { name: '문리현', line: '새 소개.', face: FACE });
    const { mine } = await filmView(ctx, a);
    expect(mine).toMatchObject({ line: '이 필름에서만 다른 사람.', personaId: null });
  });

  it('페르소나를 지우면 그 필름은 그때의 모습 그대로 남는다', async () => {
    const { ctx, persona, a } = await setup();
    await dropPersona(ctx, persona.id);
    const { mine } = await filmView(ctx, a);
    expect(mine).toMatchObject({ name: '문리현', line: '밤에만 깨어 있는 사람.', personaId: null });
    expect((await listPersonas(ctx)).some((p) => p.id === persona.id)).toBe(false);
  });

  it('이 칸이 생기기 전에 고른 것도 이름이 같은 페르소나로 이어지고, 어긋나 있던 것은 필름 정보를 열 때 맞춘다', async () => {
    const ctx = testCtx();
    const [p] = await addPersona(ctx, { name: '문리현', line: '옛 소개.', face: '' });
    const filmId = (await createFilm(ctx, DEV_FILM)).id;
    // 고른 페르소나를 적는 칸이 없던 때의 자리: 이름만 같고, 그 뒤에 페르소나를 고쳤다
    ctx.db.raw.exec('ALTER TABLE personas DROP COLUMN persona_id');
    await ctx.db.run('INSERT INTO personas (visitor, film_id, name, line, face, updated_at) VALUES (?, ?, ?, ?, ?, ?)', ctx.visitor, filmId, '문리현', '옛 소개.', '', 1);
    await ctx.db.run('UPDATE mypersonas SET line = ? WHERE id = ?', '새 소개.', p!.id);
    await addColumns(ctx.db);
    const { mine } = await filmView(ctx, filmId);
    expect(mine).toMatchObject({ name: '문리현', line: '새 소개.', as: 'me', personaId: p!.id });
  });

  it('고른 페르소나가 아니면 고친다고 다른 필름이 바뀌지 않는다', async () => {
    const ctx = testCtx();
    const [, second] = await addPersona(ctx, { name: '하람', line: '', face: '' }).then(async () => addPersona(ctx, { name: '도윤', line: '', face: '' }));
    const filmId = (await createFilm(ctx, DEV_FILM)).id;
    await chooseAs(ctx, filmId, { as: 'role' });
    await editPersona(ctx, second!.id, { name: '도윤', line: '바뀐 소개', face: '' });
    expect((await filmView(ctx, filmId)).mine).toMatchObject({ as: 'role', name: DEV_FILM.persona.name, personaId: null });
    let err: Fail | null = null;
    try {
      await editPersona(ctx, uid(), { name: 'x' });
    } catch (e) {
      err = e as Fail;
    }
    expect(err?.code).toBe('persona_missing');
  });
});
