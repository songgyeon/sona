import { describe, expect, it } from 'vitest';
import { RULES } from '../../shared/rules';
import { type Ctx, Fail } from '../../worker/engine/ctx';
import { createFilm } from '../../worker/engine/films';
import { listDrafts, putDrafts } from '../../worker/engine/drafts';
import { claimLink, makeLink } from '../../worker/engine/link';
import { setMe } from '../../worker/engine/me';
import { addPersona, listPersonas } from '../../worker/engine/mypersonas';
import { enter } from '../../worker/engine/turn';
import { DEV_FILM, OTHER_VISITOR, testCtx, uid, VISITOR } from '../helpers/film';

/* 다른 기기에서 이어 하기: 쓰던 기기(pc)에서 코드를 받고, 새 기기(phone)에서 넣는다. 둘은 같은 저장소를 쓴다 */

async function fail(p: () => unknown): Promise<Fail | null> {
  try {
    await p();
  } catch (e) {
    if (e instanceof Fail) return e;
    throw e;
  }
  return null;
}

const count = async (ctx: Ctx, sql: string, ...args: unknown[]) => (await ctx.db.first<{ n: number }>(sql, ...args))!.n;

function devices() {
  const pc = testCtx();
  const phone: Ctx = { ...pc, visitor: OTHER_VISITOR };
  return { pc, phone };
}

describe('다른 기기에서 이어 하기', () => {
  it('코드를 넣으면 쓰던 기기와 같은 사람이 되고, 넣은 기기에서 쓰던 필름·삶·페르소나·고른 사람은 합쳐진다', async () => {
    const { pc, phone } = devices();
    await setMe(pc, { name: '서하' });
    await addPersona(pc, { name: '윤재', line: '', face: '' });
    const mine = await createFilm(pc, DEV_FILM);

    await setMe(phone, { name: '폰' });
    await addPersona(phone, { name: '윤재', line: '', face: '' });
    await addPersona(phone, { name: '리안', line: '', face: '' });
    await createFilm(phone, DEV_FILM);
    const life = await enter(phone, mine.id, uid());

    // 필름마다 고른 사람: 한쪽에만 있는 필름(x)과 둘 다 있는 필름(y)
    const pcs = await listPersonas(pc);
    const phones = await listPersonas(phone);
    const id = (list: { id: string; name: string }[], name: string) => list.find((p) => p.name === name)!.id;
    const pick = (visitor: string, film: string, personaId: string) =>
      pc.db.run('INSERT INTO personas (visitor, film_id, name, line, face, updated_at, persona_id, role) VALUES (?, ?, ?, ?, ?, ?, ?, 0)', visitor, film, 'x', '', '', 1, personaId);
    await pick(OTHER_VISITOR, 'film-x', id(phones, '윤재'));
    await pick(VISITOR, 'film-y', id(pcs, '서하'));
    await pick(OTHER_VISITOR, 'film-y', id(phones, '리안'));

    const { code } = await makeLink(pc, { drafts: '[]' });
    expect(code).toHaveLength(RULES.link.length);
    // 사람이 치는 모양 그대로: 소문자, 가운데 빈칸
    const got = await claimLink(phone, { code: `${code.slice(0, 4).toLowerCase()} ${code.slice(4)}` });
    expect(got).toEqual({ visitor: VISITOR, name: '서하', drafts: '[]' });

    expect(await count(pc, 'SELECT COUNT(*) AS n FROM films WHERE owner = ?', VISITOR)).toBe(2);
    expect((await pc.db.first<{ owner: string }>('SELECT owner FROM plays WHERE id = ?', life.id))!.owner).toBe(VISITOR);

    // 이름·소개·사진이 똑같은 페르소나는 하나로 친다. 나머지는 옮겨 온다
    const names = (await listPersonas(pc)).map((p) => p.name);
    expect(names.filter((n) => n === '윤재')).toHaveLength(1);
    expect(names).toEqual(expect.arrayContaining(['서하', '윤재', '폰', '리안']));
    // 하나로 친 페르소나를 고른 자리는 남긴 쪽을 가리킨다. 둘 다 고른 필름은 쓰던 기기의 것을 둔다
    const chosen = (film: string) => pc.db.first<{ persona_id: string }>('SELECT persona_id FROM personas WHERE visitor = ? AND film_id = ?', VISITOR, film);
    expect((await chosen('film-x'))!.persona_id).toBe(id(pcs, '윤재'));
    expect((await chosen('film-y'))!.persona_id).toBe(id(pcs, '서하'));

    // 넣은 기기의 흔적은 남지 않는다
    for (const [table, col] of [
      ['films', 'owner'],
      ['plays', 'owner'],
      ['mypersonas', 'visitor'],
      ['personas', 'visitor'],
      ['visitors', 'id'],
    ]) {
      expect(await count(pc, `SELECT COUNT(*) AS n FROM ${table} WHERE ${col} = ?`, OTHER_VISITOR)).toBe(0);
    }
  });

  it('쓰던 기기에 이름이 없으면 넣은 기기의 이름을 가져간다', async () => {
    const { pc, phone } = devices();
    await setMe(phone, { name: '폰' });
    const { code } = await makeLink(pc, {});
    expect((await claimLink(phone, { code })).name).toBe('폰');
  });

  it(`코드는 ${RULES.link.minutes}분 안에 한 번만 쓴다. 모양이 틀린 코드는 거절한다`, async () => {
    const { pc, phone } = devices();
    const at = (ms: number): Ctx => ({ ...phone, now: () => ms });

    const once = await makeLink(pc, {});
    await claimLink(phone, { code: once.code });
    expect((await fail(() => claimLink(phone, { code: once.code })))?.code).toBe('bad_code');

    const late = await makeLink(pc, {});
    expect((await fail(() => claimLink(at(late.expiresAt + 1), { code: late.code })))?.code).toBe('bad_code');
    await claimLink(at(late.expiresAt - 1), { code: late.code });

    expect((await fail(() => claimLink(phone, { code: 'ABC' })))?.code).toBe('bad_code');
    expect((await fail(() => claimLink(phone, { code: 'ZZZZZZZZ' })))?.code).toBe('bad_code');
    expect((await fail(() => claimLink(phone, {})))?.code).toBe('bad_code');
  });

  it('자기 코드를 자기가 넣어도 아무것도 지우지 않는다', async () => {
    const { pc } = devices();
    await setMe(pc, { name: '서하' });
    const film = await createFilm(pc, DEV_FILM);
    const { code } = await makeLink(pc, {});
    expect((await claimLink(pc, { code })).visitor).toBe(VISITOR);
    expect(await count(pc, 'SELECT COUNT(*) AS n FROM films WHERE id = ? AND owner = ?', film.id, VISITOR)).toBe(1);
    expect((await listPersonas(pc)).map((p) => p.name)).toEqual(['서하']);
  });

  it('임시저장은 코드와 함께 건너간다. 너무 크면 코드를 주지 않는다', async () => {
    const { pc, phone } = devices();
    const packed = JSON.stringify([{ id: 'a', raw: JSON.stringify({ draft: { title: '한강' }, savedAt: 1 }) }]);
    const { code } = await makeLink(pc, { drafts: packed });
    expect((await claimLink(phone, { code })).drafts).toBe(packed);
    expect((await fail(() => makeLink(pc, { drafts: 'x'.repeat(RULES.link.drafts + 1) })))?.code).toBe('drafts_big');
  });

  it('임시저장은 서버에도 사람마다 한 벌: 나중에 남긴 쪽이 이기고, 지운 표시는 남는다. 코드를 넣으면 넣은 기기의 것도 합친다', async () => {
    const { pc, phone } = devices();
    const raw = (title: string, at: number) => JSON.stringify({ draft: { title }, savedAt: at });
    const one = (id: string, title: string, at: number) => ({ id, raw: raw(title, at), savedAt: at, dropped: false });
    await putDrafts(pc, { items: [one('a', '한강', 10)] });
    await putDrafts(pc, { items: [one('a', '예전 한강', 5)] });
    expect((await listDrafts(pc)).map((d) => (JSON.parse(d.raw) as { draft: { title: string } }).draft.title)).toEqual(['한강']);
    await putDrafts(pc, { items: [one('b', '지울 것', 1)] });
    await putDrafts(pc, { items: [{ id: 'b', raw: '', savedAt: 2, dropped: true }] });
    await putDrafts(phone, { items: [one('c', '폰에서 쓴 것', 20)] });
    // 남의 임시저장은 보이지 않는다
    expect((await listDrafts(phone)).map((d) => d.id)).toEqual(['c']);

    const { code } = await makeLink(pc, {});
    await claimLink(phone, { code });
    const all = await listDrafts(pc);
    expect(all.filter((d) => !d.dropped).map((d) => d.id).sort()).toEqual(['a', 'c']);
    expect(all.find((d) => d.id === 'b')!.dropped).toBe(true);
    expect(await listDrafts(phone)).toEqual([]);
  });

  it('임시저장의 모양이 틀리거나 너무 크면 받지 않는다', async () => {
    const { pc } = devices();
    expect((await fail(() => putDrafts(pc, { items: [{ id: '../a', raw: '{"draft":{}}', savedAt: 1, dropped: false }] })))?.code).toBe('bad_drafts');
    expect((await fail(() => putDrafts(pc, { items: [{ id: 'a', raw: '글자', savedAt: 1, dropped: false }] })))?.code).toBe('bad_drafts');
    expect((await fail(() => putDrafts(pc, { items: [{ id: 'a', raw: JSON.stringify({ draft: { t: 'x'.repeat(RULES.drafts.size) } }), savedAt: 1, dropped: false }] })))?.code).toBe('draft_big');
    expect((await fail(() => putDrafts(pc, { items: Array.from({ length: RULES.drafts.batch + 1 }, (_, i) => ({ id: `d${i}`, raw: '', savedAt: 1, dropped: true })) })))?.code).toBe('bad_drafts');
  });
});

