import { describe, expect, it } from 'vitest';
import { RULES } from '../../shared/rules';
import { Fail } from '../../worker/engine/ctx';
import { fromFilm, readDraft, toFilm } from '../../shared/draft';
import { createFilm, getFilm, listFilms, parseFilm, updateFilm } from '../../worker/engine/films';
import { viewOf } from '../../worker/engine/store';
import { skip } from '../../worker/engine/skip';
import { enter, nextDay, retry, say } from '../../worker/engine/turn';
import { FAKE_DEFAULTS, type Script } from '../../worker/model/fake';
import { DEV_FILM, OTHER_VISITOR, testCtx, uid } from '../helpers/film';

const CUT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CUT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

async function setup(script?: Script, film: unknown = DEV_FILM) {
  const ctx = testCtx(script);
  const { id: filmId } = await createFilm(ctx, film);
  const playId = uid();
  const view = await enter(ctx, filmId, playId);
  return { ctx, filmId, playId, view };
}

const send = (ctx: ReturnType<typeof testCtx>, playId: string, text: string, room = 'c1', requestId = uid()) =>
  say(ctx, playId, { room, text, requestId });

async function failCode(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    if (e instanceof Fail) return e.code;
    throw e;
  }
  return 'no-fail';
}

describe('필름 읽기', () => {
  it('캐스트에 이름표를 순서대로 붙인다', () => {
    const film = parseFilm(DEV_FILM);
    expect(film.casts.map((c) => c.key)).toEqual(['c1', 'c2']);
    expect(film.ties[0]).toMatchObject({ from: 'c1', to: 'c2', calls: '형' });
  });

  it('비어 있으면 안 되는 칸을 말해 준다', async () => {
    expect(await failCode(Promise.resolve().then(() => parseFilm({ ...DEV_FILM, title: ' ' })))).toBe('film_invalid');
    expect(await failCode(Promise.resolve().then(() => parseFilm({ ...DEV_FILM, casts: [] })))).toBe('film_invalid');
    expect(
      await failCode(
        Promise.resolve().then(() => parseFilm({ ...DEV_FILM, ties: [{ from: 'c1', to: 'c9', relation: '?', calls: '' }] })),
      ),
    ).toBe('film_invalid');
  });
});

describe('필름을 링크로 보여 주기', () => {
  it('주소를 아는 다른 사람도 필름을 읽고 들어갈 수 있다', async () => {
    const { ctx, filmId } = await setup();
    const other = { ...ctx, visitor: OTHER_VISITOR };

    const got = await getFilm(other, filmId);
    expect(got.card.mine).toBe(false);
    expect(got.film.title).toBe(DEV_FILM.title);

    const view = await enter(other, filmId, uid());
    expect(view.filmId).toBe(filmId);
    expect(view.messages).toHaveLength(1);
    // 그 사람이 사는 삶은 그 사람 것이다. 만든 사람도 못 읽는다
    expect(await failCode(viewOf(ctx, view.id))).toBe('play_missing');
  });

  it('개봉한 필름은 누구의 목록에나 나온다. 내 것인지는 사람마다 다르게 적힌다', async () => {
    const { ctx } = await setup();
    const { id } = await createFilm(ctx, { ...DEV_FILM, title: '동네 서점' });
    const mine = (await listFilms(ctx)).find((f) => f.id === id)!;
    const theirs = (await listFilms({ ...ctx, visitor: OTHER_VISITOR })).find((f) => f.id === id)!;
    expect([mine.title, mine.mine]).toEqual(['동네 서점', true]);
    expect([theirs.title, theirs.mine]).toEqual(['동네 서점', false]);
  });

  it('시험하느라 만든 필름은 만든 사람에게만 보인다. 주소로는 누구나 들어온다', async () => {
    const { ctx, filmId } = await setup();
    expect(DEV_FILM.title.startsWith('개발용 —')).toBe(true);
    expect((await listFilms(ctx)).map((f) => f.id)).toEqual([filmId]);
    expect(await listFilms({ ...ctx, visitor: OTHER_VISITOR })).toEqual([]);
    expect((await getFilm({ ...ctx, visitor: OTHER_VISITOR }, filmId)).film.title).toBe(DEV_FILM.title);
  });

  it('남이 개봉한 필름에 들어가도 삶은 저마다 따로다. 서로의 삶을 읽지 못한다', async () => {
    const { ctx } = await setup();
    const { id } = await createFilm(ctx, { ...DEV_FILM, title: '동네 서점' });
    const other = { ...ctx, visitor: OTHER_VISITOR };
    const mine = await enter(ctx, id, uid());
    const theirs = await enter(other, id, uid());
    await say(ctx, mine.id, { room: 'c1', text: '이건 나만 한 말이에요.', requestId: uid() });
    expect(mine.id).not.toBe(theirs.id);
    expect((await viewOf(other, theirs.id)).messages.some((m) => m.text.includes('나만 한 말'))).toBe(false);
    expect(await failCode(viewOf(other, mine.id))).toBe('play_missing');
    expect(await failCode(viewOf(ctx, theirs.id))).toBe('play_missing');
    expect(await failCode(say(other, mine.id, { room: 'c1', text: '끼어들기', requestId: uid() }))).toBe('play_missing');
  });

  it('없는 필름은 없다고 한다', async () => {
    const { ctx } = await setup();
    expect(await failCode(getFilm(ctx, uid()))).toBe('film_missing');
  });
});

describe('필름 고치기', () => {
  it('만든 사람이 고치면 필름이 바뀐다', async () => {
    const { ctx, filmId } = await setup();
    await updateFilm(ctx, filmId, { ...DEV_FILM, title: '고친 제목', logline: '고친 한 줄' });
    const { card, film } = await getFilm(ctx, filmId);
    expect(card).toMatchObject({ title: '고친 제목', logline: '고친 한 줄', mine: true });
    expect(film.title).toBe('고친 제목');
    expect((await listFilms(ctx)).map((f) => f.title)).toEqual(['고친 제목']);
  });

  it('다른 사람은 못 고친다. 필름은 그대로다', async () => {
    const { ctx, filmId } = await setup();
    expect(await failCode(updateFilm({ ...ctx, visitor: OTHER_VISITOR }, filmId, { ...DEV_FILM, title: '남이 고침' }))).toBe('not_owner');
    expect((await getFilm(ctx, filmId)).film.title).toBe(DEV_FILM.title);
  });

  it('맞지 않는 내용으로는 안 고쳐진다', async () => {
    const { ctx, filmId } = await setup();
    expect(await failCode(updateFilm(ctx, filmId, { ...DEV_FILM, title: ' ' }))).toBe('film_invalid');
    expect((await getFilm(ctx, filmId)).film.title).toBe(DEV_FILM.title);
  });

  it('살고 있던 삶은 들어갈 때의 필름 그대로 간다. 새로 들어가면 고친 필름이다', async () => {
    const { ctx, filmId, playId } = await setup();
    await updateFilm(ctx, filmId, { ...DEV_FILM, title: '고친 제목' });
    expect((await viewOf(ctx, playId)).film.title).toBe(DEV_FILM.title);
    expect((await enter(ctx, filmId, uid())).film.title).toBe('고친 제목');
  });

  it('필름을 만들기 화면의 칸으로 되돌렸다가 다시 필름으로 바꿔도 같다', () => {
    const film = parseFilm({
      ...DEV_FILM,
      firstScene: {
        place: '서점 계산대',
        beats: [
          { kind: 'tell', text: '손님이 끊긴 오후.\n둘이 책을 정리하고 있다.' },
          { kind: 'cut', image: CUT_A },
          { kind: 'say', cast: 'c1', text: '수아 씨, 그건 이쪽 칸이에요.' },
          { kind: 'say', cast: 'c2', text: '오늘도 그 자리 비었어요?' },
          { kind: 'cut', image: CUT_B },
        ],
        room: 'c1',
        speaker: 'persona',
      },
    });
    expect(film.stills).toEqual([CUT_A, CUT_B]);
    expect(parseFilm(toFilm(fromFilm(film)))).toEqual(film);
  });

  it('예전 필름을 칸으로 되돌리면 첫 마디가 오프닝의 대사 칸이 된다', () => {
    const old = parseFilm(DEV_FILM);
    expect(old.firstScene.firstLine).toBe(DEV_FILM.firstScene.firstLine);

    const again = parseFilm(toFilm(fromFilm(old)));
    expect(again.firstScene.beats).toEqual([
      { kind: 'tell', text: DEV_FILM.firstScene.situation },
      { kind: 'say', cast: 'c1', text: DEV_FILM.firstScene.firstLine },
    ]);
    // 그 말은 이미 오프닝에 있다. 대사 모델이 또 열지 않는다
    expect(again.firstScene).toMatchObject({ firstLine: '', speaker: 'persona' });
  });

  it('이 기기에 남겨 둔 예전 모양의 쓰다 만 내용도 칸으로 읽힌다', () => {
    const d = readDraft({ title: '쓰다 만 것', stills: [CUT_A, CUT_B], situation: '점심 뒤.', speaker: 'cast', firstLine: '왔어요?' });
    expect(d.beats.map((b) => [b.kind, b.kind === 'cut' ? b.image : b.text])).toEqual([
      ['cut', CUT_A],
      ['tell', '점심 뒤.'],
      ['say', '왔어요?'],
      ['cut', CUT_B],
    ]);
    expect(d.speaker).toBe('persona');
    expect(d.title).toBe('쓰다 만 것');
  });
});

describe('입장', () => {
  it('디렉터가 쓴 첫 마디로 시작한다 — 모델을 부르지 않는다', async () => {
    const { ctx, view } = await setup();
    expect(view.elapsed).toBe(0);
    expect(view.messages).toHaveLength(1);
    expect(view.messages[0]).toMatchObject({ room: 'scene', speaker: 'c1', kind: 'first', at: 0 });
    expect(view.messages[0]!.text).toBe(DEV_FILM.firstScene.firstLine);
    expect(ctx.model.calls).toHaveLength(0);
  });

  it('같은 입장 표로 두 번 들어와도 삶은 하나다', async () => {
    const { ctx, filmId, playId } = await setup();
    const again = await enter(ctx, filmId, playId);
    expect(again.messages).toHaveLength(1);
    const plays = await ctx.db.all('SELECT id FROM plays');
    expect(plays).toHaveLength(1);
  });

  it('첫 마디를 비워 두면 모델이 쓴다', async () => {
    const film = { ...DEV_FILM, firstScene: { ...DEV_FILM.firstScene, firstLine: '' } };
    const { ctx, view } = await setup(() => '어, 왔어요?', film);
    expect(view.messages.map((m) => m.text)).toEqual(['어, 왔어요?']);
    expect(ctx.model.calls.map((c) => c.purpose)).toEqual(['first']);
  });

  it('남의 플레이는 안 읽힌다', async () => {
    const { ctx, playId } = await setup();
    expect(await failCode(viewOf({ ...ctx, visitor: OTHER_VISITOR }, playId))).toBe('play_missing');
  });
});

describe('한 마디', () => {
  it('전송 1건마다 정해진 만큼만 시간이 간다', async () => {
    const { ctx, playId } = await setup();
    for (let i = 1; i <= 5; i++) {
      const v = await send(ctx, playId, `말 ${i}`);
      expect(v.elapsed).toBe(i * RULES.minutesPerSend);
    }
  });

  it('모델이 뭐라고 쓰든 시계는 안 움직인다', async () => {
    const { ctx, playId } = await setup(() => '그렇게 일주일이 지났어요.\n벌써 다음 달이네요.');
    const v = await send(ctx, playId, '안녕');
    expect(v.elapsed).toBe(RULES.minutesPerSend);
    expect(v.ended).toBe(false);
  });

  it('모델이 쓴 대목을 지문과 대사로 갈라 남긴다', async () => {
    const { ctx, playId } = await setup(() => '한서가 책을 내려놓는다.\n\n  한서: "네."  \n한서: "그건 제가 할게요."\n계산대 뒤로 돌아간다.\n');
    const v = await send(ctx, playId, '이거 어디 둬요?');
    const got = v.messages.filter((m) => m.kind === 'chat' && m.speaker !== 'persona').map((m) => [m.speaker, m.text]);
    expect(got).toEqual([
      ['tell', '한서가 책을 내려놓는다.'],
      ['c1', '네.'],
      ['c1', '그건 제가 할게요.'],
      ['tell', '계산대 뒤로 돌아간다.'],
    ]);
  });

  it('지나간 지문과 대사가 다음 턴의 프롬프트에 장면으로 실린다', async () => {
    const { ctx, playId } = await setup(() => '한서가 고개를 든다.\n한서: "왔어요?"');
    await send(ctx, playId, '응, 방금.');
    await send(ctx, playId, '오늘 바빴어?');
    const scene = ctx.model.calls.filter((c) => c.purpose === 'reply').at(-1)!.layers.scene;
    expect(scene).toContain('[지금까지의 장면]');
    // 지문은 그대로, 캐스트의 대사는 따옴표로, 유저의 말은 받은 그대로
    expect(scene).toContain('\n한서가 고개를 든다.\n한서: "왔어요?"');
    expect(scene).toContain('수아: 응, 방금.');
  });

  it('같은 전송이 두 번 들어와도 턴은 하나다', async () => {
    const { ctx, playId } = await setup();
    const requestId = uid();
    await send(ctx, playId, '안녕', 'c1', requestId);
    const v = await send(ctx, playId, '안녕', 'c1', requestId);
    expect(v.elapsed).toBe(RULES.minutesPerSend);
    expect(v.messages.filter((m) => m.speaker === 'persona')).toHaveLength(1);
    expect(ctx.model.calls.filter((c) => c.purpose === 'reply')).toHaveLength(1);
  });

  it('채팅은 하나다. 캐스트마다 방이 따로이던 때의 화면이 방을 보내도 한 흐름에 적힌다', async () => {
    const { ctx, playId } = await setup();
    await send(ctx, playId, '한서 씨, 나 다음 달에 그만둬요.', 'c1');
    const v = await send(ctx, playId, '안녕하세요.', 'c2');
    expect(v.messages.filter((m) => m.speaker === 'persona').map((m) => m.room)).toEqual(['scene', 'scene']);
    // 앞에서 한 말은 지나간 장면에 그대로 있다
    expect(ctx.model.calls.at(-1)!.layers.scene).toContain('수아: 한서 씨, 나 다음 달에 그만둬요.');
  });

  it('보낸 프롬프트를 층별로 남긴다', async () => {
    const { ctx, playId } = await setup();
    await send(ctx, playId, '안녕');
    const row = await ctx.db.first<{ layers: string; accepted: number; purpose: string }>(
      "SELECT layers, accepted, purpose FROM gen_log WHERE play_id = ? AND purpose = 'reply'",
      playId,
    );
    const layers = JSON.parse(row!.layers) as Record<string, string>;
    expect(row).toMatchObject({ accepted: 1, purpose: 'reply' });
    expect(layers.system).toContain('소나');
    expect(layers.cast).toContain('이름: 한서');
    expect(layers.scene).toContain('[지금]');
    expect(layers.user!.split('\n')[0]).toBe('수아: 안녕');
  });
});

describe('답을 못 받았을 때', () => {
  it('빈 답이면 턴이 멈추고, 다시 받아도 시계는 또 안 간다', async () => {
    let n = 0;
    const { ctx, playId } = await setup((call) =>
      call.purpose !== 'reply' ? FAKE_DEFAULTS[call.purpose] : n++ === 0 ? '   \n ' : '한서: "네."',
    );
    const stuck = await send(ctx, playId, '안녕');
    expect(stuck.stuck).toMatchObject({ status: 'failed', failReason: 'empty' });
    expect(stuck.elapsed).toBe(RULES.minutesPerSend);

    // 멈춘 동안에는 새 말을 못 보낸다
    expect(await failCode(send(ctx, playId, '여보세요'))).toBe('stuck');

    const again = await retry(ctx, playId);
    expect(again.stuck).toBeNull();
    expect(again.elapsed).toBe(RULES.minutesPerSend);
    expect(again.messages.at(-1)).toMatchObject({ speaker: 'c1', text: '네.' });

    // 버린 답도 기록에 남는다
    const logs = await ctx.db.all<{ accepted: number; note: string | null }>(
      "SELECT accepted, note FROM gen_log WHERE play_id = ? AND purpose = 'reply' ORDER BY rowid",
      playId,
    );
    expect(logs.map((l) => l.accepted)).toEqual([0, 1]);
    expect(logs[0]!.note).toBe('빈 답');
  });

  it('모델이 넘어져도 각본으로 덮지 않는다', async () => {
    const { ctx, playId } = await setup(() => {
      throw new Error('upstream 503');
    });
    const v = await send(ctx, playId, '안녕');
    expect(v.stuck).toMatchObject({ status: 'failed', failReason: 'model_error' });
    expect(v.messages.filter((m) => m.speaker === 'c1' && m.kind === 'chat')).toHaveLength(0);
  });
});

describe('첫 하루의 끝', () => {
  it('24시간이 되면 끝나고, 더는 못 보낸다', async () => {
    const { ctx, playId } = await setup();
    await ctx.db.run('UPDATE plays SET elapsed = ? WHERE id = ?', RULES.trialMinutes - RULES.minutesPerSend, playId);
    const v = await send(ctx, playId, '마지막 말');
    expect(v.elapsed).toBe(RULES.trialMinutes);
    expect(v.ended).toBe(true);
    // 그 전송까지는 답을 받는다
    expect(v.messages.at(-1)).toMatchObject({ speaker: 'c1' });
    expect(await failCode(send(ctx, playId, '하나만 더'))).toBe('ended');
  });
});

describe('다음 날로 이어 살기', () => {
  async function atTheEnd() {
    const s = await setup();
    await s.ctx.db.run('UPDATE plays SET elapsed = ? WHERE id = ?', RULES.trialMinutes - RULES.minutesPerSend, s.playId);
    const v = await send(s.ctx, s.playId, '마지막 말');
    expect(v).toMatchObject({ ended: true, day: 1 });
    return s;
  }

  it('하루가 끝난 삶을 이으면 같은 삶, 같은 시각에서 하루가 더 열린다', async () => {
    const { ctx, playId } = await atTheEnd();
    const before = await viewOf(ctx, playId);

    const v = await nextDay(ctx, playId);
    expect(v).toMatchObject({ id: playId, ended: false, day: 2, elapsed: RULES.trialMinutes });
    expect(v.messages).toEqual(before.messages);

    const said = await send(ctx, playId, '좋은 아침');
    expect(said.elapsed).toBe(RULES.trialMinutes + RULES.minutesPerSend);
    expect(said.ended).toBe(false);
    expect(said.messages.at(-1)).toMatchObject({ speaker: 'c1' });
  });

  it('둘째 날도 하루가 차면 끝난다', async () => {
    const { ctx, playId } = await atTheEnd();
    await nextDay(ctx, playId);
    await ctx.db.run('UPDATE plays SET elapsed = ? WHERE id = ?', RULES.trialMinutes * 2 - RULES.minutesPerSend, playId);
    const v = await send(ctx, playId, '오늘의 마지막 말');
    expect(v).toMatchObject({ ended: true, day: 2, elapsed: RULES.trialMinutes * 2 });
    expect(await failCode(send(ctx, playId, '하나만 더'))).toBe('ended');
    expect((await nextDay(ctx, playId)).day).toBe(3);
  });

  it('시간을 넘겨도 열어 둔 날의 끝을 넘지 않는다', async () => {
    const { ctx, playId } = await atTheEnd();
    await nextDay(ctx, playId);
    // 둘째 날의 끝이 가까울 때 다음 날 아침으로 넘기면 둘째 날의 끝에서 멈춘다
    await ctx.db.run('UPDATE plays SET elapsed = ? WHERE id = ?', RULES.trialMinutes * 2 - 30, playId);
    const v = await skip(ctx, playId, { kind: 'sleep', requestId: uid() });
    expect(v).toMatchObject({ elapsed: RULES.trialMinutes * 2, ended: true, day: 2 });
  });

  it('끝나지 않은 삶에는 아무 일도 하지 않는다. 두 번 눌러도 하루만 는다', async () => {
    const { ctx, playId } = await setup();
    expect(await nextDay(ctx, playId)).toMatchObject({ ended: false, day: 1 });

    const ended = await atTheEnd();
    await nextDay(ended.ctx, ended.playId);
    expect(await nextDay(ended.ctx, ended.playId)).toMatchObject({ ended: false, day: 2 });
  });

  it('남의 삶은 못 잇는다', async () => {
    const { ctx, playId } = await atTheEnd();
    expect(await failCode(nextDay({ ...ctx, visitor: OTHER_VISITOR }, playId))).toBe('play_missing');
    expect((await viewOf(ctx, playId)).ended).toBe(true);
  });

  it('내가 만든 필름인지 삶에 적혀 온다', async () => {
    const { ctx, filmId, playId } = await setup();
    expect((await viewOf(ctx, playId)).mine).toBe(true);
    const guest = { ...ctx, visitor: OTHER_VISITOR };
    expect((await enter(guest, filmId, uid())).mine).toBe(false);
  });
});
