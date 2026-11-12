"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import type { FunctionalTest } from "@/lib/tests";
import { lensesFor } from "@/lib/deviceSpecs";
import { runSpeakerLoopback, pulseTone } from "@/lib/speakerTest";

export type Result = "pass" | "fail" | "skip";
export type GameProps = {
  test: FunctionalTest;
  onDone: (r: Result) => void;
  strict?: boolean; // 100% coverage: no Skip button
  scale?: number; // demographic target scaling (senior = bigger)
  model?: string; // drives model-aware tests (e.g. which camera lenses to trigger)
};

/* ---------- shared chrome ---------- */
function GameShell({
  test,
  children,
  onDone,
  hideFail,
  strict,
}: GameProps & { children: React.ReactNode; hideFail?: boolean }) {
  return (
    <div className="flex h-full flex-col">
      <div className="p-4 text-center">
        <div className="text-4xl floaty">{test.emoji}</div>
        <h2 className="mt-2 text-xl font-extrabold">{test.game}</h2>
        <p className="text-sm text-[var(--muted)]">Testing: {test.name}</p>
      </div>
      <div className="relative flex-1">{children}</div>
      {!hideFail && (
        <div className="flex gap-2 p-4">
          <button
            className="btn btn-bad flex-1"
            onClick={() => onDone("fail")}
          >
            ✕ Doesn&apos;t work
          </button>
          {!strict && (
            <button className="btn btn-ghost" onClick={() => onDone("skip")}>
              Skip
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/* ---------- 1. Touchscreen: full-screen coverage ---------- */
function TouchGame({ onDone, scale = 1 }: GameProps) {
  // The ENTIRE viewport is a grid you must swipe edge-to-edge — any cell left
  // unpopped is a dead zone. Denser + truly full-screen (old one had a header/
  // padding, so the top & edges never got tested).
  const COLS = Math.max(4, Math.round(8 / scale));
  const ROWS = Math.max(7, Math.round(14 / scale));
  const total = COLS * ROWS;
  // Reserve the 2 bottom-centre cells for the "dead zone" button (no false gap).
  const reserved = [
    (ROWS - 1) * COLS + Math.floor(COLS / 2) - 1,
    (ROWS - 1) * COLS + Math.floor(COLS / 2),
  ];
  const [popped, setPopped] = useState<Set<number>>(new Set(reserved));
  const dragging = useRef(false);

  function pop(i: number) {
    setPopped((prev) => {
      if (prev.has(i)) return prev;
      const next = new Set(prev);
      next.add(i);
      return next;
    });
  }
  useEffect(() => {
    if (popped.size === total) {
      const t = setTimeout(() => onDone("pass"), 350);
      return () => clearTimeout(t);
    }
  }, [popped, total, onDone]);

  const pct = Math.round((popped.size / total) * 100);
  return (
    <div
      className="fixed inset-0 z-50 bg-[var(--bg)]"
      style={{ touchAction: "none", userSelect: "none" }}
      onPointerDown={() => (dragging.current = true)}
      onPointerUp={() => (dragging.current = false)}
      onPointerLeave={() => (dragging.current = false)}
    >
      <div
        className="grid h-full w-full"
        style={{
          gridTemplateColumns: `repeat(${COLS},1fr)`,
          gridTemplateRows: `repeat(${ROWS},1fr)`,
        }}
      >
        {Array.from({ length: total }).map((_, i) => {
          const done = popped.has(i);
          return (
            <div
              key={i}
              onPointerDown={() => pop(i)}
              onPointerEnter={() => dragging.current && pop(i)}
              style={{
                background: done ? "transparent" : "var(--grad)",
                outline: done ? "none" : "1px solid rgba(255,255,255,0.22)",
                opacity: done ? 0 : 1,
                transition: "opacity .1s",
              }}
            />
          );
        })}
      </div>
      {/* progress — taps pass through to the cells underneath */}
      <div className="pointer-events-none fixed left-1/2 top-4 -translate-x-1/2">
        <span className="pill" style={{ fontSize: 13 }}>
          🫧 Swipe every corner &amp; edge — {pct}%
        </span>
      </div>
      <button
        className="btn btn-bad fixed bottom-3 left-1/2 -translate-x-1/2"
        style={{ padding: "8px 16px", fontSize: 13 }}
        onClick={() => onDone("fail")}
      >
        ✕ Dead zone
      </button>
    </div>
  );
}

/* ---------- 2. Multi-touch: pinch the star ---------- */
function MultiTouchGame({ test, onDone, strict }: GameProps) {
  // 2 fingers is standard multi-touch and avoids OS 3-finger screenshot gestures.
  const NEED = 2;
  const [max, setMax] = useState(0);
  const [fingers, setFingers] = useState(0);
  const pointersRef = useRef<Set<number>>(new Set());

  function updateCount(n: number) {
    setFingers(n);
    setMax((m) => Math.max(m, n));
  }

  useEffect(() => {
    if (max >= NEED) {
      const t = setTimeout(() => onDone("pass"), 400);
      return () => clearTimeout(t);
    }
  }, [max, onDone]);

  return (
    <GameShell test={test} onDone={onDone} strict={strict}>
      <div
        className="grid h-full place-items-center touch-none select-none"
        onTouchStart={(e) => updateCount(e.touches.length)}
        onTouchMove={(e) => updateCount(e.touches.length)}
        onTouchEnd={(e) => setFingers(e.touches.length)}
        onPointerDown={(e) => {
          pointersRef.current.add(e.pointerId);
          updateCount(pointersRef.current.size);
        }}
        onPointerMove={(e) => {
          if (pointersRef.current.has(e.pointerId)) {
            updateCount(pointersRef.current.size);
          }
        }}
        onPointerUp={(e) => {
          pointersRef.current.delete(e.pointerId);
          setFingers(pointersRef.current.size);
        }}
        onPointerCancel={(e) => {
          pointersRef.current.delete(e.pointerId);
          setFingers(pointersRef.current.size);
        }}
      >
        <div className="text-center">
          <div
            className="text-7xl transition-transform"
            style={{ transform: `scale(${1 + fingers * 0.2})` }}
          >
            ⭐
          </div>
          <p className="mt-4 text-lg font-bold">
            {max >= NEED ? "Nice! 🎉" : `Place ${NEED} fingers on screen at once`}
          </p>
          <p className="text-sm text-[var(--muted)]">
            most fingers seen: {max} / {NEED}
          </p>
        </div>
      </div>
    </GameShell>
  );
}

/* ---------- 3. Display: LCD fault check ---------- */
function DisplayGame({ test, onDone }: GameProps) {
  // Solid fills expose dead/stuck pixels & LCD lines; black shows backlight
  // bleed & bright pixels; the gradient reveals banding / discoloration.
  const screens: { bg: string; name: string; hint: string }[] = [
    { bg: "#ff0000", name: "Red", hint: "stuck green/blue pixels stand out" },
    { bg: "#00ff00", name: "Green", hint: "look for dark dots or lines" },
    { bg: "#0000ff", name: "Blue", hint: "look for dark dots or lines" },
    { bg: "#ffffff", name: "White", hint: "dead pixels & lines show here" },
    { bg: "#000000", name: "Black", hint: "backlight bleed & bright pixels" },
    { bg: "linear-gradient(90deg,#000,#fff)", name: "Gradient", hint: "banding / discoloration" },
    { bg: "#7f7f7f", name: "Grey", hint: "tint / mura / patches" },
  ];
  const FAULTS = [
    "Dead / stuck pixels",
    "Lines across the screen (LCD)",
    "Discoloration / burn-in / tint",
    "Black spots / pressure marks",
    "Backlight bleed",
    "Cracked glass / touch dead spot",
  ];
  const [i, setI] = useState(0);
  const [checking, setChecking] = useState(false);
  const [faults, setFaults] = useState<string[]>([]);

  // Fault checklist.
  if (checking) {
    return (
      <GameShell test={test} onDone={onDone} hideFail>
        <div className="flex h-full flex-col p-4">
          <p className="mb-2 text-center text-sm text-[var(--muted)]">
            Spot any of these? Tap all that apply.
          </p>
          <div className="flex flex-col gap-2 overflow-auto">
            {FAULTS.map((f) => {
              const on = faults.includes(f);
              return (
                <button
                  key={f}
                  className="card flex items-center justify-between p-3 text-left"
                  style={{ borderColor: on ? "var(--bad)" : "var(--border)" }}
                  onClick={() =>
                    setFaults((p) =>
                      on ? p.filter((x) => x !== f) : [...p, f]
                    )
                  }
                >
                  <span className="text-sm font-semibold">{f}</span>
                  <span>{on ? "☑️" : "⬜"}</span>
                </button>
              );
            })}
          </div>
          <div className="mt-auto flex gap-2 pt-3">
            <button
              className="btn btn-good flex-1"
              disabled={faults.length > 0}
              onClick={() => onDone("pass")}
            >
              ✓ Screen is clean
            </button>
            <button
              className="btn btn-bad flex-1"
              disabled={faults.length === 0}
              onClick={() => onDone("fail")}
            >
              ✕ Report {faults.length || ""} fault{faults.length === 1 ? "" : "s"}
            </button>
          </div>
        </div>
      </GameShell>
    );
  }

  // Full-screen fills.
  const s = screens[i];
  return (
    <div
      className="fixed inset-0 z-50"
      style={{ background: s.bg, touchAction: "none" }}
      onClick={() => (i < screens.length - 1 ? setI(i + 1) : setChecking(true))}
    >
      <div className="pointer-events-none fixed bottom-6 left-1/2 -translate-x-1/2 rounded-full bg-black/45 px-3 py-1 text-center text-xs text-white">
        {s.name} · tap for next ({i + 1}/{screens.length})
        <br />
        {s.hint}
      </div>
    </div>
  );
}

/* ---------- 4. Motion: roll the ball home ---------- */
function MotionGame({ test, onDone, strict }: GameProps) {
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [needPerm, setNeedPerm] = useState(false);
  const [active, setActive] = useState(false);
  const inHole = useRef(0);

  function handle(e: DeviceOrientationEvent) {
    if (e.gamma === null && e.beta === null && e.alpha === null) return;
    setActive(true);
    const gx = Math.max(-30, Math.min(30, e.gamma ?? 0)); // left/right
    const gy = Math.max(-30, Math.min(30, (e.beta ?? 0) - 40)); // front/back
    setPos({ x: gx / 30, y: gy / 30 });
  }
  useEffect(() => {
    const AnyOrient = window.DeviceOrientationEvent as any;
    if (AnyOrient && typeof AnyOrient.requestPermission === "function") {
      setNeedPerm(true); // iOS 13+: needs a tap to grant
    } else {
      window.addEventListener("deviceorientation", handle);
      return () => window.removeEventListener("deviceorientation", handle);
    }
  }, []);
  async function grant() {
    try {
      const AnyOrient = window.DeviceOrientationEvent as any;
      const res = await AnyOrient.requestPermission();
      if (res === "granted") {
        window.addEventListener("deviceorientation", handle);
        setNeedPerm(false);
      }
    } catch {
      /* denied */
    }
  }
  // ball near center target ⇒ pass after brief hold
  useEffect(() => {
    if (!active) return;
    const d = Math.hypot(pos.x, pos.y);
    if (d < 0.18) {
      inHole.current += 1;
      if (inHole.current > 8) onDone("pass");
    } else inHole.current = 0;
  }, [pos, active, onDone]);

  return (
    <GameShell test={test} onDone={onDone} strict={strict}>
      {needPerm ? (
        <div className="grid h-full place-items-center p-6 text-center">
          <button className="btn" onClick={grant}>
            Enable motion sensor
          </button>
        </div>
      ) : (
        <div className="relative h-full overflow-hidden">
          {/* target hole */}
          <div className="absolute left-1/2 top-1/2 h-16 w-16 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-dashed border-[var(--brand-2)]" />
          {/* ball */}
          <div
            className="absolute h-12 w-12 rounded-full"
            style={{
              background: "var(--grad)",
              left: `calc(50% + ${pos.x * 40}vw - 24px)`,
              top: `calc(50% + ${pos.y * 40}vh - 24px)`,
              transition: "left 0.05s linear, top 0.05s linear",
            }}
          />
          <p className="absolute bottom-2 w-full text-center text-sm text-[var(--muted)]">
            {active ? "Tilt to roll the ball into the ring" : "Tilt your phone…"}
          </p>
        </div>
      )}
    </GameShell>
  );
}

/* ---------- 4b. Compass / Magnetometer: rotate to verify heading ---------- */
function CompassGame({ test, onDone, strict }: GameProps) {
  const [heading, setHeading] = useState<number | null>(null);
  const [needPerm, setNeedPerm] = useState(false);
  const [sweep, setSweep] = useState(0);
  const startHeadingRef = useRef<number | null>(null);
  const maxSweepRef = useRef(0);
  const doneRef = useRef(false);

  const cardinal = (deg: number) => {
    const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
    return dirs[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
  };

  function onOrient(ev: DeviceOrientationEvent) {
    const wk = (ev as DeviceOrientationEvent & { webkitCompassHeading?: number })
      .webkitCompassHeading;
    const raw =
      typeof wk === "number" && Number.isFinite(wk)
        ? wk
        : typeof ev.alpha === "number" && Number.isFinite(ev.alpha)
          ? (360 - ev.alpha) % 360
          : null;
    if (raw === null) return;
    const deg = Math.round(((raw % 360) + 360) % 360);
    setHeading(deg);
    if (startHeadingRef.current === null) {
      startHeadingRef.current = deg;
    } else {
      const diff = Math.abs((((deg - startHeadingRef.current + 540) % 360) - 180));
      if (diff > maxSweepRef.current) {
        maxSweepRef.current = diff;
        setSweep(diff);
      }
      if (maxSweepRef.current >= 20 && !doneRef.current) {
        doneRef.current = true;
        setTimeout(() => onDone("pass"), 350);
      }
    }
  }

  useEffect(() => {
    const AnyOrient = window.DeviceOrientationEvent as any;
    if (AnyOrient && typeof AnyOrient.requestPermission === "function") {
      setNeedPerm(true);
    } else {
      window.addEventListener("deviceorientationabsolute" as any, onOrient, { passive: true });
      window.addEventListener("deviceorientation", onOrient, { passive: true });
      return () => {
        window.removeEventListener("deviceorientationabsolute" as any, onOrient);
        window.removeEventListener("deviceorientation", onOrient);
      };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function grant() {
    try {
      const AnyOrient = window.DeviceOrientationEvent as any;
      const res = await AnyOrient.requestPermission();
      if (res === "granted") {
        window.addEventListener("deviceorientationabsolute" as any, onOrient, { passive: true });
        window.addEventListener("deviceorientation", onOrient, { passive: true });
        setNeedPerm(false);
      }
    } catch {
      /* denied */
    }
  }

  return (
    <GameShell test={test} onDone={onDone} strict={strict}>
      <div className="grid h-full place-items-center p-6 text-center">
        {needPerm ? (
          <button className="btn" onClick={grant}>
            🧭 Enable compass sensor
          </button>
        ) : (
          <div className="flex flex-col items-center">
            <div className="relative grid h-36 w-36 place-items-center rounded-full border-2 border-[var(--border)] bg-[var(--card)]">
              <div
                className="text-5xl transition-transform duration-100"
                style={{
                  transform: `rotate(${heading !== null ? -heading : 0}deg)`,
                }}
              >
                🧭
              </div>
            </div>
            <p className="mt-4 text-xl font-extrabold tabular-nums">
              {heading !== null ? `${heading}° ${cardinal(heading)}` : "Waiting for compass…"}
            </p>
            <p className="mt-1 text-sm text-[var(--muted)]">
              {heading !== null
                ? `Rotate the phone slightly (${Math.min(20, sweep)}° / 20°)`
                : "Rotate the phone flat in your hand"}
            </p>
            {heading !== null && (
              <button
                className="btn btn-good mt-4"
                onClick={() => onDone("pass")}
              >
                ✓ Compass works
              </button>
            )}
          </div>
        )}
      </div>
    </GameShell>
  );
}

/* ---------- 5. Microphone: blow out the candles ---------- */
function MicGame({ test, onDone, strict }: GameProps) {
  const [level, setLevel] = useState(0);
  const [lit, setLit] = useState([true, true, true]);
  const [err, setErr] = useState("");
  const litRef = useRef(lit);
  litRef.current = lit;

  useEffect(() => {
    let ctx: AudioContext | null = null;
    let raf = 0;
    let stream: MediaStream | null = null;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        ctx = new AudioContext();
        const src = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        src.connect(analyser);
        const data = new Uint8Array(analyser.frequencyBinCount);
        const loop = () => {
          analyser.getByteTimeDomainData(data);
          let sum = 0;
          for (const v of data) sum += (v - 128) * (v - 128);
          const rms = Math.sqrt(sum / data.length) / 128;
          setLevel(rms);
          if (rms > 0.18) {
            const cur = litRef.current;
            const idx = cur.findIndex(Boolean);
            if (idx >= 0) {
              const next = [...cur];
              next[idx] = false;
              setLit(next);
            }
          }
          raf = requestAnimationFrame(loop);
        };
        raf = requestAnimationFrame(loop);
      } catch (e) {
        setErr(e instanceof Error ? e.message : "mic blocked");
      }
    })();
    return () => {
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
      ctx?.close();
    };
  }, []);

  useEffect(() => {
    if (lit.every((l) => !l)) {
      const t = setTimeout(() => onDone("pass"), 400);
      return () => clearTimeout(t);
    }
  }, [lit, onDone]);

  return (
    <GameShell test={test} onDone={onDone} strict={strict}>
      <div className="grid h-full place-items-center">
        {err ? (
          <p className="px-6 text-center text-[var(--bad)]">
            Mic access failed: {err}
          </p>
        ) : (
          <div className="text-center">
            <div className="flex gap-4 text-6xl">
              {lit.map((l, i) => (
                <span key={i} style={{ opacity: l ? 1 : 0.25 }}>
                  {l ? "🕯️" : "💨"}
                </span>
              ))}
            </div>
            <p className="mt-6 font-bold">Blow into the mic to snuff them out</p>
            <div className="mx-auto mt-3 h-2 w-48 overflow-hidden rounded-full bg-[var(--card-2)]">
              <div
                className="h-full"
                style={{
                  width: `${Math.min(100, level * 300)}%`,
                  background: "var(--grad)",
                }}
              />
            </div>
          </div>
        )}
      </div>
    </GameShell>
  );
}

/* ---------- 6. Speaker: acoustic loopback (objective — see lib/speakerTest.ts) ---------- */
function SpeakerGame({ test, onDone, strict }: GameProps) {
  const [phase, setPhase] = useState<"idle" | "testing" | "asking">("idle");
  const acRef = useRef<AudioContext | null>(null);
  const toneRef = useRef<{ stop: () => void } | null>(null);

  useEffect(() => {
    return () => {
      toneRef.current?.stop();
      acRef.current?.close().catch(() => {});
    };
  }, []);

  async function run() {
    setPhase("testing");
    const result = await runSpeakerLoopback();
    if (result.speaker === "pass") {
      onDone("pass");
      result.ac?.close().catch(() => {});
      return;
    }
    if (!result.ac) {
      onDone("fail");
      return;
    }
    acRef.current = result.ac;
    toneRef.current = pulseTone(result.ac);
    setPhase("asking");
  }

  function answer(heard: boolean) {
    toneRef.current?.stop();
    acRef.current?.close().catch(() => {});
    onDone(heard ? "pass" : "fail");
  }

  return (
    <GameShell test={test} onDone={onDone} strict={strict} hideFail={phase === "asking"}>
      <div className="grid h-full place-items-center p-6 text-center">
        {phase === "idle" && (
          <button className="btn" onClick={run}>
            🔊 Test the speaker
          </button>
        )}
        {phase === "testing" && (
          <div>
            <div className="floaty text-4xl">🔊</div>
            <p className="mt-3 font-bold">Listening for the speaker…</p>
            <p className="mt-1 text-sm text-[var(--muted)]">
              Playing a tone and checking the mic for it
            </p>
          </div>
        )}
        {phase === "asking" && (
          <div>
            <div className="floaty text-4xl">🔊</div>
            <p className="mb-1 font-bold">Couldn&apos;t confirm it automatically</p>
            <p className="mb-4 text-sm text-[var(--muted)]">Do you hear a beeping tone right now?</p>
            <div className="flex justify-center gap-3">
              <button className="btn" onClick={() => answer(true)}>
                ✅ Yes, I hear it
              </button>
              <button className="btn btn-ghost" onClick={() => answer(false)}>
                ❌ No
              </button>
            </div>
          </div>
        )}
      </div>
    </GameShell>
  );
}

/* ---------- 7. Cameras: model-aware, per-lens focus test ---------- */
function sharpness(v: HTMLVideoElement): number {
  const vw = v.videoWidth,
    vh = v.videoHeight;
  if (!vw || !vh) return 0;
  const S = 128;
  const sh = Math.round((S * vh) / vw);
  const c = document.createElement("canvas");
  c.width = S;
  c.height = sh;
  const ctx = c.getContext("2d", { willReadFrequently: true }) as
    | CanvasRenderingContext2D
    | null;
  if (!ctx) return 0;
  const cw = vw * 0.6,
    ch = vh * 0.6;
  ctx.drawImage(v, (vw - cw) / 2, (vh - ch) / 2, cw, ch, 0, 0, S, sh);
  const { data } = ctx.getImageData(0, 0, S, sh);
  const g = new Float32Array(S * sh);
  for (let i = 0, j = 0; j < g.length; i += 4, j++)
    g[j] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  let lSum = 0,
    lSum2 = 0,
    m = 0;
  for (let y = 1; y < sh - 1; y++)
    for (let x = 1; x < S - 1; x++) {
      const i = y * S + x;
      const lap = 4 * g[i] - g[i - 1] - g[i + 1] - g[i - S] - g[i + S];
      lSum += lap;
      lSum2 += lap * lap;
      m++;
    }
  return m ? lSum2 / m - (lSum / m) ** 2 : 0;
}

const FOCUS_SHARP = 50; // above → in focus
const BLUR_SHARP = 22; // below → out of focus (non-focus baseline)

function CameraGame({ test, onDone, model = "" }: GameProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const lenses = useMemo(() => lensesFor(model), [model]);
  const [idx, setIdx] = useState(0);
  const [status, setStatus] = useState<Record<string, "pending" | "pass">>({});
  const [rearIds, setRearIds] = useState<string[]>([]);
  const [err, setErr] = useState("");
  const [sharp, setSharp] = useState(0);
  const [sawBlur, setSawBlur] = useState(false);
  const sharpStreakRef = useRef(0);
  const advancingRef = useRef(false);
  const lens = lenses[idx];
  const done = idx >= lenses.length;

  // Acquire the stream for the active lens. Prefer a distinct rear deviceId per
  // rear lens when the platform exposes them; else fall back to facingMode.
  useEffect(() => {
    if (done || !lens) return;
    let cancelled = false;
    let stream: MediaStream | null = null;
    setSawBlur(false);
    setSharp(0);
    setErr("");
    sharpStreakRef.current = 0;
    advancingRef.current = false;
    (async () => {
      try {
        const rearSeq = lenses.filter((l) => l.facing === "rear");
        const rearPos = rearSeq.findIndex((l) => l.id === lens.id);
        const tries: MediaStreamConstraints[] = [];
        if (lens.facing === "rear" && rearIds[rearPos])
          tries.push({ video: { deviceId: { exact: rearIds[rearPos] } } });
        tries.push({
          video: {
            facingMode:
              lens.facing === "front" ? "user" : { ideal: "environment" },
          },
        });
        tries.push({ video: true });
        let s: MediaStream | null = null;
        for (const c of tries) {
          try {
            s = await navigator.mediaDevices.getUserMedia(c);
            break;
          } catch {
            /* try next */
          }
        }
        if (!s) throw new Error("no camera available");
        if (cancelled) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        stream = s;
        // Re-enumerate AFTER getUserMedia permission is granted so rearIds has
        // populated deviceIds and labels.
        if (rearIds.length === 0) {
          navigator.mediaDevices
            ?.enumerateDevices?.()
            .then((d) => {
              const rears = d.filter(
                (x) => x.kind === "videoinput" && !/front|user|face|selfie/i.test(x.label)
              );
              const ids = rears.map((x) => x.deviceId).filter(Boolean);
              if (ids.length > 0) setRearIds(ids);
            })
            .catch(() => {});
        }
        if (videoRef.current) {
          videoRef.current.srcObject = s;
          videoRef.current.setAttribute("playsinline", "true");
          await videoRef.current.play().catch(() => {});
        }
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : "camera blocked");
      }
    })();
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx, done, lens, lenses]);

  function passCurrentLens() {
    if (!lens || advancingRef.current) return;
    advancingRef.current = true;
    setStatus((m) => ({ ...m, [lens.id]: "pass" }));
    setTimeout(() => setIdx((i) => i + 1), 500);
  }

  // Focus loop: watch sharpness. A lens passes once we've seen it BOTH blurry
  // and sharp (autofocus demonstrably works) or sustained sharp frames.
  useEffect(() => {
    if (done || err) return;
    const t = setInterval(() => {
      const v = videoRef.current;
      if (!v || v.readyState < 2 || advancingRef.current) return;
      const s = sharpness(v);
      setSharp(s);
      if (s < BLUR_SHARP) setSawBlur(true);
      sharpStreakRef.current = s > FOCUS_SHARP ? sharpStreakRef.current + 1 : 0;
      const proven = sawBlur || sharpStreakRef.current >= 12;
      if (s > FOCUS_SHARP && proven && lens && status[lens.id] !== "pass") {
        passCurrentLens();
      }
    }, 160);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done, err, sawBlur, lens, status]);

  if (done) {
    return (
      <GameShell test={test} onDone={onDone} hideFail>
        <div className="grid h-full place-items-center p-6 text-center">
          <div>
            <div className="text-5xl">📸</div>
            <p className="mt-3 font-bold">All {lenses.length} lenses checked ✓</p>
            <button className="btn mt-5" onClick={() => onDone("pass")}>
              ✓ Cameras pass
            </button>
          </div>
        </div>
      </GameShell>
    );
  }

  const pct = Math.min(100, Math.round((sharp / FOCUS_SHARP) * 100));
  const focused = sharp > FOCUS_SHARP && (sawBlur || sharpStreakRef.current >= 12);

  return (
    <GameShell test={test} onDone={onDone} hideFail>
      <div className="flex h-full flex-col items-center p-4">
        {/* lens checklist */}
        <div className="mb-2 flex flex-wrap justify-center gap-1">
          {lenses.map((l, i) => (
            <span
              key={l.id}
              className="pill"
              style={{
                fontSize: 10,
                borderColor:
                  status[l.id] === "pass"
                    ? "var(--green)"
                    : i === idx
                      ? "var(--brand)"
                      : "var(--border)",
              }}
            >
              {status[l.id] === "pass" ? "✓ " : ""}
              {l.name}
            </span>
          ))}
        </div>
        {err ? (
          <p className="text-[var(--bad)]">Camera failed: {err}</p>
        ) : (
          <video
            ref={videoRef}
            playsInline
            muted
            className="w-full max-w-xs rounded-2xl border-2"
            style={{
              aspectRatio: "3/4",
              objectFit: "cover",
              borderColor: focused ? "var(--green)" : "var(--border)",
            }}
          />
        )}
        <p className="mt-2 text-center text-sm font-semibold">
          {lens?.facing === "front" ? "Front camera" : lens?.name} —{" "}
          {focused ? "focused ✓" : sawBlur ? "let it sharpen…" : "point at something textured"}
        </p>
        {/* focus meter */}
        <div className="mt-1 h-2 w-full max-w-xs overflow-hidden rounded-full bg-[var(--card-2)]">
          <div
            className="h-full transition-all"
            style={{
              width: `${pct}%`,
              background: focused ? "var(--green)" : "var(--grad)",
            }}
          />
        </div>
        <div className="mt-auto flex w-full flex-wrap gap-2 pt-3">
          {!err && (
            <button
              className="btn btn-good flex-1"
              onClick={passCurrentLens}
            >
              ✓ Lens is clear
            </button>
          )}
          <button
            className="btn btn-bad flex-1"
            onClick={() => onDone("fail")}
          >
            ✕ Broken
          </button>
          <button
            className="btn btn-ghost"
            onClick={() => setIdx((i) => i + 1)}
          >
            Skip →
          </button>
        </div>
      </div>
    </GameShell>
  );
}

/* ---------- 7b. Biometrics (Face ID / Touch ID / Fingerprint) ---------- */
function BiometricGame({ test, onDone, strict }: GameProps) {
  const [state, setState] = useState<"idle" | "running" | "error">("idle");
  const [errMsg, setErrMsg] = useState("");

  async function verifyBiometric() {
    setState("running");
    setErrMsg("");
    try {
      const challenge = crypto.getRandomValues(new Uint8Array(32));
      const userId = crypto.getRandomValues(new Uint8Array(16));
      const cred = await navigator.credentials.create({
        publicKey: {
          challenge,
          rp: { name: "GradeIQ", id: window.location.hostname },
          user: {
            id: userId,
            name: "gradeiq-biometric-check",
            displayName: "GradeIQ Biometric Check",
          },
          pubKeyCredParams: [
            { type: "public-key", alg: -7 },
            { type: "public-key", alg: -257 },
          ],
          authenticatorSelection: {
            authenticatorAttachment: "platform",
            userVerification: "required",
          },
          timeout: 60000,
          attestation: "none",
        },
      } as any);
      if (cred) {
        onDone("pass");
        return;
      }
      setState("error");
      setErrMsg("Biometric prompt did not return a credential.");
    } catch {
      setState("error");
      setErrMsg(
        "Biometric prompt was cancelled or unavailable in this browser view — confirm manually below."
      );
    }
  }

  return (
    <GameShell test={test} onDone={onDone} strict={strict}>
      <div className="grid h-full place-items-center p-6 text-center">
        <div className="max-w-xs">
          <p className="mb-4 text-sm text-[var(--muted)]">
            Trigger the phone&apos;s platform authenticator (Face ID, Touch ID, or fingerprint) to verify the biometric sensor.
          </p>
          <button
            className="btn w-full"
            disabled={state === "running"}
            onClick={verifyBiometric}
          >
            {state === "running"
              ? "Waiting for biometric…"
              : state === "error"
                ? "Try biometric prompt again"
                : "🙂 Scan Face ID / Fingerprint"}
          </button>
          {errMsg && (
            <p className="mt-3 text-xs text-[var(--warn)]">{errMsg}</p>
          )}
          <div className="mt-4 flex gap-2">
            <button
              className="btn btn-good flex-1"
              onClick={() => onDone("pass")}
            >
              ✓ Works manually
            </button>
          </div>
        </div>
      </div>
    </GameShell>
  );
}

/* ---------- 8. Vibration ---------- */
function VibrationGame({ test, onDone }: GameProps) {
  const supported =
    typeof navigator !== "undefined" && typeof navigator.vibrate === "function";
  const [buzzed, setBuzzed] = useState(!supported);

  function buzz() {
    try {
      navigator.vibrate?.([200, 100, 200, 100, 400]);
    } catch {
      /* ignore */
    }
    setBuzzed(true);
  }

  return (
    <GameShell test={test} onDone={onDone} hideFail>
      <div className="grid h-full place-items-center p-6 text-center">
        <div>
          {!supported && (
            <p className="mb-3 text-sm text-[var(--warn)]">
              No Web Vibration API in this browser (normal on iPhone Safari) — toggle silent/ring switch or confirm haptics manually.
            </p>
          )}
          {supported && (
            <button className="btn" onClick={buzz}>
              📳 {buzzed ? "Buzz again" : "Buzz now"}
            </button>
          )}
          {buzzed && (
            <div className="mt-6 flex justify-center gap-2">
              <button className="btn btn-good" onClick={() => onDone("pass")}>
                ✓ Felt it
              </button>
              <button className="btn btn-bad" onClick={() => onDone("fail")}>
                ✕ Nothing
              </button>
            </div>
          )}
        </div>
      </div>
    </GameShell>
  );
}

/* ---------- 9. Hardware buttons (auto-detect + manual confirm) ---------- */
function ButtonsGame({ test, onDone }: GameProps) {
  const items = ["Power", "Volume +", "Volume −", "Mute / Action"];
  const [ok, setOk] = useState<boolean[]>(items.map(() => false));
  const [lastDetected, setLastDetected] = useState<string>("");

  useEffect(() => {
    const markIndex = (idx: number, label: string) => {
      setLastDetected(label);
      setOk((prev) => prev.map((v, j) => (j === idx ? true : v)));
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "AudioVolumeUp" || e.key === "VolumeUp" || e.code === "VolumeUp") {
        markIndex(1, "Volume + key event");
      } else if (
        e.key === "AudioVolumeDown" ||
        e.key === "VolumeDown" ||
        e.code === "VolumeDown"
      ) {
        markIndex(2, "Volume − key event");
      } else if (e.key === "AudioVolumeMute" || e.key === "VolumeMute") {
        markIndex(3, "Mute / Action event");
      } else if (e.key === "Power") {
        markIndex(0, "Power button event");
      }
    };
    const onVis = () => {
      if (document.visibilityState === "hidden") {
        markIndex(0, "Power / screen lock detected");
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKey);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKey);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  const allChecked = ok.every(Boolean);
  return (
    <GameShell test={test} onDone={onDone} hideFail>
      <div className="flex h-full flex-col p-5">
        <p className="mb-3 text-center text-sm text-[var(--muted)]">
          Press each physical button — or tap its row below once you confirm it clicks and responds.
        </p>
        {lastDetected && (
          <p className="mb-2 text-center text-xs font-semibold text-[var(--good)]">
            Detected: {lastDetected} ✓
          </p>
        )}
        <div className="flex flex-col gap-2">
          {items.map((it, i) => (
            <button
              key={it}
              className={`card flex items-center justify-between p-4 ${
                ok[i] ? "!border-[var(--good)]" : ""
              }`}
              onClick={() =>
                setOk((prev) => prev.map((v, j) => (j === i ? !v : v)))
              }
            >
              <span className="font-semibold">{it}</span>
              <span>{ok[i] ? "✓" : "○"}</span>
            </button>
          ))}
        </div>
        <div className="mt-auto flex gap-2 pt-4">
          <button className="btn btn-bad flex-1" onClick={() => onDone("fail")}>
            ✕ A button is dead
          </button>
          <button
            className="btn btn-good flex-1"
            disabled={!allChecked}
            onClick={() => onDone("pass")}
          >
            {allChecked ? "✓ All good" : "Check each"}
          </button>
        </div>
      </div>
    </GameShell>
  );
}

export const GAMES: Record<string, (p: GameProps) => React.ReactNode> = {
  touch: TouchGame,
  multitouch: MultiTouchGame,
  display: DisplayGame,
  motion: MotionGame,
  compass: CompassGame,
  mic: MicGame,
  voice: MicGame,
  speaker: SpeakerGame,
  camera: CameraGame,
  faceid: BiometricGame,
  vibration: VibrationGame,
  buttons: ButtonsGame,
};
