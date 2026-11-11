import { describe, expect, it } from 'vitest';
import { blankCast, blankDraft, draftTitle, isBlank, shelf, type Draft, type Store } from '../../shared/draft';

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
