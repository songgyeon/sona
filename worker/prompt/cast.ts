/* 프롬프트의 둘째 층 — 캐릭터.
   디렉터가 쓴 인물 카드를 그대로 옮긴다. 코드가 인물을 해석해서 덧붙이지 않는다. */

import { josa, pick } from '../../shared/ko';
import type { Cast, Film } from '../../shared/types';

export function castLayer(film: Film, cast: Cast): string {
  const me = film.persona.name;
  const out: string[] = [];

  out.push('[너]');
  out.push(`이름: ${cast.name}`);
  if (cast.role) out.push(`${me}에게 너는: ${cast.role}`);
  if (cast.callsUser) out.push(`${josa(me, '을', '를')} 부르는 말: ${cast.callsUser}`);
  if (cast.speech) out.push(`말투: ${cast.speech}`);
  if (cast.dayPlace) out.push(`낮에 주로 있는 곳: ${cast.dayPlace}`);
  if (cast.samples.length > 0) {
    out.push('예시 대사(이 결로 쓴다. 그대로 베끼지 않는다):');
    for (const s of cast.samples) out.push(`- ${s}`);
  }

  if (film.setting) {
    out.push('');
    out.push('[이 세계]');
    out.push(film.setting);
  }

  out.push('');
  out.push('[상대]');
  out.push(film.persona.line ? `${me} — ${film.persona.line}` : me);
  const before = film.persona.formerly ?? [];
  if (before.length > 0) {
    const last = before[before.length - 1]!;
    out.push(`(전에는 「${before.join('」, 「')}」${pick(last, '이라고', '라고')} 불렸다. 같은 사람이다. 지금은 ${josa(me, '이라고', '라고')} 부른다.)`);
  }

  const others = film.casts.filter((c) => c.key !== cast.key);
  if (others.length > 0) {
    out.push('');
    out.push('[네가 아는 사람들]');
    for (const o of others) {
      const tie = film.ties.find((t) => t.from === cast.key && t.to === o.key);
      const bits: string[] = [];
      if (tie?.relation) bits.push(tie.relation);
      if (tie?.calls) bits.push(`너는 이 사람을 「${tie.calls}」${pick(tie.calls, '이라고', '라고')} 부른다`);
      if (o.aliases.length > 0) {
        const last = o.aliases[o.aliases.length - 1]!;
        bits.push(`${josa(me, '은', '는')} 「${o.aliases.join('」, 「')}」${pick(last, '이라고도', '라고도')} 부른다`);
      }
      out.push(`- ${o.name}${bits.length > 0 ? ': ' + bits.join('. ') : ''}`);
    }
  }

  return out.join('\n');
}
