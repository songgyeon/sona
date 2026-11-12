import { type FormEvent, useEffect, useState } from 'react';
import { ApiFail, api, getKey, setKey } from './api';
import { Aside } from './pages/Aside';
import { Cast } from './pages/Cast';
import { Create } from './pages/Create';
import { Film } from './pages/Film';
import { Home } from './pages/Home';
import { Me } from './pages/Me';
import { Find, Living, Mine } from './pages/Lists';
import { MeCtx, NamePop } from './me';
import { Personas } from './pages/Personas';
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

const ID = '([0-9a-f-]{36})';

export function App() {
  const [path, go] = useRoute();
  const [gate, setGate] = useState<Gate>('checking');
  const [why, setWhy] = useState('');
  const [fake, setFake] = useState(false);
  const [modelReady, setModelReady] = useState(true);
  /** 내 이름. 아직 정하지 않았으면 빈 글자 — 입장권이 뜬다 */
  const [name, setName] = useState('');
  /** 입장권을 띄우고 있나 */
  const [naming, setNaming] = useState(false);

  const check = async () => {
    setGate('checking');
    try {
      const r = await api.key();
      setFake(r.fake);
      setModelReady(r.modelReady);
      // 내 이름을 아직 안 정했으면 입장권부터 띄운다. 못 읽었으면 묻지 않고 그냥 들어간다
      const me = await api.me().catch(() => null);
      setName(me?.name ?? '');
      setNaming(me !== null && !me.name);
      setGate('open');
    } catch (e) {
      if (e instanceof ApiFail && e.code === 'bad_key') {
        // 주인이 열쇠를 걸어 둔 주소다. 아직 안 넣어 본 사람에게 "맞지 않아"라고 하지 않는다
        setWhy(getKey() ? e.message : '');
        setGate('locked');
        return;
      }
      // 열쇠 문제가 아니다. 열쇠를 묻지 않고 다시 열어 보게 한다
      setWhy(e instanceof ApiFail ? e.message : '서버에 연결하지 못했어요.');
      setGate('down');
    }
  };

  useEffect(() => {
    takeKeyFromUrl();
    void check();
  }, []);

  if (gate === 'checking') return <p className="center">불러오는 중</p>;
  if (gate === 'locked') return <KeyGate why={why} onSubmit={check} />;
  if (gate === 'down')
    return (
      <main className="gate">
        <h1>SONA</h1>
        <p className="warn">{why}</p>
        <button className="btn more" onClick={() => void check()}>
          다시 시도
        </button>
      </main>
    );

  return (
    <MeCtx.Provider value={{ name, rename: () => setNaming(true) }}>
      <Page path={path} go={go} fake={fake} modelReady={modelReady} />
      {naming && (
        <NamePop
          name={name}
          onDone={(next) => {
            setName(next);
            setNaming(false);
          }}
          onClose={name ? () => setNaming(false) : undefined}
        />
      )}
    </MeCtx.Provider>
  );
}

/** 주소에 맞는 화면 */
function Page({ path, go, fake, modelReady }: { path: string; go: (to: string) => void; fake: boolean; modelReady: boolean }) {
  let m: RegExpExecArray | null;
  if ((m = new RegExp(`^/play/${ID}/cast/(c[1-9])$`).exec(path))) return <Cast playId={m[1]!} castKey={m[2]!} go={go} />;
  if ((m = new RegExp(`^/play/${ID}/aside/${ID}$`).exec(path))) return <Aside key={m[2]} playId={m[1]!} asideId={m[2]!} go={go} />;
  if ((m = new RegExp(`^/play/${ID}/me$`).exec(path))) return <Me key={m[1]} playId={m[1]!} go={go} />;
  if ((m = new RegExp(`^/play/${ID}$`).exec(path))) return <Play key={m[1]} playId={m[1]!} go={go} />;
  if ((m = new RegExp(`^/film/${ID}/cast/(c[1-9])$`).exec(path))) return <Cast filmId={m[1]!} castKey={m[2]!} go={go} />;
  if ((m = new RegExp(`^/film/${ID}/edit$`).exec(path))) return <Create key={m[1]} editId={m[1]!} go={go} />;
  if ((m = new RegExp(`^/film/${ID}$`).exec(path))) return <Film filmId={m[1]!} go={go} />;
  if ((m = new RegExp(`^/create/${ID}$`).exec(path))) return <Create key={m[1]} draftId={m[1]!} go={go} />;
  if (path === '/create') return <Create key="new" go={go} />;
  if (path === '/personas') return <Personas go={go} />;
  if (path === '/find') return <Find go={go} />;
  if (path === '/living') return <Living go={go} />;
  if (path === '/mine') return <Mine go={go} />;
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
      <h1>SONA</h1>
      <form onSubmit={submit}>
        <label htmlFor="key">열쇠</label>
        <input id="key" type="password" autoComplete="off" value={value} onChange={(e) => setValue(e.target.value)} placeholder="받은 열쇠" />
        <button type="submit" className="btn play">
          열기
        </button>
      </form>
      {why && <p className="warn">{why}</p>}
    </main>
  );
}
