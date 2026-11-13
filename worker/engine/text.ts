/* 유저의 문자 — 폰으로 캐스트 한 사람에게 보낸다.
   한 번 보낼 때마다 대사 한 번만큼 시간이 흐른다. 장면은 멈춰 있다 — 장면을 쓰는 작가는 부르지 않는다.
   받는 사람이 깨어 있으면 그 사람이 되어 문자로 답한다(textReply). 자고 있으면 답이 없다 —
   깨어 있게 된 다음 기회(대사 턴의 lifeWork, 시간 넘기기의 answerTexts)에 답한다.
   문자는 유저와 그 사람만 안다. 남의 프롬프트에는 건네지 않는다(heardBy).
   (2026-11-13 사용자: 「그 유저도 문자 보내는 기능 만들어주」. 시안 A·B·C와 규칙을 보고 「다 조아 규칙」) */

import { trialOver } from '../../shared/clock';
import { RULES } from '../../shared/rules';
import type { PlayView } from '../../shared/types';
import { isUniqueError, newId, q, type Stmt } from '../db';
import { isUuid } from '../guard';
import { awake, keep, presentCasts, textReply } from './alive';
import { type Ctx, Fail } from './ctx';
import { lastTurn, loadPlay, type Play, sceneMessages, viewOf } from './store';
import { errText } from './talk';

export interface TextInput {
  /** 받는 캐스트의 이름표 */
  to: unknown;
  /** 문자. 지문 없이 글만이다 */
  text: unknown;
  requestId: unknown;
}

/** 문자 한 통. 전송 1건 = 턴 1개 = 대사 한 번만큼의 작중 시간 */
export async function sendText(ctx: Ctx, playId: string, input: TextInput): Promise<PlayView> {
  if (!isUuid(input.requestId)) throw new Fail(400, 'bad_request_id', '요청이 올바르지 않아요.');
  const play = await loadPlay(ctx, playId);

  // 같은 전송이 또 들어왔다 — 이미 한 일을 다시 하지 않는다
  const dup = await ctx.db.first<{ id: string }>('SELECT id FROM turns WHERE play_id = ? AND request_id = ?', playId, input.requestId);
  if (dup) return viewOf(ctx, playId);

  if (play.ended) throw new Fail(409, 'ended', '하루가 끝났어요. 다음 날로 이어 살 수 있어요.');
  const last = await lastTurn(ctx.db, playId);
  if (last && last.status !== 'done') {
    throw new Fail(409, 'stuck', '앞의 대사를 아직 받지 못했어요. 다시 받기를 눌러 주세요.');
  }

  const cast = play.film.casts.find((c) => c.key === input.to);
  if (!cast) throw new Fail(400, 'bad_to', '받는 사람을 찾을 수 없어요.');
  const text = typeof input.text === 'string' ? input.text.trim() : '';
  if (text.length === 0) throw new Fail(400, 'empty_text', '보낼 문자를 입력해 주세요.');
  if (text.length > RULES.limits.text) throw new Fail(400, 'long_text', `문자는 한 번에 ${RULES.limits.text}자까지 보낼 수 있어요.`);

  const before = play.elapsed;
  const after = before + RULES.minutesPerSend;
  const turnId = newId();
  const turnNo = (last?.no ?? 0) + 1;
  const now = ctx.now();

  try {
    await ctx.db.batch([
      // 턴의 room은 받는 사람이다. 답장을 받으면 done이 된다(끊기면 다시 받기로 마저 받는다)
      q(
        'INSERT INTO turns (id, play_id, turn_no, request_id, kind, room, status, elapsed_before, elapsed_after, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        turnId,
        playId,
        turnNo,
        input.requestId,
        'text',
        cast.key,
        'pending',
        before,
        after,
        now,
      ),
      // 폰으로 오간 메시지는 kind가 ping이다. 유저가 보낸 것은 speaker가 persona, room이 받는 사람이다
      q(
        'INSERT INTO messages (id, play_id, turn_id, room, speaker, text, at, kind, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        newId(),
        playId,
        turnId,
        cast.key,
        'persona',
        text,
        after,
        'ping',
        now,
      ),
      q('UPDATE plays SET elapsed = ? WHERE id = ?', after, playId),
    ]);
  } catch (e) {
    // 두 전송이 같은 턴 번호를 잡았다. 먼저 온 쪽만 처리된다
    if (isUniqueError(e)) {
      const again = await ctx.db.first<{ id: string }>('SELECT id FROM turns WHERE play_id = ? AND request_id = ?', playId, input.requestId);
      if (again) return viewOf(ctx, playId);
      throw new Fail(409, 'busy', '앞의 말을 처리하고 있어요. 잠시 뒤에 다시 보내 주세요.');
    }
    throw e;
  }

  await finishText(ctx, { ...play, elapsed: after }, turnId, cast.key);
  return viewOf(ctx, playId);
}

/** 문자 턴을 마무리한다: 받는 사람이 깨어 있으면 답장을 받고, 턴을 닫는다.
    답장을 못 받아도 턴은 닫는다 — 그 문자는 답하지 않은 문자로 남아 다음 기회에 답한다. 장면이 멈추지 않는다 */
export async function finishText(ctx: Ctx, play: Play, turnId: string, castKey: string): Promise<void> {
  const cast = play.film.casts.find((c) => c.key === castKey);
  const stmts: Stmt[] = [];
  if (cast && awake(play, cast, play.elapsed)) {
    try {
      const all = await sceneMessages(ctx.db, play);
      const got = await textReply(ctx, play, cast, turnId, play.elapsed, all, presentCasts(play, all).has(cast.key));
      if (got) stmts.push(...keep(got));
    } catch (e) {
      console.warn('문자 답장을 못 받음', errText(e));
    }
  }
  stmts.push(q("UPDATE turns SET status = 'done', fail_reason = NULL WHERE id = ?", turnId));
  if (trialOver(play.elapsed, play.days)) stmts.push(q('UPDATE plays SET ended = 1 WHERE id = ?', play.id));
  await ctx.db.batch(stmts);
}
