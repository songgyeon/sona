import { describe, expect, it } from 'vitest';
import { formatWorld } from '../../shared/clock';
import { RULES } from '../../shared/rules';
import { Fail } from '../../worker/engine/ctx';
import { createFilm } from '../../worker/engine/films';
import { parseGap } from '../../worker/engine/gap';
import { pingHeld, pingSlots } from '../../worker/engine/ping';
import { skip } from '../../worker/engine/skip';
import { enter, say } from '../../worker/engine/turn';
import { FAKE_DEFAULTS } from '../../worker/model/fake';
import type { ModelCall, Purpose } from '../../worker/model/index';
import { TWO_FILM, testCtx, uid } from '../helpers/film';

/* 금요일 오후 4시에 시작한다. 민아는 0시~6시, 이도현은 0시~7시에 잔다.
   자고 오면 토요일 오전 7시다 — 민아는 깨어 있고(6시 반에 걸어 볼 수 있다) 이도현은 방금 일어났다. */
const clock = (elapsed: number) => ({ startDow: 5, startMin: 16 * 60, elapsed });
const at = (elapsed: number) => formatWorld(clock(elapsed));

const MINA_DAY = ['18:30 | 일상 | 퇴근길에 서점에 들렀다.', '19:10 | 말거리 | 서점에서 선배가 말한 책을 봤다.', '22:40 | 피드 | 오늘은 일찍 잔다'].join('\n');

type Part = string | ((call: ModelCall) => string);
function script(parts: Partial<Record<Purpose, Part>>) {
  return (call: ModelCall): string => {
    const p = parts[call.purpose];
    if (p === undefined) return FAKE_DEFAULTS[call.purpose];
    return typeof p === 'function' ? p(call) : p;
  };
}
const forMina = (text: string, other = '') => (call: ModelCall) => (call.layers.cast.includes('이름: 민아') ? text : other);

async function setup(parts: Partial<Record<Purpose, Part>>, film: unknown = TWO_FILM) {
  const ctx = testCtx(script(parts));
  const { id: filmId } = await createFilm(ctx, film);
  const playId = uid();
  await enter(ctx, filmId, playId);
  const send = (text: string, room = 'c1') => say(ctx, playId, { room, text, requestId: uid() });
  const away = (kind: 'short' | 'errand' | 'evening' | 'sleep', requestId = uid()) => skip(ctx, playId, { kind, requestId });
  const calls = (purpose: Purpose) => ctx.model.calls.filter((c) => c.purpose === purpose);
  const setElapsed = (elapsed: number) => ctx.db.run('UPDATE plays SET elapsed = ? WHERE id = ?', elapsed, playId);
  return { ctx, playId, send, away, calls, setElapsed };
}

async function failCode(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'ok';
  } catch (e) {
    if (e instanceof Fail) return e.code;
    throw e;
  }
}

describe('자리 비우기와 시계', () => {
  it('정해진 만큼만 간다', async () => {
    const { away } = await setup({});
    expect((await away('short')).elapsed).toBe(20);
    expect((await away('errand')).elapsed).toBe(140);
    expect(at((await away('sleep')).elapsed)).toBe('토요일 오전 7:00');
  });

  it('저녁으로 넘기면 다음에 오는 저녁 7시가 된다', async () => {
    const { away } = await setup({});
    // 금요일 오후 4시에 시작한다
    expect(at((await away('evening')).elapsed)).toBe('금요일 오후 7:00');
    // 이미 저녁이면 다음 날 저녁을 향해 가는데, 첫 하루가 그 전에 끝난다. 거기서 멈춘다
    const v = await away('evening');
    expect(at(v.elapsed)).toBe('토요일 오후 4:00');
    expect(v.ended).toBe(true);
  });

  it('첫 하루를 넘겨서 건너뛰지 않는다', async () => {
    const { away, setElapsed } = await setup({});
    await setElapsed(RULES.trialMinutes - 40);
    const v = await away('errand');
    expect(v.elapsed).toBe(RULES.trialMinutes);
    expect(v.ended).toBe(true);
    expect(await failCode(away('short'))).toBe('ended');
  });

  it('같은 전송은 한 번만 처리한다', async () => {
    const { away } = await setup({});
    const id = uid();
    await away('errand', id);
    expect((await away('errand', id)).elapsed).toBe(120);
  });

  it('그 사이의 일을 못 만들어도 시계는 간다 — 조용한 구간으로 남는다', async () => {
    const { away } = await setup({
      gap: () => {
        throw new Error('upstream 503');
      },
    });
    const v = await away('sleep');
    expect(at(v.elapsed)).toBe('토요일 오전 7:00');
    expect(v.stuck).toBeNull();
    expect(v.posts).toHaveLength(0);
  });

  it('잠깐 비운 동안에는 아무 일도 만들지 않는다', async () => {
    const { away, calls } = await setup({ gap: MINA_DAY });
    await away('short');
    expect(calls('gap')).toHaveLength(0);
  });
});

describe('그 사이의 하루', () => {
  it('줄마다 확인해서 안 맞는 줄만 버린다', () => {
    const mina = { sleepFrom: 0, sleepTo: 6 * 60 } as any;
    const raw = [
      '18:30 | 일상 | 퇴근길에 서점에 들렀다.',
      '저녁에는 집에서 쉬었다.', // 모양이 다르다
      '19:00 | 속마음 | 조금 서운했다.', // 없는 종류
      '15:00 | 일상 | 점심을 먹었다.', // 구간 밖(시작 전)
      '03:00 | 일상 | 물을 마시러 일어났다.', // 자는 시간
      '22:40 | 피드 | 오늘은 일찍 잔다',
      '23:10 | 피드 | 진짜 잔다', // 피드는 한 줄까지
    ].join('\n');
    const { items, drops } = parseGap(raw, clock(3), 3, 900, mina);
    expect(items.map((i) => [at(i.at), i.kind, i.text])).toEqual([
      ['금요일 오후 6:30', 'daily', '퇴근길에 서점에 들렀다.'],
      ['금요일 오후 10:40', 'post', '오늘은 일찍 잔다'],
    ]);
    expect(drops.map((d) => d.reason)).toEqual(['shape', 'kind', 'out_of_span', 'asleep', 'too_many']);
  });

  it('혼자 한 일은 그 사람만 알고, 피드 글은 모두가 "피드에서 봤다"로 안다', async () => {
    const { send, away, calls } = await setup({ gap: forMina(MINA_DAY) });
    await send('먼저 갈게.');
    const v = await away('sleep');
    expect(v.posts.map((p) => [p.cast, p.text, at(p.at)])).toEqual([['c1', '오늘은 일찍 잔다', '금요일 오후 10:40']]);

    await send('좋은 아침.', 'c1');
    const mina = calls('reply').at(-1)!.layers.scene;
    expect(mina).toContain('퇴근길에 서점에 들렀다.');
    expect(mina).toContain('피드에 올렸다: 「오늘은 일찍 잔다」');

    await send('안녕하세요.', 'c2');
    const dohyun = calls('reply').at(-1)!.layers.scene;
    expect(dohyun).not.toContain('서점에 들렀다'); // 민아가 혼자 한 일은 모른다
    expect(dohyun).toContain('민아의 피드에서 봤다: 「오늘은 일찍 잔다」');
  });

  it('유저가 없는 자리에 유저가 나오는 줄은 버린다. 떠올리는 것은 된다', async () => {
    const day = ['20:00 | 일상 | 수아와 같이 저녁을 먹었다.', '21:00 | 일상 | 수아가 권한 노래를 들었다.'].join('\n');
    const { send, away, calls } = await setup({
      gap: forMina(day),
      check: (c) => (c.user.includes('같이 저녁') ? '판정: 있음' : '판정: 없음'),
    });
    await send('먼저 갈게.');
    await away('sleep');
    await send('좋은 아침.');
    const scene = calls('reply').at(-1)!.layers.scene;
    expect(scene).not.toContain('같이 저녁을 먹었다');
    expect(scene).toContain('수아가 권한 노래를 들었다.');
  });
});

describe('먼저 오는 연락', () => {
  it('걸어 볼 시각은 코드가 정한다: 저녁, 그리고 일어난 뒤', () => {
    const mina = { sleepFrom: 0, sleepTo: 6 * 60 } as any;
    const dohyun = { sleepFrom: 0, sleepTo: 7 * 60 } as any;
    expect(pingSlots(clock(3), mina, 3, 900).map(at)).toEqual(['금요일 오후 7:30', '토요일 오전 6:30']);
    // 이도현은 7시 반에야 걸 수 있는데 유저는 7시에 돌아온다
    expect(pingSlots(clock(3), dohyun, 3, 900).map(at)).toEqual(['금요일 오후 7:30']);
    // 저녁도 아침도 아닌 두 시간이면 가운데
    expect(pingSlots(clock(420), dohyun, 420, 540).map(at)).toEqual(['토요일 오전 12:00']);
  });

  it('보내도 되는 때와 안 되는 때', () => {
    const base = {
      opens: true,
      clock: clock(0),
      cast: { sleepFrom: 0, sleepTo: 6 * 60 } as any,
      slot: 210,
      lastContact: 3,
      hasHook: true,
      alreadySent: false,
    };
    expect(pingHeld(base)).toBeNull();
    expect(pingHeld({ ...base, lastContact: null })).toBeNull();
    expect(pingHeld({ ...base, opens: false })).toBe('film_closed');
    expect(pingHeld({ ...base, slot: RULES.trialMinutes })).toBe('trial_over');
    expect(pingHeld({ ...base, slot: 480 })).toBe('asleep'); // 토요일 0시
    expect(pingHeld({ ...base, lastContact: 100 })).toBe('too_soon');
    expect(pingHeld({ ...base, hasHook: false })).toBe('nothing_to_say');
    expect(pingHeld({ ...base, alreadySent: true })).toBe('once');
  });

  it('저녁에 먼저 연락이 온다. 돌아와서 보면 그때 시각으로 와 있다', async () => {
    const { send, away, calls } = await setup({ gap: forMina(MINA_DAY), ping: '선배, 아까 말한 책 서점에 있던데요.' });
    await send('먼저 갈게.');
    const v = await away('sleep');
    const ping = v.messages.filter((m) => m.kind === 'ping');
    // 한 번 자리를 비운 동안 한 사람은 한 번만 먼저 건다. 이도현은 그 사이에 한 일이 없어서 건넬 말이 없다
    expect(ping.map((m) => [m.room, m.speaker, m.text, at(m.at)])).toEqual([
      ['c1', 'c1', '선배, 아까 말한 책 서점에 있던데요.', '금요일 오후 7:30'],
    ]);
    // 얘깃거리는 그 시각 전에 있었던 것만 쓴다
    expect(calls('ping')).toHaveLength(1);
    expect(calls('ping')[0]!.user).toContain('서점에서 선배가 말한 책을 봤다.');
  });

  it('방금까지 얘기했으면 먼저 걸지 않는다', async () => {
    const { send, away, calls, setElapsed } = await setup({ gap: forMina('19:00 | 말거리 | 저녁 뭐 먹을지 고민했다.') });
    await setElapsed(120); // 금요일 오후 6시
    await send('이따 봐.'); // 6:03
    const v = await away('errand'); // 8:03까지
    expect(v.messages.filter((m) => m.kind === 'ping')).toHaveLength(0);
    expect(calls('ping')).toHaveLength(0);
  });

  it('그 사이에 한 일이 없으면 연락도 없다 — 연락 없는 날도 그 사람의 하루다', async () => {
    const { send, away, calls } = await setup({ gap: '' });
    await send('먼저 갈게.');
    const v = await away('sleep');
    expect(v.messages.filter((m) => m.kind === 'ping')).toHaveLength(0);
    expect(calls('ping')).toHaveLength(0);
  });

  it('필름이 먼저 오는 연락을 열지 않으면 보내지 않는다. 피드는 따로다', async () => {
    const { send, away, calls } = await setup({ gap: forMina(MINA_DAY) }, { ...TWO_FILM, opens: { feed: true, ping: false } });
    await send('먼저 갈게.');
    const v = await away('sleep');
    expect(v.messages.filter((m) => m.kind === 'ping')).toHaveLength(0);
    expect(v.posts).toHaveLength(1);
    expect(calls('ping')).toHaveLength(0);
  });
});
