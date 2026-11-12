/* 오프닝 — 디렉터가 컷·지문·대사를 쌓은 것. 화면과 서버가 같은 눈으로 읽는다. 계산뿐이다. */

import type { Beat, Film, FirstScene } from './types';

/** 예전 필름의 첫 장면: 장면 글 한 덩이였다 */
type OldScene = Omit<FirstScene, 'beats'> & { beats?: Beat[]; situation?: string };

/** 저장된 필름을 지금 모양으로 읽는다.
    예전 필름은 첫 컷과 장면 글을 오프닝의 칸으로 옮긴다. 첫 마디(firstLine)는 그대로 둔다 —
    그 필름으로 살던 삶에는 그 말이 이미 대사로 들어가 있다 */
export function readFilm(saved: Film): Film {
  // 한편이 생기기 전의 필름에는 그 스위치가 없다. 꺼진 것으로 읽는다
  // 배역의 사진이 생기기 전의 필름에는 그 칸도 없다. 비어 있는 것으로 읽는다
  const stored: Film = {
    ...saved,
    opens: { ...saved.opens, aside: saved.opens?.aside === true },
    persona: { ...saved.persona, face: saved.persona?.face ?? '' },
    // 성격부터 비밀까지의 칸이 생기기 전의 캐스트. 비어 있는 것으로 읽는다
    casts: saved.casts.map((c) => ({
      ...c,
      nature: c.nature ?? '',
      intro: c.intro ?? '',
      habit: c.habit ?? '',
      trauma: c.trauma ?? '',
      lack: c.lack ?? '',
      secret: c.secret ?? '',
    })),
  };
  const fs = stored.firstScene as OldScene;
  if (Array.isArray(fs.beats)) return stored;
  const beats: Beat[] = [];
  const first = (stored.stills ?? [])[0];
  if (first) beats.push({ kind: 'cut', image: first });
  if (fs.situation) beats.push({ kind: 'tell', text: fs.situation });
  const { situation: _old, ...rest } = fs;
  return { ...stored, firstScene: { ...rest, beats, firstLine: fs.firstLine ?? '' } };
}

/** 오프닝에 건 컷들. 차례대로 */
export const cutsOf = (film: Film): string[] =>
  film.firstScene.beats.flatMap((b) => (b.kind === 'cut' ? [b.image] : []));

/** 오프닝에 쓴 글의 길이(지문과 대사) */
export const openingLength = (beats: { kind: string; text?: string }[]): number =>
  beats.reduce((n, b) => n + (b.kind === 'cut' ? 0 : (b.text ?? '').trim().length), 0);

/** 오프닝에 글이 있는가. 컷만 있으면 없는 것이다 */
export const hasLines = (film: Film): boolean => film.firstScene.beats.some((b) => b.kind !== 'cut');

/** 이 캐스트가 오프닝의 자리에 있었나 — 그 방의 캐스트이거나, 오프닝에서 말을 했거나 */
export const wasThere = (film: Film, castKey: string): boolean =>
  castKey === film.firstScene.room || film.firstScene.beats.some((b) => b.kind === 'say' && b.cast === castKey);
