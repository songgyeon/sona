import { describe, expect, it } from 'vitest';
import { skipsAt } from '../../shared/clock';
import { blankDraft, fromFilm, toFilm } from '../../shared/draft';
import { readFilm } from '../../shared/opening';
import type { Film } from '../../shared/types';
import { createFilm, forScreen, parseFilm } from '../../worker/engine/films';
import { parseIncident } from '../../worker/engine/incident';
import { skip } from '../../worker/engine/skip';
import { viewOf } from '../../worker/engine/store';
import { enter, nextDay, say } from '../../worker/engine/turn';
import { FAKE_DEFAULTS } from '../../worker/model/fake';
import type { ModelCall } from '../../worker/model/index';
import { TWO_FILM, testCtx, uid } from '../helpers/film';

/* 바깥 사건 — 디렉터가 적어 둔, 캐스트도 내 인물도 아닌 바깥에서 일어날 일.
   시간을 넘길 때와 새 날을 열 때, 남은 것 가운데 지금 맞는 하나를 대사 모델이 골라 지금에 맞게 쓴다. 맞는 게 없으면 고르지 않는다.
   (2026-11-14 테스터: 「직구」에서 시간을 세 번 넘겼는데 세 번 다 「그 사이 별일 없었어요.」. 사용자가 디렉터의 사건 목록을 제안했다)
   시험용 필름은 금요일 오후 4시에 시작한다. 민아(c1)와 이도현(c2), 유저의 인물은 수아 */
const FILM = {
  ...TWO_FILM,
  incidents: [
    { text: '사내 게시판에 조직 개편 공지가 올라온다.', secret: false },
    { text: '{{user}}에게 인사팀이 면담하자고 연락한다.', secret: true },
  ],
};

type Pick = (call: ModelCall) => string;
async function setup(pick: Pick, film: unknown = FILM) {
  const ctx = testCtx((call) => (call.purpose === 'incident' ? pick(call) : FAKE_DEFAULTS[call.purpose]));
  const { id } = await createFilm(ctx, film);
  const v = await enter(ctx, id, uid());
  const calls = (purpose: ModelCall['purpose']) => ctx.model.calls.filter((c) => c.purpose === purpose);
  return { ctx, playId: v.id, calls };
}
const sleep = (ctx: Parameters<typeof skip>[0], playId: string) => skip(ctx, playId, { kind: 'sleep', requestId: uid() });
const talk = (ctx: Parameters<typeof say>[0], playId: string, text = '오늘 회의 몇 시였죠?') => say(ctx, playId, { text, requestId: uid() });

describe('바깥 사건: 필름에 적기', () => {
  it('글이 빈 사건은 버리고, 열 개를 넘으면 받지 않는다', () => {
    const film = parseFilm({ ...TWO_FILM, incidents: [{ text: '  공지가 올라온다.  ', secret: true }, { text: '   ' }] });
    expect(film.incidents).toEqual([{ text: '공지가 올라온다.', secret: true }]);
    const many = Array.from({ length: 11 }, (_, i) => ({ text: `사건 ${i}`, secret: false }));
    expect(() => parseFilm({ ...TWO_FILM, incidents: many })).toThrow(/10개까지/);
  });

  it('플레이하는 사람에게 가는 필름에는 사건 목록이 없다 — 앞일이 미리 보이지 않는다', () => {
    expect(forScreen(parseFilm(FILM)).incidents).toEqual([]);
  });

  it('바깥 사건이 생기기 전의 필름은 빈 목록으로 읽는다', () => {
    const old = { ...parseFilm(TWO_FILM) } as Partial<Film>;
    delete old.incidents;
    expect(readFilm(old as Film).incidents).toEqual([]);
  });

  it('만드는 칸과 필름을 오가도 사건과 「플레이하는 사람만 알아요」가 남는다. 빈 사건은 버린다', () => {
    const d = { ...fromFilm(parseFilm(TWO_FILM)), incidents: [{ text: '공지가 올라온다.', secret: true }, { text: ' ', secret: false }] };
    expect(blankDraft().incidents).toEqual([]);
    const film = parseFilm(toFilm(d));
    expect(film.incidents).toEqual([{ text: '공지가 올라온다.', secret: true }]);
    expect(fromFilm(film).incidents).toEqual([{ text: '공지가 올라온다.', secret: true }]);
  });
});

describe('바깥 사건: 대사 모델의 답 읽기', () => {
  it('「번호 | 글」에서 남은 번호만 받는다', () => {
    const left = new Set([0, 2]);
    expect(parseIncident('3 | 비가 쏟아진다.', left)).toEqual({ index: 2, text: '비가 쏟아진다.' });
    expect(parseIncident('2 | 이미 일어난 일.', left)).toBeNull();
    expect(parseIncident('없음', left)).toBeNull();
    expect(parseIncident('그냥 지나간다.', left)).toBeNull();
  });
});

describe('바깥 사건: 시간을 넘길 때', () => {
  it('모두 아는 사건은 흐름에 서고, 다음 장면의 작가도 안다', async () => {
    const { ctx, playId, calls } = await setup(() => '1 | 사내 게시판에 다음 달 조직 개편 공지가 올라왔다.');
    await talk(ctx, playId);
    const v = await sleep(ctx, playId);
    expect(v.incidents).toHaveLength(1);
    expect(v.incidents[0]).toMatchObject({ text: '사내 게시판에 다음 달 조직 개편 공지가 올라왔다.', secret: false });
    // 넘기기 시작하고 조금 뒤에 일어난다 — 그 사이 캐스트가 알고 움직일 수 있게
    expect(v.incidents[0]!.at).toBeGreaterThan(0);
    expect(v.incidents[0]!.at).toBeLessThan(v.elapsed);
    // 연출부에게 간 글: 수위 줄, 넘긴 사이, 남은 사건(번호 그대로)
    const ask = calls('incident')[0]!;
    expect(ask.layers.system).toContain('선정적인 묘사는 쓰지 않는다');
    expect(ask.layers.scene).toContain('[때]');
    expect(ask.layers.scene).toContain('1. 사내 게시판에 조직 개편 공지가 올라온다.');
    // 캐스트의 속사정은 건네지 않는다 — 바깥 사건으로 새어 나가면 안 된다
    expect(ask.layers.cast).not.toContain('외삼촌');
    await talk(ctx, playId, '좋은 아침이에요.');
    expect(calls('reply').at(-1)!.layers.scene).toContain('사내 게시판에 다음 달 조직 개편 공지가 올라왔다.');
  });

  it('플레이하는 사람만 아는 사건은 흐름에 서지만, 캐스트는 모른다', async () => {
    const { ctx, playId, calls } = await setup(() => '2 | 인사팀에서 수아에게 면담하자는 메시지가 와 있다.');
    const v = await sleep(ctx, playId);
    expect(v.incidents).toHaveLength(1);
    expect(v.incidents[0]).toMatchObject({ secret: true });
    // 디렉터가 쓴 {{user}}는 들어간 사람의 이름으로 건넨다
    expect(calls('incident')[0]!.layers.scene).toContain('2. (유저의 인물만 아는 일) 수아에게 인사팀이 면담하자고 연락한다.');
    await talk(ctx, playId, '좋은 아침이에요.');
    expect(calls('reply').at(-1)!.layers.scene).not.toContain('면담하자는 메시지');
  });

  it('한 번 일어난 사건은 다시 고를 수 없다', async () => {
    let n = 0;
    const { ctx, playId, calls } = await setup(() => (n++ === 0 ? '1 | 공지가 올라왔다.' : '1 | 공지가 또 올라왔다.'));
    await sleep(ctx, playId);
    const v = await skip(ctx, playId, { kind: 'evening', requestId: uid() });
    // 두 번째에는 남은 사건만 건넨다. 이미 일어난 사건을 골라 오면 받지 않는다
    expect(calls('incident')[1]!.layers.scene).not.toContain('1. 사내 게시판');
    expect(calls('incident')[1]!.layers.scene).toContain('[이미 일어난 바깥 사건]');
    expect(v.incidents.map((x) => x.text)).toEqual(['공지가 올라왔다.']);
  });

  it('맞는 사건이 없으면 고르지 않는다. 사건을 안 적은 필름은 묻지도 않는다', async () => {
    const a = await setup(() => '없음');
    expect((await sleep(a.ctx, a.playId)).incidents).toEqual([]);
    expect(a.calls('incident')).toHaveLength(1);

    const b = await setup(() => '1 | 공지가 올라왔다.', TWO_FILM);
    expect((await sleep(b.ctx, b.playId)).incidents).toEqual([]);
    expect(b.calls('incident')).toHaveLength(0);
  });
});

describe('바깥 사건: 새 날을 열 때', () => {
  it('하루가 끝난 삶을 다음 날로 이으면 사건이 하나 일어날 수 있다. 두 번 눌러도 하나다', async () => {
    const { ctx, playId, calls } = await setup((call) => (call.layers.scene.includes('새 날이 열렸다') ? '1 | 사내 게시판에 조직 개편 공지가 올라왔다.' : '없음'));
    await sleep(ctx, playId);
    const ended = await skip(ctx, playId, { kind: 'evening', requestId: uid() });
    expect(ended.ended).toBe(true);
    expect(ended.incidents).toEqual([]);
    const next = await nextDay(ctx, playId);
    expect(next.ended).toBe(false);
    expect(next.incidents).toHaveLength(1);
    expect(next.incidents[0]!.at).toBe(next.elapsed);
    const asked = calls('incident').length;
    const again = await nextDay(ctx, playId);
    expect(again.incidents).toHaveLength(1);
    expect(calls('incident')).toHaveLength(asked);
    expect((await viewOf(ctx, playId)).incidents).toHaveLength(1);
  });
});

describe('「저녁으로」', () => {
  const at = (h: number, m: number) => ({ startDow: 2, startMin: h * 60 + m, elapsed: 0 });
  it('저녁까지 한 시간이 안 남았으면 띄우지 않는다', () => {
    expect(skipsAt(at(18, 39), 1440).map((s) => s.label)).toEqual(['다음 날 아침으로']);
    expect(skipsAt(at(17, 30), 1440).map((s) => s.label)).toEqual(['저녁으로', '다음 날 아침으로']);
  });
});
