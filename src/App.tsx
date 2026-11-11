import { type FormEvent, useEffect, useState } from 'react';
import { ApiFail, api, getKey, setKey } from './api';
import { Create } from './pages/Create';
import { Film } from './pages/Film';
import { Home } from './pages/Home';
import { Play } from './pages/Play';
import { useRoute } from './router';

/** 주소는 열려 있다. locked는 주인이 열쇠를 걸어 둔 주소에서만, down은 서버와 말이 안 될 때만 */
type Gate = 'checking' | 'open' | 'locked' | 'down';

/** 주인이 주소를 잠가 뒀다면 링크에 열쇠가 들어 있다(?k=…). 받아서 기억하고 주소에서는 지운다 */
function takeKeyFromUrl(): void {
  const url = new URL(window.location.href);
  const k = url.searchParams.get('k');
  if (!k) return;
  setKey(k);
  url.searchParams.delete('k');
  window.history.replaceState(null, '', url.pathname + url.search);
}

export function App() {
  const [path, go] = useRoute();
  const [gate, setGate] = useState<Gate>('checking');
  const [why, setWhy] = useState('');
  const [fake, setFake] = useState(false);
  const [modelReady, setModelReady] = useState(true);

  const check = async () => {
    setGate('checking');
    try {
      const r = await api.key();
      setFake(r.fake);
      setModelReady(r.modelReady);
      setGate('open');
    } catch (e) {
      if (e instanceof ApiFail && e.code === 'bad_key') {
        // 주인이 열쇠를 걸어 둔 주소다. 아직 안 넣어 본 사람에게 "맞지 않아"라고 하지 않는다
        setWhy(getKey() ? e.message : '');
        setGate('locked');
        return;
      }
      // 열쇠 문제가 아니다. 열쇠를 묻지 않고 다시 열어 보게 한다
      setWhy(e instanceof ApiFail ? e.message : '서버와 말하지 못했어.');
      setGate('down');
    }
  };

  useEffect(() => {
    takeKeyFromUrl();
    void check();
  }, []);

  if (gate === 'checking') return <p className="center muted">여는 중…</p>;
  if (gate === 'locked') return <KeyGate why={why} onSubmit={check} />;
  if (gate === 'down')
    return (
      <main className="gate">
        <h1>소나</h1>
        <p className="warn">{why}</p>
        <button onClick={() => void check()}>다시 열기</button>
      </main>
    );

  const play = /^\/play\/([0-9a-f-]{36})$/.exec(path);
  if (play) return <Play playId={play[1]!} go={go} />;
  const film = /^\/film\/([0-9a-f-]{36})$/.exec(path);
  if (film) return <Film filmId={film[1]!} go={go} />;
  if (path === '/create') return <Create go={go} />;
  return <Home go={go} fake={fake} modelReady={modelReady} />;
}

function KeyGate({ why, onSubmit }: { why: string; onSubmit: () => void }) {
  const [value, setValue] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!value.trim()) return;
    setKey(value);
    onSubmit();
  };
  return (
    <main className="gate">
      <h1>소나</h1>
      <p className="muted">필름 한 편을 골라 그 안의 인물로 들어가 산다.</p>
      <form onSubmit={submit}>
        <label htmlFor="key">열쇠</label>
        <input
          id="key"
          type="password"
          autoComplete="off"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="받은 열쇠를 넣어 줘"
        />
        <button type="submit">열기</button>
      </form>
      {why && <p className="warn">{why}</p>}
    </main>
  );
}
