/* 피드에 남기는 것 — 본 영화·드라마, 들은 노래, 일기, 사진, 검색어, 본 영상.
   대사 모델이 쓴 한 줄을 읽어 종류마다의 모양으로 바꾼다(parseFeed). 한 줄 요약도 여기서 만든다(feedLine).
   화면과 서버가 같이 쓴다. 계산뿐이다. */

import { pick } from './ko';
import { RULES } from './rules';
import type { FeedKind, FeedPhoto, PostData } from './types';

export const FEED_KINDS: readonly FeedKind[] = ['watch', 'song', 'diary', 'photo', 'search', 'tube'];

/** 화면에 쓰는 이름 */
export const FEED_LABEL: Record<FeedKind, string> = {
  watch: '본 영화·드라마',
  song: '들은 노래',
  diary: '일기',
  photo: '사진',
  search: '검색어',
  tube: '본 영상',
};

/** 피드 글 머리에 붙이는 이름 */
export const postLabel = (d: PostData): string =>
  d.kind === 'watch' ? (d.form === 'drama' ? '본 드라마' : '본 영화') : d.kind === 'text' ? '' : FEED_LABEL[d.kind];

const F = RULES.feed;

/** 앞뒤를 감싼 따옴표와 낫표는 뗀다. 제목을 「」에 넣어 쓰는 일이 잦다 */
function bare(s: string): string {
  const t = s.trim();
  const pairs = ['「」', '『』', '""', "''", '“”', '‘’', '<>', '《》', '〈〉'];
  for (const [a, b] of pairs) if (t.length >= 2 && t.startsWith(a!) && t.endsWith(b!)) return t.slice(1, -1).trim();
  return t;
}

const fits = (s: string, max: number) => s.length > 0 && s.length <= max;

/** 「제목 (12:04)」 → 제목과 길이 */
function clip(item: string): { title: string; length: string } {
  const m = /^(.*?)\s*[(（]\s*(\d{1,2}:\d{2}(?::\d{2})?)\s*[)）]$/.exec(item.trim());
  return m ? { title: bare(m[1]!), length: m[2]! } : { title: bare(item), length: '' };
}

/** 이 캐스트가 지금 남길 수 있는 것. 사진은 아직 안 올린 사진이 있어야 한다 */
export function kindsNow(feed: FeedKind[], photosLeft: number): FeedKind[] {
  return FEED_KINDS.filter((k) => feed.includes(k) && (k !== 'photo' || photosLeft > 0));
}

/** 대사 모델이 쓴 한 줄을 읽는다. 「없음」이면 none, 모양이 틀리거나 켜 두지 않은 종류면 null.
    photos는 이번에 고를 수 있게 건넨 사진들(번호는 1부터) */
export function parseFeed(line: string, kinds: FeedKind[], photos: FeedPhoto[] = []): PostData | 'none' | null {
  const parts = line.split(/[|｜]/).map((x) => x.trim());
  const head = (parts[0] ?? '').replace(/\s+/g, '');
  const rest = parts.slice(1);
  const on = (k: FeedKind) => kinds.includes(k);
  if (head === '없음' && rest.every((x) => x === '')) return 'none';

  if ((head === '영화' || head === '드라마') && on('watch')) {
    const drama = head === '드라마';
    const [title = '', ...more] = rest;
    const ep = drama ? (more[0] ?? '') : '';
    const note = (drama ? more.slice(1) : more).join(' | ').trim();
    const t = bare(title);
    if (!fits(t, F.title) || ep.length > F.ep || note.length > F.note) return null;
    return { kind: 'watch', form: drama ? 'drama' : 'movie', title: t, ep, note };
  }
  if (head === '노래' && on('song')) {
    const [title = '', artist = '', ...more] = rest;
    const note = more.join(' | ').trim();
    const t = bare(title);
    if (!fits(t, F.title) || artist.length > F.artist || note.length > F.note) return null;
    return { kind: 'song', title: t, artist, note };
  }
  if (head === '일기' && on('diary')) {
    const text = rest.join(' | ').trim();
    return fits(text, F.diary) ? { kind: 'diary', text } : null;
  }
  if (head === '사진' && on('photo')) {
    const [no = '', ...more] = rest;
    const n = Number(no.replace(/번$/, ''));
    const photo = Number.isInteger(n) ? photos[n - 1] : undefined;
    const note = more.join(' | ').trim();
    if (!photo || note.length > F.note) return null;
    return { kind: 'photo', photo: photo.id, note };
  }
  if ((head === '검색' || head === '검색어') && on('search')) {
    const queries = rest.join(' / ').split('/').map((x) => bare(x)).filter((x) => x.length > 0);
    if (queries.length === 0 || queries.length > F.items || queries.some((x) => x.length > F.query)) return null;
    return { kind: 'search', queries };
  }
  if (head === '영상' && on('tube')) {
    const items = rest.join(' / ').split(' / ').map(clip).filter((x) => x.title.length > 0);
    if (items.length === 0 || items.length > F.items || items.some((x) => x.title.length > F.title)) return null;
    return { kind: 'tube', items };
  }
  return null;
}

const quote = (title: string, a: string, b: string) => `「${title}」${pick(title, a, b)}`;
const tail = (note: string) => (note ? ` ${note}` : '');

/** 한 줄 요약. 피드 글의 text에 두고, 장면을 쓰는 작가에게 「아는 일」로 건넬 때 쓴다.
    who는 그 사람 이름, about은 사진일 때 무슨 사진인지 */
export function feedLine(d: PostData, who: string, about = ''): string {
  switch (d.kind) {
    case 'watch':
      return d.form === 'drama'
        ? `${who}${pick(who, '은', '는')} 드라마 「${d.title}」${d.ep ? ` ${d.ep}` : ''}${pick(d.ep || d.title, '을', '를')} 봤다.${tail(d.note)}`
        : `${who}${pick(who, '은', '는')} 영화 ${quote(d.title, '을', '를')} 봤다.${tail(d.note)}`;
    case 'song':
      return `${who}${pick(who, '은', '는')} ${d.artist ? `${d.artist}의 ` : ''}노래 ${quote(d.title, '을', '를')} 들었다.${tail(d.note)}`;
    case 'diary':
      return `${who}의 일기: ${d.text}`;
    case 'photo':
      return `${who}${pick(who, '이', '가')} 피드에 사진을 올렸다${about ? `(${about})` : ''}.${tail(d.note)}`;
    case 'search':
      return `${who}${pick(who, '이', '가')} 검색한 말: ${d.queries.join(' / ')}`;
    case 'tube':
      return `${who}${pick(who, '이', '가')} 본 영상: ${d.items.map((x) => x.title).join(' / ')}`;
    default:
      return '';
  }
}
