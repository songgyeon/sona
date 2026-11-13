import { describe, expect, it } from 'vitest';
import { RULES } from '../../shared/rules';
import { openFeed } from '../../worker/engine/alive';
import { createFilm, parseFilm } from '../../worker/engine/films';
import { enter } from '../../worker/engine/turn';
import { castLayer } from '../../worker/prompt/cast';
import { feedSystem } from '../../worker/prompt/system';
import { DEV_FILM, testCtx, uid } from '../helpers/film';

/* 캐스트끼리의 사이 — 인물 한 사람이 되어 쓰는 프롬프트(피드, 혼자 보낸 시간, 먼저 거는 연락, 문자 답장)에 가는 모양.
   디렉터는 사이를 어느 쪽에서 본 말로든 적는다. 「PICK ME!」의 차유결(26세) 카드에는 세온과의 사이가 「데뷔 동기, 네 살 위」로 적혀 있었고,
   이름 바로 뒤에 붙어 「유세온: 데뷔 동기, 네 살 위」로 가자 유결의 일기가 세온을 「세온 형」이라고 불렀다(2026-11-14).
   임시 필름의 한서(c1)를 유결처럼, 지후(c2)를 세온처럼 둔다. */
const FILM = parseFilm({
  ...DEV_FILM,
  opens: { feed: true, ping: true, aside: true },
  casts: [
    { ...DEV_FILM.casts[0], age: '26세', job: '서점 알바' },
    { ...DEV_FILM.casts[1], age: '22세', job: '대학원생' },
  ],
  ties: [
    { from: 'c1', to: 'c2', relation: '데뷔 동기, 네 살 위. 숙소에선 앙숙.', calls: '지후' },
    { from: 'c2', to: 'c1', relation: '네 살 아래. 서로를 제일 잘 안다.', calls: '형' },
  ],
});

describe('캐스트끼리의 사이', () => {
  it('그 사람의 나이·직업이 이름 옆에, 사이는 방향 없이, 서로 부르는 말은 둘 다 간다', () => {
    const c1 = castLayer(FILM, FILM.casts[0]!);
    expect(c1).toContain('- 지후 (22세 · 대학원생)');
    expect(c1).toContain('  - 둘의 사이: 데뷔 동기, 네 살 위. 숙소에선 앙숙.');
    expect(c1).toContain('  - 너는 이 사람을 「지후」라고 부른다');
    expect(c1).toContain('  - 이 사람은 너를 「형」이라고 부른다');
    // 사이가 그 사람의 이름 바로 뒤에 붙지 않는다 — 그 사람 얘기로 읽히던 모양
    expect(c1).not.toContain('- 지후: ');
    // 상대의 사이(그쪽에서 본 말)는 건네지 않는다 — 「네 살 위」와 「네 살 아래」가 한 카드에 서면 헷갈린다
    expect(c1).not.toContain('네 살 아래');

    const c2 = castLayer(FILM, FILM.casts[1]!);
    expect(c2).toContain('- 한서 (26세 · 서점 알바)');
    expect(c2).toContain('  - 너는 이 사람을 「형」이라고 부른다');
    expect(c2).toContain('  - 이 사람은 너를 「지후」라고 부른다');
  });

  it('나이·직업이 없는 예전 필름은 이름만 선다', () => {
    const old = parseFilm({ ...DEV_FILM, ties: [] });
    const c1 = castLayer(old, old.casts[0]!);
    expect(c1).toContain('[네가 아는 사람들]\n- 지후');
    expect(c1).not.toContain('- 지후 (');
  });

  it('필름에 들어가 피드를 열면, 이야기 전 피드를 쓰는 대사 모델에게 그 모양이 간다', async () => {
    const ctx = testCtx();
    const { id } = await createFilm(ctx, FILM);
    const v = await enter(ctx, id, uid());
    await openFeed(ctx, v.id);
    const past = ctx.model.calls.filter((c) => c.purpose === 'past');
    expect(past.length).toBeGreaterThan(0);
    const hanseo = past.find((c) => c.layers.cast.includes('이름: 한서'))!.layers.cast;
    expect(hanseo).toContain('- 지후 (22세 · 대학원생)');
    expect(hanseo).toContain('이 사람은 너를 「형」이라고 부른다');
  });
});

describe('피드에 쓰지 않는 말', () => {
  it('규칙에 낱말이 분명히 서고, 예로 든 장면은 없다', () => {
    const sys = feedSystem(['diary', 'song', 'search'], true);
    expect(sys).toContain(`이 말은 쓰지 않는다: ${RULES.feed.avoid.join(', ')}`);
    expect(RULES.feed.avoid).toContain('거울');
    expect(sys).not.toContain('거울 속 내 모습');
  });
});
