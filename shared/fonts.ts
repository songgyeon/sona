/* 오프닝 영상의 글자에 쓰는 글꼴 — 앱에 들어 있어서 어느 기기에서나 똑같이 보인다(2026-11-12 사용자 지시: 「기본으로 지원 가능한 폰트」).
   프리텐다드와 본명조는 앱의 글꼴이고, 나머지는 @fontsource의 한글 글꼴이다(모두 OFL). 화면이 쓸 때 받는다(src/fonts.ts). */

export interface FontDef {
  /** 저장하는 이름표 */
  key: string;
  /** 고르는 칸에 보이는 이름 */
  label: string;
  family: string;
  /** 이 글꼴로 쓰는 굵기(글꼴마다 하나만 싣는다) */
  weight: number;
}

export const FONTS: readonly FontDef[] = [
  { key: 'pretendard', label: '프리텐다드', family: "'Pretendard Variable', Pretendard, sans-serif", weight: 600 },
  { key: 'noto-serif', label: '본명조', family: "'Noto Serif KR Variable', 'Noto Serif KR', serif", weight: 700 },
  { key: 'nanum-myeongjo', label: '나눔명조', family: "'Nanum Myeongjo', serif", weight: 700 },
  { key: 'gowun-batang', label: '고운바탕', family: "'Gowun Batang', serif", weight: 400 },
  { key: 'song-myung', label: '송명', family: "'Song Myung', serif", weight: 400 },
  { key: 'black-han-sans', label: '검은고딕', family: "'Black Han Sans', sans-serif", weight: 400 },
  { key: 'do-hyeon', label: '도현', family: "'Do Hyeon', sans-serif", weight: 400 },
  { key: 'jua', label: '주아', family: "'Jua', sans-serif", weight: 400 },
  { key: 'gowun-dodum', label: '고운돋움', family: "'Gowun Dodum', sans-serif", weight: 400 },
  { key: 'nanum-pen-script', label: '나눔손글씨 펜', family: "'Nanum Pen Script', cursive", weight: 400 },
  { key: 'nanum-brush-script', label: '나눔손글씨 붓', family: "'Nanum Brush Script', cursive", weight: 400 },
  { key: 'east-sea-dokdo', label: '동해독도', family: "'East Sea Dokdo', cursive", weight: 400 },
];

/** 이 이름표의 글꼴. 모르는 이름표면 첫 글꼴 */
export const fontOf = (key: string): FontDef => FONTS.find((f) => f.key === key) ?? FONTS[0]!;
