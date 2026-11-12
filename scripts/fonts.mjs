// 오프닝 영상의 글자에 쓰는 글꼴의 @font-face를 만든다(src/fonts/*.css). 글꼴은 @fontsource 패키지에 있다.
// woff2만 싣는다 — 쓰는 브라우저가 다 읽고, woff까지 실으면 파일이 두 배다. 글꼴마다 굵기 하나.
// 패키지를 올리거나 글꼴을 더하면 다시 돌린다: node scripts/fonts.mjs
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const FONTS = [
  ['nanum-myeongjo', 700],
  ['gowun-batang', 400],
  ['song-myung', 400],
  ['black-han-sans', 400],
  ['do-hyeon', 400],
  ['jua', 400],
  ['gowun-dodum', 400],
  ['nanum-pen-script', 400],
  ['nanum-brush-script', 400],
  ['east-sea-dokdo', 400],
];

mkdirSync('src/fonts', { recursive: true });
for (const [name, weight] of FONTS) {
  const css = readFileSync(`node_modules/@fontsource/${name}/${weight}.css`, 'utf8').replace(
    /url\(\.\/files\/([^)]+\.woff2)\) format\('woff2'\), url\(\.\/files\/[^)]+\.woff\) format\('woff'\)/g,
    (_, file) => `url(../../node_modules/@fontsource/${name}/files/${file}) format('woff2')`,
  );
  if (css.includes(".woff)")) throw new Error(`${name}: woff가 남았다`);
  writeFileSync(`src/fonts/${name}.css`, `/* scripts/fonts.mjs가 만든다. 손으로 고치지 않는다 */\n${css}`);
}
console.log(`글꼴 ${FONTS.length}개`);
