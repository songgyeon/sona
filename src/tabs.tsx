import type { ReactNode } from 'react';
import { FilmIcon, HomeIcon, PlayLine, Plus, Search } from './icons';

const TABS: [string, string, ReactNode][] = [
  ['/', '홈', <HomeIcon key="i" />],
  ['/find', '찾기', <Search key="i" />],
  ['/create', '만들기', <Plus key="i" />],
  ['/living', '이어 살기', <PlayLine key="i" />],
  ['/mine', '내 필름', <FilmIcon key="i" />],
];

/** 맨 아래 탭. 어디에 있는지는 가는 선 하나로 알린다 */
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
