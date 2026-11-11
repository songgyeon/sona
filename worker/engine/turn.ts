/* 입장, 한 마디, 다시 받기.
   시계를 미는 것은 여기뿐이다 — 유저의 전송 1건에 정해진 만큼. 모델은 못 민다. */

import { wasThere } from '../../shared/opening';
import { RULES } from '../../shared/rules';
import type { PlayView } from '../../shared/types';
import { isUniqueError, newId, q, type Stmt } from '../db';
import { isUuid } from '../guard';
import { type Ctx, Fail } from './ctx';
import { getFilm } from './films';
import { lastTurn, loadPlay, viewOf } from './store';
import { settle } from './skip';
import { answer } from './talk';

/** 필름에 들어간다. 같은 playId로 두 번 불러도 삶은 하나다 */
export async function enter(ctx: Ctx, filmId: string, playId: unknown): Promise<PlayView> {
  if (!isUuid(playId)) throw new Fail(400, 'bad_play_id', '요청이 올바르지 않아요.');

  const existing = await ctx.db.first<{ owner: string }>('SELECT owner FROM plays WHERE id = ?', playId);
  if (existing) {
    if (existing.owner !== ctx.visitor) throw new Fail(404, 'play_missing', '살고 있던 필름을 찾을 수 없어요.');
    return viewOf(ctx, playId);
  }

  const { film } = await getFilm(ctx, filmId);
  const fs = film.firstScene;
  const cast = film.casts.find((c) => c.key === fs.room)!;
  const turnId = newId();
  const now = ctx.now();
  const scripted = fs.speaker === 'cast' && fs.firstLine.length > 0;
  const needsModel = fs.speaker === 'cast' && !scripted;

  const stmts: Stmt[] = [
    q(
      'INSERT INTO plays (id, film_id, owner, film, start_dow, start_min, elapsed, ended, created_at) VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?)',
      playId,
      filmId,
      ctx.visitor,
      JSON.stringify(film),
      film.startDow,
      film.startMin,
      now,
    ),
    q(
      'INSERT INTO turns (id, play_id, turn_no, request_id, kind, room, status, elapsed_before, elapsed_after, created_at) VALUES (?, ?, 1, ?, ?, ?, ?, 0, 0, ?)',
      turnId,
      playId,
      playId,
      'enter',
      cast.key,
      needsModel ? 'pending' : 'done',
      now,
    ),
  ];
  // 첫 장면에서 있었던 일. 그 자리에 있던 사람만 안다
  const tells = fs.beats.flatMap((b) => (b.kind === 'tell' ? [b.text] : []));
  if (fs.place || tells.length > 0) {
    stmts.push(
      q(
        'INSERT INTO events (id, play_id, turn_id, at, kind, actor, text, known_by, created_at) VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?)',
        newId(),
        playId,
        turnId,
        'scene',
        'world',
        [fs.place, tells.join(' ')].filter(Boolean).join(' — '),
        JSON.stringify(['persona', ...film.casts.filter((c) => wasThere(film, c.key)).map((c) => c.key)]),
        now,
      ),
    );
  }
  if (scripted) {
    stmts.push(
      q(
        'INSERT INTO messages (id, play_id, turn_id, room, speaker, text, at, kind, created_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)',
        newId(),
        playId,
        turnId,
        cast.key,
        cast.key,
        fs.firstLine,
        'first',
        now,
      ),
    );
  }

  try {
    await ctx.db.batch(stmts);
  } catch (e) {
    if (isUniqueError(e)) return viewOf(ctx, playId);
    throw e;
  }

  if (needsModel) {
    const play = await loadPlay(ctx, playId);
    const turn = (await lastTurn(ctx.db, playId))!;
    await answer(ctx, play, turn);
  }
  return viewOf(ctx, playId);
}

export interface SayInput {
  room: unknown;
  text: unknown;
  requestId: unknown;
}

/** 유저의 한 마디. 전송 1건 = 턴 1개 = 정해진 작중 시간 */
export async function say(ctx: Ctx, playId: string, input: SayInput): Promise<PlayView> {
  if (!isUuid(input.requestId)) throw new Fail(400, 'bad_request_id', '요청이 올바르지 않아요.');
  const play = await loadPlay(ctx, playId);

  // 같은 전송이 또 들어왔다 — 이미 한 일을 다시 하지 않는다
  const dup = await ctx.db.first<{ id: string }>(
    'SELECT id FROM turns WHERE play_id = ? AND request_id = ?',
    playId,
    input.requestId,
  );
  if (dup) return viewOf(ctx, playId);

  if (play.ended) throw new Fail(409, 'ended', '하루가 끝났어요. 다음 날로 이어 살 수 있어요.');

  const last = await lastTurn(ctx.db, playId);
  if (last && last.status !== 'done') {
    throw new Fail(409, 'stuck', '앞의 대사를 아직 받지 못했어요. 다시 받기를 눌러 주세요.');
  }

  const cast = play.film.casts.find((c) => c.key === input.room);
  if (!cast) throw new Fail(400, 'bad_room', '인물을 찾을 수 없어요.');

  const text = typeof input.text === 'string' ? input.text.trim() : '';
  if (text.length === 0) throw new Fail(400, 'empty_say', '보낼 말을 입력해 주세요.');
  if (text.length > RULES.limits.say) throw new Fail(400, 'long_say', `한 번에 ${RULES.limits.say}자까지 보낼 수 있어요.`);

  const before = play.elapsed;
  const after = before + RULES.minutesPerSend;
  const turnId = newId();
  const turnNo = (last?.no ?? 0) + 1;
  const now = ctx.now();

  try {
    await ctx.db.batch([
      q(
        'INSERT INTO turns (id, play_id, turn_no, request_id, kind, room, status, elapsed_before, elapsed_after, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        turnId,
        playId,
        turnNo,
        input.requestId,
        'say',
        cast.key,
        'pending',
        before,
        after,
        now,
      ),
      q(
        'INSERT INTO messages (id, play_id, turn_id, room, speaker, text, at, kind, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        newId(),
        playId,
        turnId,
        cast.key,
        'persona',
        text,
        after,
        'chat',
        now,
      ),
      q('UPDATE plays SET elapsed = ? WHERE id = ?', after, playId),
    ]);
  } catch (e) {
    // 두 전송이 같은 턴 번호를 잡았다. 먼저 온 쪽만 처리된다
    if (isUniqueError(e)) {
      const again = await ctx.db.first<{ id: string }>(
        'SELECT id FROM turns WHERE play_id = ? AND request_id = ?',
        playId,
        input.requestId,
      );
      if (again) return viewOf(ctx, playId);
      throw new Fail(409, 'busy', '앞의 말을 처리하고 있어요. 잠시 뒤에 다시 보내 주세요.');
    }
    throw e;
  }

  await answer(
    ctx,
    { ...play, elapsed: after },
    { id: turnId, no: turnNo, kind: 'say', room: cast.key, status: 'pending', failReason: null },
  );
  return viewOf(ctx, playId);
}

/** 하루가 끝난 삶을 다음 날로 잇는다. 같은 삶, 같은 시각에서 하루가 더 열린다.
    끝나지 않은 삶에는 아무 일도 하지 않는다 — 두 번 눌러도 하루만 는다 */
export async function nextDay(ctx: Ctx, playId: string): Promise<PlayView> {
  const play = await loadPlay(ctx, playId);
  if (play.ended) await ctx.db.run('UPDATE plays SET ended = 0, days = days + 1 WHERE id = ? AND ended = 1', playId);
  return viewOf(ctx, playId);
}

/** 답을 못 받은 턴을 다시 받는다. 시계는 다시 안 간다 */
export async function retry(ctx: Ctx, playId: string): Promise<PlayView> {
  const play = await loadPlay(ctx, playId);
  const last = await lastTurn(ctx.db, playId);
  if (!last || last.status === 'done') return viewOf(ctx, playId);
  if (last.kind === 'skip') {
    // 자리 비우기를 마무리하다 끊겼다. 시계는 이미 갔으니 그 구간을 마저 닫는다
    const row = await ctx.db.first<{ elapsed_before: number; elapsed_after: number }>(
      'SELECT elapsed_before, elapsed_after FROM turns WHERE id = ?',
      last.id,
    );
    await settle(ctx, play, last.id, row!.elapsed_before, row!.elapsed_after);
    return viewOf(ctx, playId);
  }
  await answer(ctx, play, last);
  return viewOf(ctx, playId);
}
