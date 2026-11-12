import type { ReactNode } from 'react';
import { Camera, FilmIcon, PlayLine, Search, Ticket } from './icons';

const TABS: [string, string, ReactNode][] = [
  ['/', '상영작', <Ticket key="i" />],
  // 이름은 사용자가 정했다(2026-11-12): 홈 → 로비 → 상영작(입장권), 찾기 → 아카이브, 만들기 → 크랭크인(촬영기)
  ['/find', '아카이브', <Search key="i" />],
  ['/create', '크랭크인', <Camera key="i" />],
  ['/living', '이어 살기', <PlayLine key="i" />],
  ['/mine', '내 필름', <FilmIcon key="i" />],
];

/** 맨 아래 탭. 모든 화면에 선다(2026-11-12 사용자 지시). 어디에 있는지는 가는 선 하나로 알린다 */
export function Tabs({ path, go }: { path: string; go: (to: string) => void }) {
  return (
    <nav className="tabs" aria-label="화면 고르기">
      {TABS.map(([to, label, icon]) => (
        <button key={to} className={path === to ? 'tab on' : 'tab'} onClick={() => go(to)} aria-current={path === to ? 'page' : undefined}>
          {icon}
          {label}
        </button>
      ))}
    </nav>
  );
}
