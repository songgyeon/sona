import { describe, expect, it } from 'vitest';
import { RULES } from '../../shared/rules';
import type { Film } from '../../shared/types';
import { Fail } from '../../worker/engine/ctx';
import { createFilm, getFilm, parseFilm } from '../../worker/engine/films';
import { listPlays, viewOf } from '../../worker/engine/store';
import { enter, say } from '../../worker/engine/turn';
import { DEV_FILM, testCtx, uid, VISITOR } from '../helpers/film';

const CUT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CUT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

/** 한서(c1)와의 자리에서 열리는 오프닝. 지후(c2)는 이 자리에 없다 */
const OPENING = [
  { kind: 'tell', text: '손님이 끊긴 오후.\n둘이 책을 정리하고 있다.' },
  { kind: 'cut', image: CUT_A },
  { kind: 'say', cast: 'c1', text: '수아 씨, 그건 이쪽 칸이에요.' },
  { kind: 'tell', text: '한서가 계산대 옆 서가를 가리킨다.' },
  { kind: 'cut', image: CUT_B },
];

const film = (speaker: 'persona' | 'cast', beats: unknown[] = OPENING) => ({
  ...DEV_FILM,
  firstScene: { place: '서점 계산대', beats, room: 'c1', speaker },
});

function failCode(run: () => unknown): string {
  try {
    run();
  } catch (e) {
    if (e instanceof Fail) return e.code;
    throw e;
  }
  return 'no-fail';
}

async function setup(input: unknown) {
  const ctx = testCtx();
  const { id: filmId } = await createFilm(ctx, input);
  const view = await enter(ctx, filmId, uid());
  return { ctx, filmId, view };
}

describe('오프닝 읽기', () => {
  it('컷·지문·대사를 쌓은 순서대로 받는다. 필름의 컷은 오프닝에 건 컷이다', () => {
    const f = parseFilm(film('persona'));
    expect(f.firstScene.beats).toEqual(OPENING);
    expect(f.stills).toEqual([CUT_A, CUT_B]);
    expect(f.firstScene.firstLine).toBe('');
  });

  it('빈 칸은 버린다', () => {
    const f = parseFilm(film('persona', [{ kind: 'tell', text: '  ' }, { kind: 'say', cast: 'c1', text: '' }, { kind: 'cut', image: '' }, { kind: 'tell', text: '점심 뒤.' }]));
    expect(f.firstScene.beats).toEqual([{ kind: 'tell', text: '점심 뒤.' }]);
  });

  it('맞지 않는 오프닝은 어디가 틀렸는지 말하고 거절한다', () => {
    expect(failCode(() => parseFilm(film('persona', [{ kind: 'dance', text: '?' }])))).toBe('film_invalid');
    expect(failCode(() => parseFilm(film('persona', [{ kind: 'say', cast: 'c9', text: '누구?' }])))).toBe('film_invalid');
    expect(failCode(() => parseFilm(film('persona', [{ kind: 'cut', image: 'not-an-image' }])))).toBe('film_invalid');
    const long = '가'.repeat(RULES.limits.opening / 2 + 1);
    expect(failCode(() => parseFilm(film('persona', [{ kind: 'tell', text: long }, { kind: 'tell', text: long }])))).toBe('film_invalid');
    const many = Array.from({ length: RULES.limits.beats + 1 }, () => ({ kind: 'tell', text: '가' }));
    expect(failCode(() => parseFilm(film('persona', many)))).toBe('film_invalid');
    const cuts = Array.from({ length: RULES.limits.stills + 1 }, (_, i) => ({ kind: 'cut', image: `cccccccc-cccc-4ccc-8ccc-${String(i).padStart(12, '0')}` }));
    expect(failCode(() => parseFilm(film('persona', cuts)))).toBe('film_invalid');
  });
});

describe('오프닝으로 들어가기', () => {
  it('내가 먼저 말하는 필름: 오프닝만 있고, 대사 모델을 부르지 않는다', async () => {
    const { ctx, view } = await setup(film('persona'));
    expect(view.film.firstScene.beats).toEqual(OPENING);
    expect(view.messages).toHaveLength(0);
    expect(view.stuck).toBeNull();
    expect(ctx.model.calls).toHaveLength(0);
  });

  it('캐스트가 먼저 말하는 필름: 대사 모델이 오프닝을 읽고 그 뒤를 잇는다', async () => {
    const { ctx, view } = await setup(film('cast'));
    expect(ctx.model.calls.map((c) => c.purpose)).toEqual(['first']);

    const call = ctx.model.calls[0]!;
    const opening = call.layers.scene.slice(call.layers.scene.indexOf('[이야기가 시작된 자리]'));
    expect(opening.split('\n').slice(0, 6)).toEqual([
      '[이야기가 시작된 자리]',
      '서점 계산대',
      '손님이 끊긴 오후.',
      '둘이 책을 정리하고 있다.',
      '한서: "수아 씨, 그건 이쪽 칸이에요."',
      '한서가 계산대 옆 서가를 가리킨다.',
    ]);
    expect(call.user).toContain('이어서');
    // 대사 모델이 쓴 것만 오간 말로 남는다. 오프닝은 필름에 있다
    expect(view.messages.map((m) => [m.speaker, m.kind])).toEqual([
      ['tell', 'first'],
      ['c1', 'first'],
    ]);
  });

  it('오프닝이 비어 있고 캐스트가 먼저 말하는 필름: 대사 모델이 장면을 연다', async () => {
    const { ctx } = await setup(film('cast', []));
    expect(ctx.model.calls.map((c) => c.purpose)).toEqual(['first']);
    expect(ctx.model.calls[0]!.user).toContain('이 장면을 연다');
  });

  it('아직 오간 말이 없으면 목록에는 오프닝의 마지막 대사가 보인다', async () => {
    const { ctx } = await setup(film('persona'));
    expect((await listPlays(ctx))[0]!.lastLine).toBe('수아 씨, 그건 이쪽 칸이에요.');
  });
});

describe('오프닝과 프롬프트', () => {
  it('오프닝은 장면을 쓰는 작가에게 통째로 실린다. 같은 일을 두 번 싣지 않는다', async () => {
    const { ctx, view } = await setup(film('persona'));

    await say(ctx, view.id, { text: '어느 칸이요?', requestId: uid() });
    const scene = ctx.model.calls.at(-1)!.layers.scene;
    expect(scene).toContain('[이야기가 시작된 자리]');
    expect(scene).toContain('한서: "수아 씨, 그건 이쪽 칸이에요."');
    expect(scene.split('손님이 끊긴 오후.')).toHaveLength(2);
    expect(scene.split('[이야기가 시작된 자리]')).toHaveLength(2);
  });

  it('오프닝에서 말한 캐스트는 그 자리에 있었던 것이다', async () => {
    const both = [...OPENING, { kind: 'say', cast: 'c2', text: '오늘도 그 자리 비었어요?' }];
    const { ctx, view } = await setup(film('persona', both));
    await say(ctx, view.id, { room: 'c2', text: '네, 비었어요.', requestId: uid() });
    const toJihu = ctx.model.calls.at(-1)!.layers.scene;
    expect(toJihu).toContain('[이야기가 시작된 자리]');
    expect(toJihu).toContain('지후: "오늘도 그 자리 비었어요?"');
  });
});

describe('예전에 저장된 필름', () => {
  /** 오프닝이 장면 글 한 덩이였던 때의 모양 그대로 */
  const OLD: Record<string, unknown> = {
    ...parseFilm(DEV_FILM),
    stills: [CUT_A, CUT_B],
    firstScene: { place: '서점 계산대', situation: '손님이 끊긴 오후. 둘이 책을 정리하고 있다.', room: 'c1', speaker: 'cast', firstLine: '수아 씨, 그건 거기 말고 이쪽 칸이에요.' },
  };

  async function withOldFilm() {
    const ctx = testCtx();
    const filmId = uid();
    await ctx.db.run(
      'INSERT INTO films (id, owner, title, logline, featured, data, created_at) VALUES (?, ?, ?, ?, 0, ?, ?)',
      filmId,
      VISITOR,
      'old',
      '',
      JSON.stringify(OLD),
      1,
    );
    return { ctx, filmId };
  }

  it('첫 컷과 장면 글이 오프닝의 칸으로 읽힌다. 따로 건 컷은 그대로다', async () => {
    const { ctx, filmId } = await withOldFilm();
    const { film: f } = await getFilm(ctx, filmId);
    expect(f.firstScene.beats).toEqual([
      { kind: 'cut', image: CUT_A },
      { kind: 'tell', text: '손님이 끊긴 오후. 둘이 책을 정리하고 있다.' },
    ]);
    expect(f.firstScene.firstLine).toBe('수아 씨, 그건 거기 말고 이쪽 칸이에요.');
    expect(f.stills).toEqual([CUT_A, CUT_B]);
    expect((f.firstScene as unknown as { situation?: string }).situation).toBeUndefined();
  });

  it('예전처럼 디렉터가 쓴 첫 마디로 시작한다', async () => {
    const { ctx, filmId } = await withOldFilm();
    const view = await enter(ctx, filmId, uid());
    expect(view.messages.map((m) => [m.speaker, m.kind, m.text])).toEqual([['c1', 'first', '수아 씨, 그건 거기 말고 이쪽 칸이에요.']]);
    expect(ctx.model.calls).toHaveLength(0);
  });

  it('예전 필름으로 살던 삶도 이어진다', async () => {
    const { ctx } = await withOldFilm();
    const playId = uid();
    await ctx.db.run(
      'INSERT INTO plays (id, film_id, owner, film, start_dow, start_min, elapsed, ended, created_at) VALUES (?, ?, ?, ?, 5, 960, 0, 0, 1)',
      playId,
      uid(),
      VISITOR,
      JSON.stringify(OLD),
    );
    const view = await viewOf(ctx, playId);
    const f: Film = view.film;
    expect(f.firstScene.beats.map((b) => b.kind)).toEqual(['cut', 'tell']);

    await say(ctx, playId, { room: 'c1', text: '여기요?', requestId: uid() });
    expect(ctx.model.calls.at(-1)!.layers.scene).toContain('손님이 끊긴 오후. 둘이 책을 정리하고 있다.');
  });
});
