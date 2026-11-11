import { describe, expect, it } from 'vitest';
import { RULES } from '../../shared/rules';
import { Fail } from '../../worker/engine/ctx';
import { fromFilm, readDraft, toFilm } from '../../shared/draft';
import { createFilm, getFilm, listFilms, parseFilm, updateFilm } from '../../worker/engine/films';
import { viewOf } from '../../worker/engine/store';
import { enter, retry, say } from '../../worker/engine/turn';
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

  it('다른 사람의 목록에는 나오지 않는다', async () => {
    const { ctx, filmId } = await setup();
    expect((await listFilms(ctx)).map((f) => f.id)).toEqual([filmId]);
    expect(await listFilms({ ...ctx, visitor: OTHER_VISITOR })).toEqual([]);
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
    expect(view.messages[0]).toMatchObject({ room: 'c1', speaker: 'c1', kind: 'first', at: 0 });
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
    const { ctx, playId } = await setup(() => '한서가 책을 내려놓는다.\n\n  "네."  \n"그건 제가 할게요."\n계산대 뒤로 돌아간다.\n');
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
    const { ctx, playId } = await setup(() => '한서가 고개를 든다.\n"왔어요?"');
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

  it('한 방에서 한 얘기는 다른 인물의 프롬프트에 안 실린다', async () => {
    const { ctx, playId } = await setup();
    await send(ctx, playId, '이건 한서 씨한테만 하는 얘긴데, 나 다음 달에 그만둬요.', 'c1');
    await send(ctx, playId, '안녕하세요.', 'c2');
    const toJihu = ctx.model.calls.at(-1)!;
    expect(toJihu.layers.cast).toContain('이름: 지후');
    const everything = [toJihu.layers.system, toJihu.layers.cast, toJihu.layers.scene, toJihu.user].join('\n');
    expect(everything).not.toContain('그만둬요');
    // 반대로 그 방의 인물에게는 실린다
    await send(ctx, playId, '아까 한 말 기억하죠?', 'c1');
    expect(ctx.model.calls.at(-1)!.layers.scene).toContain('그만둬요');
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
    expect(layers.user).toBe('안녕');
  });
});

describe('답을 못 받았을 때', () => {
  it('빈 답이면 턴이 멈추고, 다시 받아도 시계는 또 안 간다', async () => {
    let n = 0;
    const { ctx, playId } = await setup((call) =>
      call.purpose !== 'reply' ? FAKE_DEFAULTS[call.purpose] : n++ === 0 ? '   \n ' : '"네."',
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
