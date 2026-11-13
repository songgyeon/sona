import { describe, expect, it } from 'vitest';
import { blankDraft, fromFilm, readDraft, toFilm } from '../../shared/draft';
import { readFilm } from '../../shared/opening';
import { RULES } from '../../shared/rules';
import type { Film } from '../../shared/types';
import { Fail } from '../../worker/engine/ctx';
import { createFilm, getFilm, parseFilm } from '../../worker/engine/films';
import { setMine } from '../../worker/engine/persona';
import { viewOf } from '../../worker/engine/store';
import { enter, say } from '../../worker/engine/turn';
import { DEV_FILM, OTHER_VISITOR, testCtx, uid } from '../helpers/film';

/* 덧붙이는 칸: 디렉터가 항목 이름과 내용을 직접 적는 칸. 세계, 내 배역, 캐스트마다 둔다. */
const WORLD = [{ label: '이 세계의 화폐', text: '조개껍데기를 돈처럼 쓴다.' }];
const MINE = [{ label: '나이', text: '스물셋. 휴학 중이다.' }];
const HANSEO = [
  { label: '좋아하는 것', text: '비 오는 날의 헌책방 냄새.' },
  { label: '', text: '수아가 오는 요일을 외운다.' },
];
const FILM = {
  ...DEV_FILM,
  extras: WORLD,
  persona: { ...DEV_FILM.persona, extras: MINE },
  casts: [{ ...DEV_FILM.casts[0], extras: HANSEO }, DEV_FILM.casts[1]],
};

async function fail(p: () => unknown): Promise<Fail | null> {
  try {
    await p();
  } catch (e) {
    if (e instanceof Fail) return e;
    throw e;
  }
  return null;
}

describe('덧붙이는 칸', () => {
  it('적은 그대로 저장된다. 항목 이름을 비우면 「메모」, 내용이 빈 칸은 버린다', () => {
    const film = parseFilm({ ...FILM, extras: [...WORLD, { label: '빈 칸', text: '  ' }] });
    expect(film.extras).toEqual(WORLD);
    expect(film.persona.extras).toEqual(MINE);
    expect(film.casts[0]!.extras).toEqual([HANSEO[0], { label: '메모', text: HANSEO[1]!.text }]);
    expect(film.casts[1]!.extras).toEqual([]);
  });

  it('칸의 길이와 수를 넘으면 어디인지 말하고 거절한다', async () => {
    const long = await fail(() => parseFilm({ ...FILM, extras: [{ label: '화폐', text: '가'.repeat(RULES.extras.text + 1) }] }));
    expect(long?.message).toContain('세계관');
    const many = Array.from({ length: RULES.extras.max + 1 }, (_, i) => ({ label: `항목 ${i}`, text: '내용' }));
    const over = await fail(() => parseFilm({ ...FILM, casts: [{ ...DEV_FILM.casts[0], extras: many }, DEV_FILM.casts[1]] }));
    expect(over?.message).toContain(`${RULES.extras.max}개`);
  });

  it('장면을 쓰는 작가에게 건네진다: 세계, 내 배역, 그 캐스트의 칸', async () => {
    const ctx = testCtx();
    const { id } = await createFilm(ctx, FILM);
    const v = await enter(ctx, id, uid());
    await say(ctx, v.id, { text: '안녕하세요.', requestId: uid() });
    const { cast } = ctx.model.calls.filter((c) => c.purpose === 'reply').at(-1)!.layers;
    expect(cast).toContain('- 이 세계의 화폐: 조개껍데기를 돈처럼 쓴다.');
    expect(cast).toContain('- 나이: 스물셋. 휴학 중이다.');
    const [hanseo, jihu] = cast.split('이름: 지후') as [string, string];
    expect(hanseo).toContain('- 좋아하는 것: 비 오는 날의 헌책방 냄새.');
    expect(hanseo).toContain('- 메모: 수아가 오는 요일을 외운다.');
    expect(jihu).not.toContain('헌책방');
  });

  it('플레이하는 사람의 화면으로는 보내지 않는다. 만든 사람이 고칠 때만 보낸다', async () => {
    const ctx = testCtx();
    const { id } = await createFilm(ctx, FILM);
    expect((await getFilm(ctx, id)).film.casts[0]!.extras).toHaveLength(2);
    const seen = (await getFilm({ ...ctx, visitor: OTHER_VISITOR }, id)).film;
    expect(seen.extras).toEqual([]);
    expect(seen.persona.extras).toEqual([]);
    expect(seen.casts[0]!.extras).toEqual([]);
    const v = await enter(ctx, id, uid());
    expect((await viewOf(ctx, v.id)).film.casts[0]!.extras).toEqual([]);
  });

  it('내 배역의 이름을 바꾸면 칸에 적힌 이름도 바뀐다', async () => {
    const ctx = testCtx();
    const { id } = await createFilm(ctx, FILM);
    const v = await enter(ctx, id, uid());
    await setMine(ctx, v.id, { name: '문리현', line: '', face: '' });
    await say(ctx, v.id, { text: '안녕하세요.', requestId: uid() });
    const { cast } = ctx.model.calls.filter((c) => c.purpose === 'reply').at(-1)!.layers;
    expect(cast).toContain('- 메모: 문리현이 오는 요일을 외운다.');
    expect(cast).toContain('- 나이: 스물셋. 휴학 중이다.');
  });

  it('만드는 화면: 처음에 빈 칸이 RULES.extras.show만큼 있다. 적은 칸만 필름으로 가고, 다시 열면 그 수까지 빈 칸을 채워 둔다', () => {
    const d = blankDraft();
    expect(d.extras).toHaveLength(RULES.extras.show);
    expect(d.personaExtras).toHaveLength(RULES.extras.show);
    expect(d.casts[0]!.extras).toHaveLength(RULES.extras.show);
    expect(d.extras.every((e) => e.label === '' && e.text === '')).toBe(true);

    const film = parseFilm(FILM);
    const back = fromFilm(film);
    const blanks = Array.from({ length: Math.max(0, RULES.extras.show - WORLD.length) }, () => ({ label: '', text: '' }));
    expect(back.extras).toEqual([...WORLD, ...blanks]);
    expect(back.casts[0]!.extras).toHaveLength(Math.max(film.casts[0]!.extras.length, RULES.extras.show));
    const again = parseFilm(toFilm(back));
    expect(again.extras).toEqual(film.extras);
    expect(again.persona.extras).toEqual(film.persona.extras);
    expect(again.casts.map((c) => c.extras)).toEqual(film.casts.map((c) => c.extras));
  });

  it('덧붙이는 칸이 없던 때의 필름과 쓰다 만 것도 읽힌다', () => {
    const film = parseFilm(DEV_FILM) as Film;
    const old = JSON.parse(JSON.stringify(film)) as Film;
    delete (old as Partial<Film>).extras;
    delete (old.persona as Partial<Film['persona']>).extras;
    delete (old.casts[0] as Partial<Film['casts'][0]>).extras;
    const read = readFilm(old);
    expect(read.extras).toEqual([]);
    expect(read.persona.extras).toEqual([]);
    expect(read.casts[0]!.extras).toEqual([]);
    const kept = readDraft({ title: '쓰다 만 것', casts: [{ name: '한서' }] });
    expect(kept.extras).toHaveLength(RULES.extras.show);
    expect(kept.casts[0]!.extras).toHaveLength(RULES.extras.show);
  });
});
