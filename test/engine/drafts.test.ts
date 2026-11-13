import { describe, expect, it } from 'vitest';
import { blankCast, blankDraft, draftTitle, editSlot, isBlank, readDraft, shelf, toFilm, type Draft, type Store } from '../../shared/draft';

/* 임시저장 — 만들던 필름을 이 기기에 남겨 두는 선반.
   브라우저의 저장소 자리에 같은 모양의 것을 세우고 돌린다. */

/** 브라우저의 저장소와 같은 모양. full이 켜지면 더 못 적는다 */
function memory(start: Record<string, string> = {}) {
  const map = new Map(Object.entries(start));
  const store: Store & { full: boolean; dump(): Record<string, string> } = {
    full: false,
    get length() {
      return map.size;
    },
    key: (i) => [...map.keys()][i] ?? null,
    getItem: (k) => map.get(k) ?? null,
    setItem(k, v) {
      if (store.full) throw new Error('quota');
      map.set(k, v);
    },
    removeItem: (k) => void map.delete(k),
    dump: () => Object.fromEntries(map),
  };
  return store;
}

function setup(start: Record<string, string> = {}) {
  const store = memory(start);
  let n = 0;
  let t = 1000;
  const drafts = shelf(
    () => store,
    () => `id-${++n}`,
    () => (t += 1000),
  );
  return { store, drafts };
}

const titled = (title: string): Draft => ({ ...blankDraft(), title });

describe('임시저장: 남길 것이 있나', () => {
  it('아무것도 적지 않은 필름은 빈 필름이다. 처음부터 값이 있는 칸은 치지 않는다', () => {
    expect(isBlank(blankDraft())).toBe(true);
    expect(isBlank({ ...blankDraft(), startTime: '09:00', startDow: 1, feed: false, speaker: 'persona' })).toBe(true);
    expect(isBlank({ ...blankDraft(), casts: [{ ...blankCast(), sleepFrom: '02:00' }] })).toBe(true);
    expect(isBlank({ ...blankDraft(), title: '   ' })).toBe(true);
  });

  it('한 칸이라도 적었으면 빈 필름이 아니다', () => {
    expect(isBlank(titled('서점'))).toBe(false);
    expect(isBlank({ ...blankDraft(), poster: 'ffffffff-ffff-4fff-8fff-ffffffffffff' })).toBe(false);
    expect(isBlank({ ...blankDraft(), casts: [{ ...blankCast(), secret: '말하지 않은 것' }] })).toBe(false);
    expect(isBlank({ ...blankDraft(), casts: [blankCast(), blankCast()] })).toBe(false);
    expect(isBlank({ ...blankDraft(), ties: { '0>1': { relation: '선배', calls: '' } } })).toBe(false);
    expect(isBlank({ ...blankDraft(), beats: [{ id: 'b0', kind: 'tell', image: '', text: '', cast: 0 }] })).toBe(false);
  });

  it('제목이 없으면 목록에는 「제목 없는 필름」으로 적는다', () => {
    expect(draftTitle(titled(' 서점 '))).toBe('서점');
    expect(draftTitle(blankDraft())).toBe('제목 없는 필름');
  });
});

describe('임시저장: 선반', () => {
  it('남긴 필름은 목록에 선다. 최근에 남긴 것이 위다', () => {
    const { drafts } = setup();
    expect(drafts.save('a', titled('첫째'))).toBe('saved');
    expect(drafts.save('b', titled('둘째'))).toBe('saved');
    expect(drafts.list().map((s) => [s.id, s.draft.title])).toEqual([
      ['b', '둘째'],
      ['a', '첫째'],
    ]);
    // 다시 남기면 그 필름이 위로 온다. 편수는 그대로다
    expect(drafts.save('a', titled('첫째, 고침'))).toBe('saved');
    expect(drafts.list().map((s) => [s.id, s.draft.title])).toEqual([
      ['a', '첫째, 고침'],
      ['b', '둘째'],
    ]);
  });

  it('남긴 그대로 다시 읽힌다', () => {
    const { drafts } = setup();
    const d: Draft = {
      ...titled('서점'),
      casts: [{ ...blankCast(), name: '한서', secret: '그만둘지 고민한다' }],
      beats: [{ id: 'n1', kind: 'say', image: '', text: '왔어요?', cast: 0 }],
      speaker: 'persona',
    };
    drafts.save('a', d);
    expect(drafts.load('a')!.draft).toEqual(d);
    expect(drafts.load('a')!.savedAt).toBeGreaterThan(0);
    expect(drafts.load('없는 것')).toBeNull();
  });

  it('아무것도 적지 않은 필름은 남기지 않는다. 다 지우면 남아 있던 자리도 비운다', () => {
    const { drafts } = setup();
    expect(drafts.save('a', blankDraft())).toBe('blank');
    expect(drafts.list()).toEqual([]);
    drafts.save('a', titled('서점'));
    expect(drafts.save('a', titled(''))).toBe('blank');
    expect(drafts.list()).toEqual([]);
  });

  it('지우면 그 필름만 없어진다', () => {
    const { drafts } = setup();
    drafts.save('a', titled('첫째'));
    drafts.save('b', titled('둘째'));
    drafts.drop('a');
    expect(drafts.list().map((s) => s.id)).toEqual(['b']);
    expect(drafts.load('a')).toBeNull();
  });

  it('다른 것들이 쓰는 자리는 건드리지 않는다', () => {
    const { drafts, store } = setup({ 'sona.visitor': 'v', 'sona.key': 'k', 'other.draft.x': '{}' });
    drafts.save('a', titled('첫째'));
    expect(drafts.list().map((s) => s.id)).toEqual(['a']);
    drafts.drop('a');
    expect(store.dump()).toEqual({ 'sona.visitor': 'v', 'sona.key': 'k', 'other.draft.x': '{}' });
  });

  it('깨진 자리는 건너뛴다', () => {
    const { drafts } = setup({ 'sona.draft.x': '{{{', 'sona.draft.y': 'null', 'sona.draft.z': '{"savedAt":5}' });
    drafts.save('a', titled('첫째'));
    expect(drafts.list().map((s) => s.id)).toEqual(['a']);
    expect(drafts.load('x')).toBeNull();
  });

  it('저장소가 꽉 찼거나 막혀 있으면 그렇다고 알린다. 터지지 않는다', () => {
    const { drafts, store } = setup();
    store.full = true;
    expect(drafts.save('a', titled('첫째'))).toBe('blocked');
    expect(drafts.list()).toEqual([]);

    const none = shelf(
      () => {
        throw new Error('blocked');
      },
      () => 'id',
      () => 1,
    );
    expect(none.save('a', titled('첫째'))).toBe('blocked');
    expect(none.list()).toEqual([]);
    expect(none.load('a')).toBeNull();
    expect(() => none.drop('a')).not.toThrow();
  });
});

describe('임시저장: 개봉한 필름을 고치다 남긴 것', () => {
  it('필름 한 편에 한 자리다. 어느 필름을 고치던 것인지 함께 남는다', () => {
    const { drafts } = setup();
    drafts.save(editSlot('f1'), titled('고치는 중'), 'f1');
    drafts.save(editSlot('f1'), titled('고치는 중, 더 고침'), 'f1');
    drafts.save('a', titled('새 필름'));
    expect(drafts.list().map((s) => [s.id, s.draft.title, s.filmId])).toEqual([
      ['a', '새 필름', undefined],
      ['edit-f1', '고치는 중, 더 고침', 'f1'],
    ]);
    expect(drafts.load(editSlot('f1'))?.filmId).toBe('f1');
    // 저장하면 그 자리를 비운다
    drafts.drop(editSlot('f1'));
    expect(drafts.load(editSlot('f1'))).toBeNull();
  });
});

describe('임시저장: 공개 범위', () => {
  it('비공개로 고른 것도 남고, 필름으로 보낼 때 함께 간다', () => {
    const { drafts } = setup();
    drafts.save('a', { ...titled('서점'), private: true });
    expect(drafts.load('a')!.draft.private).toBe(true);
    expect(toFilm({ ...titled('서점'), private: true })).toMatchObject({ title: '서점', private: true });
  });

  it('공개 범위가 없던 때에 남긴 것은 공개로 읽힌다. 비공개만 고른 필름은 빈 필름이다', () => {
    expect(readDraft({ title: '예전 것' }).private).toBe(false);
    expect(isBlank({ ...blankDraft(), private: true })).toBe(true);
  });
});

describe('임시저장: 한 편만 남기던 때의 것', () => {
  it('지금 자리로 옮겨져 목록에 선다. 예전 자리는 비운다', () => {
    const old = { ...titled('쓰다 만 필름'), personaName: '수아' };
    const { drafts, store } = setup({ 'sona.draft': JSON.stringify(old) });
    const list = drafts.list();
    expect(list.map((s) => [s.id, s.draft.title, s.draft.personaName])).toEqual([['id-1', '쓰다 만 필름', '수아']]);
    expect(store.getItem('sona.draft')).toBeNull();
    // 두 번 옮기지 않는다
    expect(drafts.list()).toHaveLength(1);
  });

  it('예전 모양(장면 글 한 덩이와 첫 마디)으로 남긴 것도 지금의 칸으로 읽힌다', () => {
    const { drafts } = setup({ 'sona.draft': JSON.stringify({ title: '예전 것', situation: '점심 뒤.', speaker: 'cast', firstLine: '왔어요?' }) });
    const [one] = drafts.list();
    expect(one!.draft.beats.map((b) => [b.kind, b.text])).toEqual([
      ['tell', '점심 뒤.'],
      ['say', '왔어요?'],
    ]);
    expect(one!.draft.casts[0]).toMatchObject({ nature: '', secret: '' });
  });

  it('아무것도 적지 않았던 것은 옮기지 않고 비운다', () => {
    const { drafts, store } = setup({ 'sona.draft': JSON.stringify(blankDraft()) });
    expect(drafts.list()).toEqual([]);
    expect(store.getItem('sona.draft')).toBeNull();
  });

  it('옮기지 못하면 예전 것을 지우지 않는다', () => {
    const { drafts, store } = setup({ 'sona.draft': JSON.stringify(titled('쓰다 만 필름')) });
    store.full = true;
    expect(drafts.list()).toEqual([]);
    expect(store.getItem('sona.draft')).not.toBeNull();
    // 자리가 나면 그때 옮겨진다
    store.full = false;
    expect(drafts.list().map((s) => s.draft.title)).toEqual(['쓰다 만 필름']);
  });

  it('못 읽는 글자가 들어 있으면 그대로 둔다. 다른 필름은 잘 남는다', () => {
    const { drafts, store } = setup({ 'sona.draft': 'not json' });
    expect(drafts.save('a', titled('첫째'))).toBe('saved');
    expect(drafts.list().map((s) => s.id)).toEqual(['a']);
    expect(store.getItem('sona.draft')).toBe('not json');
  });
});

describe('임시저장: 다른 기기로 옮기기', () => {
  it('싸서 풀면 같은 필름이 선다. 같은 자리가 있으면 나중에 남긴 쪽을 둔다', () => {
    const a = setup();
    a.drafts.save('x', titled('한강'));
    a.drafts.save('y', titled('수몰'));
    const packed = a.drafts.pack();

    const b = setup({ 'sona.draft.y': JSON.stringify({ draft: titled('폰에서 고친 수몰'), savedAt: 9_999_999 }) });
    expect(b.drafts.unpack(packed)).toBe(1);
    expect(b.drafts.list().map((d) => d.draft.title).sort()).toEqual(['폰에서 고친 수몰', '한강']);

    const c = setup({ 'sona.draft.y': JSON.stringify({ draft: titled('예전 수몰'), savedAt: 1 }) });
    expect(c.drafts.unpack(packed)).toBe(2);
    expect(c.drafts.list().map((d) => d.draft.title).sort()).toEqual(['수몰', '한강']);
  });

  it('읽을 수 없는 짐과 이상한 자리 이름은 버린다', () => {
    const b = setup();
    expect(b.drafts.unpack('글자')).toBe(0);
    expect(b.drafts.unpack(JSON.stringify({ id: 'x' }))).toBe(0);
    expect(b.drafts.unpack(JSON.stringify([{ id: '../x', raw: JSON.stringify({ draft: titled('a'), savedAt: 1 }) }, { id: 'y', raw: '{' }]))).toBe(0);
    expect(b.drafts.list()).toEqual([]);
  });
});

describe('임시저장: 서버와 맞추기', () => {
  const saved = (title: string, savedAt: number) => JSON.stringify({ draft: titled(title), savedAt });

  it('서버 쪽이 나중이면 받는다. 이 기기 쪽이 나중이거나 서버에 없으면 보낼 자리로 돌려준다. 지운 표시는 그보다 먼저 남긴 것을 지운다', () => {
    const a = setup({
      'sona.draft.x': saved('이 기기 x', 50),
      'sona.draft.y': saved('이 기기 y', 900),
      'sona.draft.z': saved('지울 z', 10),
      'sona.draft.k': saved('나중에 고친 k', 99),
      'sona.draft.w': saved('서버에 없는 w', 5),
    });
    const push = a.drafts.merge([
      { id: 'x', raw: saved('서버 x', 100), savedAt: 100, dropped: false },
      { id: 'y', raw: saved('서버 y', 100), savedAt: 100, dropped: false },
      { id: 'z', raw: '', savedAt: 20, dropped: true },
      { id: 'k', raw: '', savedAt: 30, dropped: true },
      { id: 'v', raw: saved('서버에만 v', 30), savedAt: 30, dropped: false },
    ]);
    expect(a.drafts.list().map((d) => d.draft.title).sort()).toEqual(['나중에 고친 k', '서버 x', '서버에 없는 w', '서버에만 v', '이 기기 y'].sort());
    expect(push.sort()).toEqual(['k', 'w', 'y']);
    // 한 번 맞춘 뒤에는 보낼 것이 없다
    const again = a.drafts.merge([
      ...['x', 'v'].map((id) => ({ id, raw: a.drafts.entry(id)!.raw, savedAt: a.drafts.entry(id)!.savedAt, dropped: false })),
      ...push.map((id) => ({ id, raw: a.drafts.entry(id)!.raw, savedAt: a.drafts.entry(id)!.savedAt, dropped: false })),
    ]);
    expect(again).toEqual([]);
  });

  it('읽을 수 없는 것은 받지 않는다', () => {
    const a = setup();
    expect(a.drafts.merge([{ id: '../x', raw: saved('a', 1), savedAt: 1, dropped: false }, { id: 'y', raw: '{', savedAt: 1, dropped: false }])).toEqual([]);
    expect(a.drafts.list()).toEqual([]);
  });
});
