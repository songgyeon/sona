import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// 글꼴은 앱에 같이 싣는다. 쓰는 글자가 든 조각만 내려받는다
import 'pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css';
import '@fontsource-variable/noto-serif-kr/index.css';
import { App } from './App';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
