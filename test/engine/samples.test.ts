import { describe, expect, it } from 'vitest';
import { blankCast, blankDraft, toFilm } from '../../shared/draft';
import { RULES } from '../../shared/rules';
import type { Film } from '../../shared/types';
import { Fail } from '../../worker/engine/ctx';
import { parseFilm } from '../../worker/engine/films';
import { DEV_FILM } from '../helpers/film';

/* 캐스트의 예시 대사. 사용자가 세 줄에서 열 줄로 늘렸다(2026-11-13) */

const lines = (n: number) => Array.from({ length: n }, (_, i) => `대사 ${i + 1}`);
const withSamples = (samples: string[]) => ({ ...DEV_FILM, casts: [{ ...DEV_FILM.casts[0], samples }, DEV_FILM.casts[1]] });

describe('캐스트의 예시 대사', () => {
  it(`${RULES.limits.samples}줄까지 받는다. 넘으면 몇 줄까지인지 말하고 거절한다`, () => {
    expect(parseFilm(withSamples(lines(RULES.limits.samples))).casts[0]!.samples).toHaveLength(RULES.limits.samples);
    let err: unknown = null;
    try {
      parseFilm(withSamples(lines(RULES.limits.samples + 1)));
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(Fail);
    expect((err as Fail).message).toContain(`${RULES.limits.samples}개`);
  });

  it('만드는 화면에서 한 줄에 하나씩 적은 대로 필름에 들어간다', () => {
    const draft = { ...blankDraft(), casts: [{ ...blankCast(), name: '한서', samples: lines(RULES.limits.samples).join('\n') }] };
    expect((toFilm(draft) as Film).casts[0]!.samples).toEqual(lines(RULES.limits.samples));
  });
});
