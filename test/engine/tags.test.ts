import { describe, expect, it } from 'vitest';
import { blankDraft, fromFilm, toFilm } from '../../shared/draft';
import { readFilm } from '../../shared/opening';
import { RULES } from '../../shared/rules';
import { matches, readTags, topTags } from '../../shared/tags';
import type { Film } from '../../shared/types';
import { Fail } from '../../worker/engine/ctx';
import { createFilm, listFilms, parseFilm } from '../../worker/engine/films';
import { DEV_FILM, testCtx } from '../helpers/film';

/* 해시태그: 필름 만들기에서 적고, 필름 정보와 아카이브에 보이고, 아카이브에서 해시태그로 찾는다 */

function fail(f: () => unknown): Fail | null {
  try {
    f();
  } catch (e) {
    if (e instanceof Fail) return e;
    throw e;
  }
  return null;
}

describe('해시태그', () => {
  it('빈칸·쉼표·#으로 나눠 고른다. 같은 것은 한 번만, #은 뺀다', () => {
    expect(readTags('#집착 #재벌, 혐관  #집착')).toEqual(['집착', '재벌', '혐관']);
    expect(readTags('##BL#hl  bl')).toEqual(['BL', 'hl']);
    expect(readTags('   ')).toEqual([]);
  });

  it('필름에 그대로 들어가고, 개수나 길이를 넘으면 알린다. 해시태그가 생기기 전의 필름은 비어 있다', () => {
    expect(parseFilm({ ...DEV_FILM, tags: ['#집착', '재벌 혐관'] }).tags).toEqual(['집착', '재벌', '혐관']);
    expect(parseFilm({ ...DEV_FILM }).tags).toEqual([]);
    const many = Array.from({ length: RULES.limits.tags + 1 }, (_, i) => `태그${i}`);
    expect(fail(() => parseFilm({ ...DEV_FILM, tags: many }))?.message).toContain(`${RULES.limits.tags}개`);
    expect(fail(() => parseFilm({ ...DEV_FILM, tags: ['가'.repeat(RULES.limits.tag + 1)] }))?.message).toContain(`${RULES.limits.tag}자`);
    expect(fail(() => parseFilm({ ...DEV_FILM, tags: '집착' }))?.code).toBe('film_invalid');
    const old = JSON.parse(JSON.stringify(parseFilm(DEV_FILM))) as Partial<Film>;
    delete old.tags;
    expect(readFilm(old as Film).tags).toEqual([]);
  });

  it('목록의 필름 카드에 실린다', async () => {
    const ctx = testCtx();
    const { id } = await createFilm(ctx, { ...DEV_FILM, tags: ['집착', '재벌'] });
    expect((await listFilms(ctx)).find((f) => f.id === id)!.tags).toEqual(['집착', '재벌']);
  });

  it('만드는 화면에서는 적은 그대로 두고, 필름으로 갈 때 고른다. 고칠 때는 #을 붙여 다시 보인다', () => {
    const film = toFilm({ ...blankDraft(), title: '적과 흑', tags: '#집착 재벌' }) as Film;
    expect(film.tags).toEqual(['집착', '재벌']);
    expect(fromFilm(parseFilm({ ...DEV_FILM, tags: ['집착', '재벌'] })).tags).toBe('#집착 #재벌');
  });

  it('찾기: #으로 시작하면 해시태그만, 아니면 제목·소개·캐스트·해시태그를 다 본다. 많이 붙은 해시태그부터', () => {
    const a = { title: '적과 흑', logline: '', castNames: ['서하'], tags: ['집착', '재벌'] };
    const b = { title: '수몰지구', logline: '재개발', castNames: ['배이안'], tags: ['피폐', '집착'] };
    expect([a, b].filter((f) => matches(f, '#집')).map((f) => f.title)).toEqual(['적과 흑', '수몰지구']);
    expect([a, b].filter((f) => matches(f, '#재')).map((f) => f.title)).toEqual(['적과 흑']);
    expect([a, b].filter((f) => matches(f, '재')).map((f) => f.title)).toEqual(['적과 흑', '수몰지구']);
    expect([a, b].filter((f) => matches(f, '이안')).map((f) => f.title)).toEqual(['수몰지구']);
    expect(topTags([a, b], 2)).toEqual(['집착', '재벌']);
  });
});
