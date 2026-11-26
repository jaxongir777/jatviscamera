
import { useEffect, useRef, useState } from 'react';
import { createEngine } from './engine.js';
import './App.css';

const TOOLS = [
  ['pencil', '✏️', 'Qalam'],
  ['line', '➖', 'Chiziq'],
  ['arrow', '➡️', 'Strelka'],
  ['rect', '⬜', "To'rtburchak"],
  ['circle', '⭕', 'Doira'],
  ['triangle', '🔺', 'Uchburchak'],
  ['star', '⭐', 'Yulduz'],
  ['eraser', '🧽', "O'chirg'ich"],
];

const COLORS = [
  '#00e5ff',
  '#ff3d71',
  '#ffd600',
  '#69f0ae',
  '#b388ff',
  '#ffffff',
];

const SIZES = [
  [4, 'S'],
  [8, 'M'],
  [14, 'L'],
];

const STICKERS = [
  '😎', '🔥', '⭐', '❤️',
  '👍', '🚀', '💡', '🎉',
  '🦄', '🐱', '🌈', '💎',
  '👑', '🎈', '⚡', '🤖',
];

const INITIAL = {
  menu: null,
  tool: 'pencil',
  color: '#00e5ff',
  size: 8,
  sticker: null,
  toolLabel: 'Qalam',
  anchorPerson: false,
  status: 'Tayyor emas',
  toast: '',
  nh: 0,
  no: 0,
  fps: 0,
  gProg: 0,
};

function App() {
  const canvasRef = useRef(null);
  const videoRef = useRef(null);
  const cursorRef = useRef(null);
  const engine = useRef(null);

  const [ui, setUi] = useState(INITIAL);
  const [started, setStarted] = useState(false);

  useEffect(() => {
    const e = createEngine({
      canvas: canvasRef.current,
      video: videoRef.current,
      cursor: cursorRef.current,
      onUI: setUi,
    });

    engine.current = e;

    return () => {
      e.destroy();
      engine.current = null;
    };
  }, []);

  const go = async () => {
    if (!engine.current) return;

    try {
      const ok = await engine.current.start();

      if (ok) {
        setStarted(true);
      }
    } catch (error) {
      console.error('Kamerani ishga tushirishda xato:', error);
    }
  };

  const E = () => engine.current;

  return (
    <>
      {/* Kamera */}
      <video
        ref={videoRef}
        playsInline
        muted
        style={{ display: 'none' }}
      />

      {/* Chizish maydoni */}
      <canvas
        id="stage"
        ref={canvasRef}
      />

      {/* Effektlar */}
      <div id="fx" />

      {/* Burchak bezaklari */}
      <div className="corner tl" />
      <div className="corner tr" />
      <div className="corner bl" />
      <div className="corner br" />

      {/* HUD */}
      <div id="hud">
        <b>J.A.R.V.I.S</b>
        <span style={{ opacity: 0.6 }}>AR</span>

        <span id="st">{ui.status}</span>

        <div className="row">
          <span>✋ {ui.nh}</span>
          <span>🎯 {ui.no}</span>
          <span>🛠 {ui.toolLabel}</span>
          <span>{ui.fps} fps</span>
        </div>

        <div id="gbar">
          <i
            style={{
              width: `${Math.min(1, ui.gProg) * 100}%`,
            }}
          />
        </div>
      </div>

      {/* Xabar */}
      <div
        id="toast"
        className={ui.toast ? 'show' : ''}
      >
        {ui.toast}
      </div>

      {/* Chizish menyusi */}
      <div
        className={`menu ${ui.menu === 'draw' ? 'show' : ''}`}
      >
        <h3>CHIZISH MENYUSI</h3>

        <div className="grp">
          {TOOLS.map(([id, icon, label]) => (
            <button
              key={id}
              className={`btn ${ui.tool === id ? 'sel' : ''}`}
              onClick={() => E()?.pickTool(id)}
            >
              {icon}
              <small>{label}</small>
            </button>
          ))}
        </div>

        <div className="grp">
          {COLORS.map((c) => (
            <button
              key={c}
              className={`btn sw ${ui.color === c ? 'sel' : ''}`}
              style={{ '--sc': c }}
              onClick={() => E()?.pickColor(c)}
              aria-label={`Rang ${c}`}
            />
          ))}

          {SIZES.map(([n, label]) => (
            <button
              key={n}
              className={`btn sz ${ui.size === n ? 'sel' : ''}`}
              onClick={() => E()?.pickSize(n)}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="grp">
          <button
            className="btn"
            onClick={() => E()?.undo()}
          >
            ↩️
            <small>Ortga</small>
          </button>

          <button
            className="btn"
            onClick={() => E()?.clear()}
          >
            🗑️
            <small>Tozalash</small>
          </button>

          <button
            className="btn"
            onClick={() => E()?.closeMenu()}
          >
            ✕
            <small>Yopish</small>
          </button>
        </div>
      </div>

      {/* Stikerlar menyusi */}
      <div
        className={`menu ${ui.menu === 'sticker' ? 'show' : ''}`}
      >
        <h3>STIKERLAR</h3>

        <div className="grid">
          {STICKERS.map((s) => (
            <button
              key={s}
              className={`btn ${
                ui.tool === 'sticker' && ui.sticker === s
                  ? 'sel'
                  : ''
              }`}
              onClick={() => E()?.pickSticker(s)}
            >
              {s}
            </button>
          ))}
        </div>

        <div className="grp">
          <button
            className="btn"
            onClick={() => E()?.closeMenu()}
          >
            ✕
            <small>Yopish</small>
          </button>
        </div>
      </div>

      {/* Pastki boshqaruv paneli */}
      <div id="dock">
        <button onClick={() => E()?.openMenu('draw')}>
          ✏️ Chizish (1 qo'l)
        </button>

        <button onClick={() => E()?.openMenu('sticker')}>
          🎭 Stikerlar (2 qo'l)
        </button>

        <button onClick={() => E()?.togglePerson()}>
          👤 Odamga yopishtirish:{' '}
          {ui.anchorPerson ? 'YONIQ' : "O'CHIQ"}
        </button>

        <button onClick={() => E()?.undo()}>
          ↩️ Ortga
        </button>

        <button onClick={() => E()?.clear()}>
          🗑️ Tozalash
        </button>
      </div>

      {/* Kursor */}
      <div
        id="cursor"
        ref={cursorRef}
      />

      {/* Boshlash oynasi */}
      {!started && (
        <div id="start">
          <div className="box">
            <h1>JARVIS</h1>

            <p
              style={{
                opacity: 0.7,
                marginTop: 6,
              }}
            >
              Kamera + qo'l ishoralari + AR
            </p>

            <ul>
              <li>
                ☝️ <b>1 ta ochiq kaft</b>ni yuqoriga
                ko'taring (0.8 s) → chizish menyusi
              </li>

              <li>
                🙌 <b>2 ta ochiq kaft</b>ni ko'taring
                (0.6 s) → stikerlar menyusi
              </li>

              <li>
                👆 Menyuda ko'rsatkich barmoq bilan
                tugma ustida turing yoki 🤏 chimchilang
              </li>

              <li>
                🤏 Chimchilab turib: chizing / shakl
                torting / stiker qo'ying va suring
              </li>

              <li>
                ✊ Musht (0.6 s) → menyuni yopish
              </li>

              <li>
                🎯 Obyektga (stakan, telefon, kitob…)
                chizsangiz yoki stiker qo'ysangiz,
                u obyekt bilan birga yuradi
              </li>
            </ul>

            <button
              id="go"
              onClick={go}
            >
              KAMERANI YOQISH
            </button>

            {ui.status.startsWith('Kamera ochilmadi') && (
              <p
                style={{
                  color: '#ff9b9b',
                  marginTop: 12,
                }}
              >
                {ui.status}
              </p>
            )}

            <p
              style={{
                fontSize: 12,
                opacity: 0.5,
                marginTop: 14,
              }}
            >
              Sichqoncha ham ishlaydi (sinash uchun).
              Internet kerak: modellar CDN'dan yuklanadi.
            </p>
          </div>
        </div>
      )}
    </>
  );
}

export default App;
