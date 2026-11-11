/* 프로필 사진 고르기와 자르기.
   프로필 사진은 어디서나 원으로 보인다. 그래서 고르면 먼저 원 안에 맞춰 자른다 —
   사진을 끌어 자리를 맞추고, 두 손가락이나 아래 막대로 크기를 바꾼다. 원 안에 보이는 대로 올라간다. */

import { type ChangeEvent, type KeyboardEvent, type PointerEvent, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { boxOf, drag, scaleOf, startView, zoomTo, type Size, type View } from '../shared/crop';
import { RULES } from '../shared/rules';
import { ApiFail, imgUrl, uploadCrop } from './api';
import { Close, Upload } from './icons';

const PICTURES = 'image/jpeg,image/png,image/webp';
/** 틀과 화면 가장자리 사이에 남기는 자리 */
const MARGIN = 28;
/** 바퀴를 굴릴 때와 +, - 키를 누를 때 크기가 바뀌는 정도 */
const WHEEL = 0.0015;
const KEY_ZOOM = 1.1;

/** 프로필 사진 칸. 사진을 고르면 자르는 화면이 뜨고, 다 자르면 올린 사진을 가리키는 값을 건넨다 */
export function FacePick({ face, label, disabled, onPick }: { face: string; label: string; disabled?: boolean; onPick: (id: string) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const choose = (e: ChangeEvent<HTMLInputElement>) => {
    const picked = e.target.files?.[0];
    e.target.value = '';
    if (picked) setFile(picked);
  };
  const close = () => {
    setFile(null);
    input.current?.focus();
  };

  return (
    <>
      <label className={face ? 'drop facepick has' : 'drop facepick'}>
        {face ? (
          <img src={imgUrl(face)} alt="" />
        ) : (
          <>
            <Upload />
            <b>사진</b>
          </>
        )}
        <input ref={input} type="file" accept={PICTURES} disabled={disabled} aria-label={label} onChange={choose} />
      </label>
      {file && (
        <Crop
          file={file}
          onCancel={close}
          onDone={(id) => {
            close();
            onPick(id);
          }}
        />
      )}
    </>
  );
}

/** 사진 자르기. 원 안에 보이는 네모를 잘라 올리고, 올린 사진을 가리키는 값을 건넨다 */
export function Crop({ file, onDone, onCancel }: { file: File; onDone: (id: string) => void; onCancel: () => void }) {
  const [url, setUrl] = useState('');
  const [size, setSize] = useState<Size | null>(null);
  const [frame, setFrame] = useState(0);
  const [view, setView] = useState<View>({ zoom: 1, cx: 0, cy: 0 });
  const [broken, setBroken] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const box = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const picture = useRef<HTMLImageElement>(null);
  /** 화면에 닿아 있는 손가락들 */
  const touches = useRef(new Map<number, { x: number; y: number }>());
  /** 두 손가락 사이의 거리와 가운데. 두 손가락일 때만 있다 */
  const pinch = useRef<{ dist: number; x: number; y: number } | null>(null);

  useEffect(() => {
    const made = URL.createObjectURL(file);
    setUrl(made);
    return () => URL.revokeObjectURL(made);
  }, [file]);

  // 뒤의 화면이 따라 움직이지 않게 붙들어 둔다
  useEffect(() => {
    const root = document.documentElement;
    const before = root.style.overflow;
    root.style.overflow = 'hidden';
    return () => {
      root.style.overflow = before;
    };
  }, []);

  // 틀은 사진을 놓는 자리에 들어가는 가장 큰 원이다
  useLayoutEffect(() => {
    const el = stage.current;
    if (!el) return;
    const measure = () => setFrame(Math.max(120, Math.min(el.clientWidth, el.clientHeight) - MARGIN * 2));
    measure();
    const watch = new ResizeObserver(measure);
    watch.observe(el);
    return () => watch.disconnect();
  }, []);

  useEffect(() => {
    (size ? stage.current : box.current)?.focus();
  }, [size]);

  // 바퀴로 크기를 바꾼다. 뒤의 화면이 굴러가지 않게 막아야 해서 직접 건다
  useEffect(() => {
    const el = stage.current;
    if (!el || !size) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const c = middle(el);
      setView((v) => zoomTo(size, v, frame, v.zoom * Math.exp(-e.deltaY * WHEEL), e.clientX - c.x, e.clientY - c.y));
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  }, [size, frame]);

  const loaded = () => {
    const el = picture.current;
    if (!el || el.naturalWidth === 0 || el.naturalHeight === 0) return setBroken(true);
    const s = { w: el.naturalWidth, h: el.naturalHeight };
    setSize(s);
    setView(startView(s));
  };

  const two = () => {
    const [a, b] = [...touches.current.values()] as [{ x: number; y: number }, { x: number; y: number }];
    return { dist: Math.hypot(a.x - b.x, a.y - b.y), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  };

  const down = (e: PointerEvent<HTMLDivElement>) => {
    if (!size || busy) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    pinch.current = touches.current.size === 2 ? two() : null;
  };

  const move = (e: PointerEvent<HTMLDivElement>) => {
    const was = touches.current.get(e.pointerId);
    if (!was || !size || busy) return;
    touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (touches.current.size === 1) {
      // 한 손가락: 끈다
      setView((v) => drag(size, v, frame, e.clientX - was.x, e.clientY - was.y));
    } else if (touches.current.size === 2 && pinch.current) {
      // 두 손가락: 벌린 만큼 크기를 바꾸고, 함께 움직인 만큼 끈다
      const before = pinch.current;
      const now = two();
      const c = middle(e.currentTarget);
      pinch.current = now;
      setView((v) =>
        drag(size, zoomTo(size, v, frame, v.zoom * (now.dist / Math.max(1, before.dist)), before.x - c.x, before.y - c.y), frame, now.x - before.x, now.y - before.y),
      );
    }
  };

  const up = (e: PointerEvent<HTMLDivElement>) => {
    touches.current.delete(e.pointerId);
    pinch.current = touches.current.size === 2 ? two() : null;
  };

  const onStageKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!size || busy) return;
    const d = RULES.crop.step;
    const by: Record<string, [number, number]> = { ArrowLeft: [-d, 0], ArrowRight: [d, 0], ArrowUp: [0, -d], ArrowDown: [0, d] };
    const go = by[e.key];
    if (go) setView((v) => drag(size, v, frame, go[0], go[1]));
    else if (e.key === '+' || e.key === '=') setView((v) => zoomTo(size, v, frame, v.zoom * KEY_ZOOM));
    else if (e.key === '-' || e.key === '_') setView((v) => zoomTo(size, v, frame, v.zoom / KEY_ZOOM));
    else return;
    e.preventDefault();
  };

  // 닫는 키와, 이 화면 밖으로 초점이 나가지 않게 하는 일
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape' && !busy) return onCancel();
    if (e.key !== 'Tab' || !box.current) return;
    const stops = [...box.current.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), [tabindex="0"]')];
    const first = stops[0];
    const last = stops[stops.length - 1];
    if (!first || !last) return;
    const at = document.activeElement;
    if (e.shiftKey && (at === first || at === box.current)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && at === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const done = async () => {
    if (!size || !picture.current || busy) return;
    setBusy(true);
    setErr('');
    try {
      onDone(await uploadCrop(picture.current, boxOf(size, view), RULES.crop.face));
    } catch (x) {
      setErr(x instanceof ApiFail ? x.message : '사진을 올리지 못했어요.');
      setBusy(false);
    }
  };

  const k = size && frame ? scaleOf(size, view, frame) : 0;

  return createPortal(
    <div className="crop" role="dialog" aria-modal="true" aria-label="사진 자르기" tabIndex={-1} ref={box} onKeyDown={onKey}>
      <div className="in">
        <div className="head">
          <button className="ico" onClick={onCancel} disabled={busy} aria-label="닫기">
            <Close />
          </button>
          <b>사진 자르기</b>
        </div>

        <div
          className="stage"
          ref={stage}
          role="group"
          tabIndex={size ? 0 : -1}
          aria-label="화살표 키로 사진을 움직일 수 있어요."
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
          onKeyDown={onStageKey}
        >
          {url && !broken && (
            <img
              ref={picture}
              src={url}
              alt=""
              draggable={false}
              onLoad={loaded}
              onError={() => setBroken(true)}
              style={
                size
                  ? {
                      width: size.w * k,
                      height: size.h * k,
                      transform: `translate(calc(-50% + ${(size.w / 2 - view.cx) * k}px), calc(-50% + ${(size.h / 2 - view.cy) * k}px))`,
                    }
                  : { visibility: 'hidden' }
              }
            />
          )}
          {size ? <span className="ring" style={{ width: frame, height: frame }} /> : <p className="wait">{broken ? '사진을 읽지 못했어요.' : '불러오는 중'}</p>}
        </div>

        <div className="dock">
          <label className="zoom">
            <span>크기</span>
            <input
              type="range"
              min={1}
              max={RULES.crop.maxZoom}
              step={0.01}
              value={view.zoom}
              disabled={!size || busy}
              aria-valuetext={`${Math.round(view.zoom * 100)}%`}
              onChange={(e) => size && setView((v) => zoomTo(size, v, frame, Number(e.target.value)))}
            />
          </label>
          <p className="hint">끌어서 자리를 맞추고 크기를 조절해 주세요.</p>
          {err && (
            <p className="warn" role="alert">
              {err}
            </p>
          )}
          <div className="next">
            <button className="btn play" disabled={!size || busy} onClick={done}>
              {busy ? '올리는 중' : '완료'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** 요소의 한가운데(화면에서의 자리) */
function middle(el: Element): { x: number; y: number } {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}
