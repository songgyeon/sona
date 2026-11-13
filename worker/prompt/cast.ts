/* 프롬프트의 둘째 층 — 캐릭터.
   디렉터가 쓴 인물 카드를 그대로 옮긴다. 코드가 인물을 해석해서 덧붙이지 않는다. */

import { josa, pick } from '../../shared/ko';
import type { Cast, Film } from '../../shared/types';

/** [이 세계] — 배경과, 디렉터가 세계에 덧붙인 칸 */
function world(film: Film, out: string[]): void {
  const more = film.extras ?? [];
  if (!film.setting && more.length === 0) return;
  out.push('');
  out.push('[이 세계]');
  if (film.setting) out.push(film.setting);
  for (const e of more) out.push(`- ${e.label}: ${e.text}`);
}

/** 유저의 인물: 이름과 소개, 맡은 배역의 나이·직업, 덧붙인 칸. 대표 대사는 프로필에만 둔다 */
export function person(film: Film, out: string[]): void {
  const p = film.persona;
  out.push(p.line ? `${p.name} — ${p.line}` : p.name);
  if (p.age) out.push(`- 나이: ${p.age}`);
  if (p.job) out.push(`- 직업: ${p.job}`);
  for (const e of p.extras ?? []) out.push(`- ${e.label}: ${e.text}`);
}

export function castLayer(film: Film, cast: Cast): string {
  const me = film.persona.name;
  const out: string[] = [];

  out.push('[너]');
  out.push(`이름: ${cast.name}`);
  // 나이와 직업은 프로필에도 서는 칸이다. 대표 대사는 프로필에만 두고 여기에 싣지 않는다
  if (cast.age) out.push(`나이: ${cast.age}`);
  if (cast.job) out.push(`직업: ${cast.job}`);
  // 관계 칸은 디렉터가 어느 쪽에서 본 말로든 적는다. 방향을 정해 말하지 않고, 카드의 나머지와 같이 읽게 한다
  if (cast.role) out.push(`${josa(me, '과', '와')}의 관계: ${cast.role}`);
  if (cast.callsUser) out.push(`${josa(me, '을', '를')} 부르는 말: ${cast.callsUser}`);
  if (cast.speech) out.push(`말투: ${cast.speech}`);
  if (cast.nature) out.push(`성격: ${cast.nature}`);
  if (cast.habit) out.push(`습관: ${cast.habit}`);
  if (cast.trauma) out.push(`트라우마: ${cast.trauma}`);
  if (cast.lack) out.push(`결핍: ${cast.lack}`);
  if (cast.secret) out.push(`비밀: ${cast.secret}`);
  if (cast.dayPlace) out.push(`낮에 주로 있는 곳: ${cast.dayPlace}`);
  for (const e of cast.extras ?? []) out.push(`${e.label}: ${e.text}`);
  if (cast.samples.length > 0) {
    out.push('예시 대사(이 결로 쓴다. 그대로 베끼지 않는다):');
    for (const s of cast.samples) out.push(`- ${s}`);
  }

  world(film, out);

  out.push('');
  out.push('[상대]');
  person(film, out);

  const others = film.casts.filter((c) => c.key !== cast.key);
  if (others.length > 0) {
    out.push('');
    out.push('[네가 아는 사람들]');
    for (const o of others) {
      const tie = film.ties.find((t) => t.from === cast.key && t.to === o.key);
      const back = film.ties.find((t) => t.from === o.key && t.to === cast.key);
      // 그 사람의 나이·직업을 이름 옆에 둔다. 디렉터는 사이를 어느 쪽에서 본 말로든 적는다(「네 살 위」) —
      // 이름 바로 뒤에 붙이면 그 사람 얘기로 읽혀서 방향 없이 「둘의 사이」로 건네고, 서로 부르는 말을 둘 다 둔다.
      // (2026-11-14: 「PICK ME!」 차유결(26세)의 카드에 「유세온: 데뷔 동기, 네 살 위」로 갔고, 유결의 일기가 세온을 「세온 형」이라고 불렀다)
      const credit = [o.age, o.job].filter((s) => s && s.trim()).join(' · ');
      out.push(credit ? `- ${o.name} (${credit})` : `- ${o.name}`);
      if (tie?.relation) out.push(`  - 둘의 사이: ${tie.relation}`);
      if (tie?.calls) out.push(`  - 너는 이 사람을 「${tie.calls}」${pick(tie.calls, '이라고', '라고')} 부른다`);
      if (back?.calls) out.push(`  - 이 사람은 너를 「${back.calls}」${pick(back.calls, '이라고', '라고')} 부른다`);
      if (o.aliases.length > 0) {
        const last = o.aliases[o.aliases.length - 1]!;
        out.push(`  - ${josa(me, '은', '는')} 「${o.aliases.join('」, 「')}」${pick(last, '이라고도', '라고도')} 부른다`);
      }
    }
  }

  return out.join('\n');
}

const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

/** 장면을 쓰는 작가에게 건네는 인물 카드들. 나오는 사람 모두의 카드와 세계, 유저의 인물.
    디렉터가 쓴 그대로 옮긴다. 「너」가 아니라 이름으로 적는다 */
export function castsLayer(film: Film): string {
  const me = film.persona.name;
  const out: string[] = ['[나오는 사람들]'];
  film.casts.forEach((cast, i) => {
    if (i > 0) out.push('');
    out.push(`이름: ${cast.name}`);
    if (cast.age) out.push(`- 나이: ${cast.age}`);
    if (cast.job) out.push(`- 직업: ${cast.job}`);
    if (cast.role) out.push(`- ${josa(me, '과', '와')}의 관계: ${cast.role}`);
    if (cast.callsUser) out.push(`- ${josa(me, '을', '를')} 부르는 말: ${cast.callsUser}`);
    if (cast.aliases.length > 0) {
      const last = cast.aliases[cast.aliases.length - 1]!;
      out.push(`- ${josa(me, '은', '는')} 이 사람을 「${cast.aliases.join('」, 「')}」${pick(last, '이라고도', '라고도')} 부른다`);
    }
    if (cast.speech) out.push(`- 말투: ${cast.speech}`);
    if (cast.nature) out.push(`- 성격: ${cast.nature}`);
    if (cast.habit) out.push(`- 습관: ${cast.habit}`);
    if (cast.trauma) out.push(`- 트라우마: ${cast.trauma}`);
    if (cast.lack) out.push(`- 결핍: ${cast.lack}`);
    if (cast.secret) out.push(`- 비밀: ${cast.secret}`);
    if (cast.dayPlace) out.push(`- 낮에 주로 있는 곳: ${cast.dayPlace}`);
    for (const e of cast.extras ?? []) out.push(`- ${e.label}: ${e.text}`);
    out.push(`- 자는 시간: ${hhmm(cast.sleepFrom)} ~ ${hhmm(cast.sleepTo)}`);
    for (const o of film.casts) {
      if (o.key === cast.key) continue;
      const tie = film.ties.find((t) => t.from === cast.key && t.to === o.key);
      if (tie?.relation) out.push(`- ${o.name}에게는: ${tie.relation}`);
      if (tie?.calls) out.push(`- ${josa(o.name, '을', '를')} 「${tie.calls}」${pick(tie.calls, '이라고', '라고')} 부른다`);
    }
    if (cast.samples.length > 0) out.push(`- 예시 대사(이 결로 쓴다. 그대로 베끼지 않는다): ${cast.samples.join(' / ')}`);
  });

  world(film, out);

  out.push('');
  out.push('[유저의 인물]');
  person(film, out);
  return out.join('\n');
}
