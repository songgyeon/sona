/* 바깥 사건 — 디렉터가 적어 둔, 캐스트도 내 인물도 아닌 바깥에서 일어날 일(Film.incidents).
   일어날 수 있는 자리(시간을 넘길 때, 새 날을 열 때)와 그 때는 코드가 정한다. 남은 것 가운데 무엇이 지금 이야기에 맞는지 고르고
   지금에 맞게 쓰는 것은 대사 모델이 한다. 맞는 게 없으면 고르지 않는다. 한 번 일어난 사건은 그 삶에서 다시 일어나지 않는다.
   일어난 일은 아는 일(events, kind 'incident', actor 'world:번호')로 적는다 — 모두 아는 일이면 캐스트도 그때부터 알고,
   플레이하는 사람만 아는 일이면 캐스트는 모른다. 아는 일과 같은 표라서 장면 저장과 삶 지우기도 그대로 따라간다.
   (2026-11-14 테스터: 「직구」에서 시간을 세 번 넘겼는데 세 번 다 「그 사이 별일 없었어요.」였다.
    사용자: 「제작할 때 선택사항으로 제작자가 사건 목록 적게 하고 모델이 이야기에 맞춰 제공하는 거」) */

import { RULES } from '../../shared/rules';
import type { Incident, IncidentView, MessageView } from '../../shared/types';
import { q, type Db } from '../db';
import type { Layers, ModelCall, ModelOut } from '../model/index';
import { lineOf, stamp, when } from '../prompt/scene';
import { INCIDENT_SYSTEM } from '../prompt/system';
import type { Ctx } from './ctx';
import { type Play, sceneMessages } from './store';
import { ask, errText, knownTo, logStmt, toLines } from './talk';

export const INCIDENT_KIND = 'incident';

const actorOf = (i: number) => `world:${i}`;
const indexOf = (actor: string): number | null => {
  const m = /^world:(\d+)$/.exec(actor);
  return m ? Number(m[1]) : null;
};

const CUE = '(남은 사건 가운데 지금 맞는 하나를 골라 쓴다. 맞는 것이 없으면 없음.)';

/** 대사 모델의 답을 읽는다. 「번호 | 글」 한 줄. 남은 번호가 아니거나 모양이 틀리면 고르지 않은 것이다 */
export function parseIncident(raw: string, left: Set<number>): { index: number; text: string } | null {
  for (const line of raw.split('\n')) {
    const m = /^\s*(\d+)\s*[|｜]\s*(.+?)\s*$/.exec(line);
    if (!m) continue;
    const index = Number(m[1]) - 1;
    const text = m[2]!;
    if (!left.has(index) || text.length > RULES.limits.incident * 2) return null;
    return { index, text };
  }
  return null;
}

/** 이 삶에서 일어난 바깥 사건들. 일어난 차례대로 */
export async function incidentsOf(db: Db, playId: string): Promise<IncidentView[]> {
  const rows = await db.all<{ id: string; at: number; text: string; known_by: string }>(
    "SELECT id, at, text, known_by FROM events WHERE play_id = ? AND kind = 'incident' ORDER BY at, rowid",
    playId,
  );
  // 캐스트가 아무도 모르면 플레이하는 사람만 아는 일이다
  return rows.map((r) => ({ id: r.id, at: r.at, text: r.text, secret: !(JSON.parse(r.known_by) as string[]).some((k) => k !== 'persona') }));
}

/** 지나간 장면에서 뒤에서부터 이 글자 수만큼. 무엇이 지금 맞는지 고르는 데는 최근 장면이면 된다 */
function lastChars(messages: MessageView[], max: number): MessageView[] {
  let chars = 0;
  let from = messages.length;
  while (from > 0) {
    const next = messages[from - 1]!.text.length + 8;
    if (chars + next > max) break;
    chars += next;
    from -= 1;
  }
  return messages.slice(from);
}

/** 연출부에게 건네는 글. 캐스트의 속사정(성격·트라우마·비밀 등)은 건네지 않는다 — 바깥 사건으로 새어 나가면 안 된다 */
async function incidentLayers(
  ctx: Ctx,
  play: Play,
  list: Incident[],
  left: Set<number>,
  at: number,
  span: { from: number; to: number } | null,
  past: IncidentView[],
): Promise<Layers> {
  const film = play.film;
  const cast: string[] = ['[이 세계]', film.setting || '(적힌 것 없음)'];
  for (const e of film.extras ?? []) cast.push(`- ${e.label}: ${e.text}`);
  cast.push('', '[나오는 사람들]');
  for (const c of film.casts) {
    const credit = [c.age, c.job].filter((s) => s && s.trim()).join(' · ');
    cast.push(`- ${c.name}${credit ? ` (${credit})` : ''}${c.role ? `: ${c.role}` : ''}`);
  }
  cast.push('', '[유저의 인물]', `${film.persona.name}${film.persona.line ? `: ${film.persona.line}` : ''}`);

  const lines = toLines(play, lastChars(await sceneMessages(ctx.db, play), RULES.incident.historyChars)).map(lineOf);
  const { shared } = await knownTo(ctx, play);
  const scene: string[] = ['[지금까지의 장면]', lines.length > 0 ? lines.join('\n') : '(아직 없음)'];
  const others = shared.filter((e) => !past.some((p) => p.at === e.at && p.text === e.text));
  if (others.length > 0) {
    scene.push('', '[모두 아는 일]');
    for (const e of others.slice(-12)) scene.push(`- (${when(play, e.at)}) ${e.text}`);
  }
  if (past.length > 0) {
    scene.push('', '[이미 일어난 바깥 사건]');
    for (const p of past) scene.push(`- (${when(play, p.at)}) ${p.secret ? '(유저의 인물만 아는 일) ' : ''}${p.text}`);
  }
  scene.push(
    '',
    '[때]',
    span ? `${stamp(play, span.from)}부터 ${stamp(play, span.to)}까지. [유저의 인물]이 시간을 넘긴 사이다.` : `새 날이 열렸다. 지금은 ${stamp(play, at)}.`,
  );
  scene.push('', '[남은 사건]');
  for (const i of [...left].sort((a, b) => a - b)) scene.push(`${i + 1}. ${list[i]!.secret ? '(유저의 인물만 아는 일) ' : ''}${list[i]!.text}`);
  return { system: INCIDENT_SYSTEM, cast: cast.join('\n'), scene: scene.join('\n') };
}

/** 바깥 사건이 일어날 수 있는 자리. span이 있으면 시간을 넘긴 사이(from~to), 없으면 새 날이 열린 때(지금).
    id는 그 자리의 이름이다 — 같은 자리에서 두 번 일어나지 않는다(다시 받기, 두 번 누름).
    바로 적는다: 넘긴 사이의 다른 일(캐스트가 보낸 시간, 먼저 거는 연락, 피드)보다 먼저 적혀야 캐스트가 그 사이에 알고 움직인다 */
export async function happen(ctx: Ctx, play: Play, id: string, turnId: string, span: { from: number; to: number } | null): Promise<void> {
  const list = play.film.incidents ?? [];
  if (list.length === 0) return;
  if (await ctx.db.first<{ id: string }>('SELECT id FROM events WHERE id = ?', id)) return;
  let at = play.elapsed;
  if (span) {
    const gap = span.to - span.from;
    if (gap < RULES.incident.minSpan) return;
    // 일찍 일어나야 그 사이에 캐스트가 알고 연락할 수 있다
    at = span.from + Math.max(1, Math.min(RULES.incident.leadMin, Math.floor(gap / 4)));
  }
  const past = await incidentsOf(ctx.db, play.id);
  const usedRows = await ctx.db.all<{ actor: string }>("SELECT actor FROM events WHERE play_id = ? AND kind = 'incident'", play.id);
  const used = new Set(usedRows.map((r) => indexOf(r.actor)).filter((n): n is number => n !== null));
  const left = new Set(list.map((_, i) => i).filter((i) => !used.has(i)));
  if (left.size === 0) return;

  const call: ModelCall = {
    purpose: 'incident',
    layers: await incidentLayers(ctx, play, list, left, at, span, past),
    user: CUE,
    temperature: 0.7,
    maxTokens: 300,
  };
  let out: ModelOut | null = null;
  try {
    out = await ask(ctx, call);
  } catch (e) {
    // 못 받으면 아무 일도 없던 것이다. 시계는 이미 갔다
    await ctx.db.batch([logStmt(ctx, play.id, turnId, call, out, false, errText(e))]);
    return;
  }
  const picked = parseIncident(out.text, left);
  const stmts = [logStmt(ctx, play.id, turnId, call, out, picked !== null, picked ? null : '고르지 않음')];
  if (picked) {
    const secret = list[picked.index]!.secret;
    const knownBy = secret ? ['persona'] : [...play.film.casts.map((c) => c.key), 'persona'];
    stmts.push(
      q(
        'INSERT OR IGNORE INTO events (id, play_id, turn_id, at, kind, actor, text, known_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        id,
        play.id,
        turnId,
        at,
        INCIDENT_KIND,
        actorOf(picked.index),
        picked.text,
        JSON.stringify(knownBy),
        ctx.now(),
      ),
    );
  }
  await ctx.db.batch(stmts);
}
