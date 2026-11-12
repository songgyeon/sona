/* 소리 칸과 영상 칸 — 오프닝 영상의 음악과 배경 음악은 앱에 하나씩 둔 소리 칸으로, 오프닝 영상의 영상 컷은 앱에 몇 개 둔 영상 칸으로 낸다.
   휴대폰은 누른 그 자리에서 튼 적 없는 칸으로는 소리를 못 낸다(아이폰, 안드로이드 WebView. 삼성 인터넷도 그런 것으로 보인다).
   「필름에 들어가기」를 누르고 필름을 불러오는 사이에 그 순간이 지나가 버려서, 오프닝 음악이 바로 안 나왔다(2026-11-12 사용자: 「음악 바로 안 나와서 최악」).
   영상 컷도 같았다. 그때그때 새로 만든 영상 칸은 소리를 켜고 틀 수 없어 소리 없이 틀고, 다음 화면에서 소리를 다시 켜면
   브라우저가 멈추기를 되풀이해서 끊기고 소리가 안 났다(2026-11-12 사용자: 삼성 인터넷에서 「영상 더 끊기고 소리도 안 나고」).
   그래서 칸들을 앱에 두고, 앱을 누를 때 깨워 둔다. 깨운 칸은 그 뒤로 언제든 소리를 낸다.
   화면을 밀어 내리고 뗀 손은 누른 것이 아니라서 깨우지 못한다 — 정말 누른 것이 올 때까지 기다린다. */

import { RULES } from '../shared/rules';

/** 소리 없는 아주 짧은 소리 */
const SILENT = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=';

type Which = 'reel' | 'bgm';
const els: Partial<Record<Which, HTMLAudioElement>> = {};
const screens: HTMLVideoElement[] = [];

/** 오프닝 영상의 음악(reel)과 배경 음악(bgm)의 소리 칸. 앱에 하나씩이다 */
export function soundEl(which: Which): HTMLAudioElement {
  let a = els[which];
  if (!a) {
    a = new Audio();
    a.preload = 'auto';
    els[which] = a;
  }
  return a;
}

/** 오프닝 영상의 영상 칸들. 앱에 RULES.reel.screens개를 두고, 오프닝 영상이 영상 컷마다 돌려 가며 빌려 쓴다 */
export function screenEls(): HTMLVideoElement[] {
  while (screens.length < RULES.reel.screens) {
    const v = document.createElement('video');
    v.playsInline = true;
    v.muted = true;
    v.preload = 'auto';
    screens.push(v);
  }
  return screens;
}

/** 누른 그 자리에서 부르면 이 칸은 그 뒤로 소리를 켜고 틀 수 있다. 틀고 있던 칸은 튼 채로, 멈춰 있던 칸은 멈춘 채로 둔다 */
export function unlock(el: HTMLMediaElement): void {
  if (el.ended) return;
  const was = el.paused;
  const p = el.play();
  if (was) el.pause();
  p?.catch(() => {});
}

/** 지금 정말 누른 것인가. 화면을 밀어 내리고 뗀 손은 아니다. 그것을 알려 주지 않는 브라우저에서는 click만 믿는다 */
export function pressed(e?: Event): boolean {
  const ua = navigator.userActivation as UserActivation | undefined;
  return ua ? ua.isActive : e?.type === 'click';
}

/** 앱을 누를 때 소리 칸과 영상 칸을 깨운다. 정말 누른 것이 한 번 오면 된다 */
export function wakeSoundOnTouch(): void {
  let awake = false;
  const wake = (e: Event) => {
    if (awake || !pressed(e)) return;
    awake = true;
    for (const w of ['reel', 'bgm'] as const) {
      const a = soundEl(w);
      // 벌써 무엇을 걸어 둔 칸은 튼 채로·멈춘 채로 깨운다
      if (a.getAttribute('src')) {
        unlock(a);
        continue;
      }
      a.src = SILENT;
      a.play()
        .then(() => {
          if (a.src === SILENT) a.pause();
        })
        .catch(() => {});
    }
    screenEls().forEach(unlock);
    window.removeEventListener('click', wake, true);
    window.removeEventListener('touchend', wake, true);
  };
  window.addEventListener('click', wake, true);
  window.addEventListener('touchend', wake, true);
}
