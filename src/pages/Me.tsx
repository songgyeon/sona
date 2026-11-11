import { type ChangeEvent, useEffect, useState } from 'react';
import { RULES } from '../../shared/rules';
import { ApiFail, api, imgUrl, uploadImage } from '../api';
import { Back, Upload } from '../icons';
import { Card, Field } from './Create';

const PICTURES = 'image/jpeg,image/png,image/webp';

/** 내 배역. 플레이하는 사람이 자기 삶에서 맡은 인물의 사진과 정보를 고친다.
    고친 것은 내 삶에만 적히고, 같은 필름에 다시 들어가도 이어진다. 디렉터의 필름은 그대로다 */
export function Me({ playId, go }: { playId: string; go: (to: string) => void }) {
  const [ready, setReady] = useState(false);
  const [name, setName] = useState('');
  const [line, setLine] = useState('');
  const [face, setFace] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    api
      .play(playId)
      .then((v) => {
        setName(v.film.persona.name);
        setLine(v.film.persona.line);
        setFace(v.film.persona.face ?? '');
        setReady(true);
      })
      .catch((e) => setErr(e instanceof ApiFail ? e.message : '내 배역을 불러오지 못했어요.'));
  }, [playId]);

  const back = () => go(`/play/${playId}`);

  const pick = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    setErr('');
    try {
      setFace(await uploadImage(file, 640));
    } catch (x) {
      setErr(x instanceof ApiFail ? x.message : '사진을 올리지 못했어요.');
    }
    setBusy(false);
  };

  const save = async () => {
    setBusy(true);
    setErr('');
    try {
      await api.setPersona(playId, { name, line, face });
      back();
    } catch (x) {
      setErr(x instanceof ApiFail ? x.message : '저장하지 못했어요.');
      setBusy(false);
    }
  };

  if (!ready) return <p className="center">{err || '불러오는 중'}</p>;

  return (
    <main className="app make">
      <div className="head">
        <button className="ico" onClick={back} aria-label="돌아가기">
          <Back />
        </button>
        <b>내 배역</b>
        <div className="right">
          <button className="mini open" disabled={busy || !name.trim()} onClick={save}>
            저장
          </button>
        </div>
      </div>

      <section className="body">
        <p className="lead">이 필름에서 내가 맡은 인물이에요.</p>
        <p className="sub">고친 내용은 내 삶에만 적혀요.</p>

        <Card title="프로필">
          <div className="casthead">
            <label className={face ? 'drop facepick has' : 'drop facepick'}>
              {face ? (
                <img src={imgUrl(face)} alt="" />
              ) : (
                <>
                  <Upload />
                  <b>사진</b>
                </>
              )}
              <input type="file" accept={PICTURES} disabled={busy} aria-label="내 사진 고르기" onChange={pick} />
            </label>
            <Field label="이름" must count={[name.length, 20]}>
              <input value={name} maxLength={20} onChange={(e) => setName(e.target.value)} />
            </Field>
          </div>
          {face && (
            <p className="hint">
              <button className="textbtn" onClick={() => setFace('')}>
                사진 빼기
              </button>
            </p>
          )}
          <Field label="어떤 사람" count={[line.length, RULES.limits.persona]} hint="캐스트가 나를 이런 사람으로 알고 대해요.">
            <textarea rows={3} value={line} maxLength={RULES.limits.persona} placeholder="예) 한 학기 만에 방송부로 돌아온 사람" onChange={(e) => setLine(e.target.value)} />
          </Field>
          <p className="hint">이름을 바꾸면 필름 속 글의 이름도 함께 바뀌어요.</p>
        </Card>

        {err && (
          <p className="warn" style={{ marginTop: 20 }}>
            {err}
          </p>
        )}

        <div className="next">
          <button className="btn play" disabled={busy || !name.trim()} onClick={save}>
            저장
          </button>
        </div>
      </section>
    </main>
  );
}
