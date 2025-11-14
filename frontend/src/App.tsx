import { useEffect, useRef, useState } from "react";
import { health } from "./lib/api";
import Accordion from "./components/Accordion";
import InfoTip from "./components/InfoTip";
import { RMSTrend, PSD, RMSChip } from "./components/SignalCards";
import mascot from "./assets/mascot.png";
import bionic_logo from "./assets/bionic_logo.png"
import { useSerialNRF } from "./hooks/useSerialNRF";
import { MultiSender } from "./lib/aggregator";
import { train as apiTrain, predict as apiPredict } from "./lib/apiTrain";

/* === BrainFlow bits === */
import { BrainflowPanel } from "./components/BrainflowPanel";
import { ChannelToggles } from "./components/ChannelToggles";
import { useBrainflowSeries } from "./hooks/useBrainflowSeries";
import { useBrainflowMulti } from "./hooks/useBrainflowMulti";
import { MultiEmgPanel } from "./components/MultiEmgPanel";

/* === BLE === */
import { scanBle, connectBleOne, disconnectBle } from "./lib/apiBle";
import { useBleFeed } from "./hooks/useBleFeed";

/* === HandViewer === */
import HandViewer from "./components/HandViewer";

/* ========================= Realtime synthetic EMG ========================= */
const FS = 250;
const BUFFER = 2000;

type Step = "idle" | "rest" | "open" | "close" | "pinch" | "wave" | "done";

// gaussian noise (Box–Muller)
function randn() {
  const u = 1 - Math.random();
  const v = 1 - Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/* ---------- Normalize live ints to [-1,1] for the chart ---------- */
function normalizeForChart(arr: number[], win = 512, alpha = 0.2) {
  if (!arr || arr.length === 0) return arr;
  const start = Math.max(0, arr.length - win);
  const view = arr.slice(start);
  const maxAbs = Math.max(1, ...view.map((v) => Math.abs(v)));
  const any = normalizeForChart as any;
  const prev = any._g ?? maxAbs;
  const gain = alpha * maxAbs + (1 - alpha) * prev;
  any._g = gain;
  const scale = gain > 0 ? 1 / gain : 1;
  return arr.map((v) => Math.max(-1, Math.min(1, v * scale)));
}

/* ---------- BLE helper: convert samples to chart series ---------- */
type BleSample = { t: number; name: string; addr: string; ch0: number; ch1: number };
function bleToSeries(samples: BleSample[]): Array<Array<[number, number]>> {
  const byKey = new Map<string, Array<[number, number]>>();
  for (const s of samples) {
    const k0 = `${s.name || s.addr}:CH0`;
    const k1 = `${s.name || s.addr}:CH1`;
    if (!byKey.has(k0)) byKey.set(k0, []);
    if (!byKey.has(k1)) byKey.set(k1, []);
    byKey.get(k0)!.push([s.t, s.ch0]);
    byKey.get(k1)!.push([s.t, s.ch1]);
  }
  return Array.from(byKey.values());
}
// Convert multi-channel Y-only series into [t, y] pairs for plotting.
// Time goes from -window..0 using the current array length and fs.
function seriesToXY(chans: number[][], fs: number): [number, number][][] {
  const dt = 1 / Math.max(1, fs);
  return chans.map((arr) => {
    const n = arr.length;
    // map last sample to ~0s, older samples negative time
    return arr.map((y, i) => [ (i - n) * dt, y ] as [number, number ]);
  });
}

/* ---------- Pretty dropdown helper ---------- */
function NodeSelect({
  value,
  options,
  onChange,
}: {
  value: number | null;
  options: number[];
  onChange: (v: number | null) => void;
}) {
  if (options.length <= 1) return null;
  return (
    <label className="badge" style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
      Node:
      <select
        className="select"
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
      >
        <option value="">Select…</option>
        {options.map((id) => (
          <option key={id} value={id}>
            {id}
          </option>
        ))}
      </select>
    </label>
  );
}

/* ========================= Live waveform canvas ========================= */
function LineCanvas({ data, fs = FS }: { data: number[]; fs?: number }) {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;

    const w = c.width,
      h = c.height;
    const padL = 44,
      padR = 14,
      padT = 14,
      padB = 38;
    const innerW = w - padL - padR;
    const innerH = h - padT - padB;

    // background
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#0f141b";
    ctx.fillRect(0, 0, w, h);

    // grid
    ctx.strokeStyle = "#243648";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 1; i < 5; i++) {
      const y = padT + (innerH / 5) * i;
      ctx.moveTo(padL, y);
      ctx.lineTo(w - padR, y);
    }
    for (let j = 1; j < 10; j++) {
      const x = padL + (innerW / 10) * j;
      ctx.moveTo(x, padT);
      ctx.lineTo(x, h - padB);
    }
    ctx.stroke();

    // waveform
    const step = innerW / Math.max(data.length - 1, 1);
    ctx.beginPath();
    ctx.lineWidth = 2.4;
    ctx.strokeStyle = "#00d8ff";
    for (let i = 0; i < data.length; i++) {
      const x = padL + i * step;
      const y = padT + innerH / 2 - data[i] * (innerH / 2 - 2);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();

    // x ticks
    const seconds = data.length / fs;
    ctx.fillStyle = "#7edfe0";
    ctx.font = "12px Inter, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    const ticks = Math.max(2, Math.min(8, Math.round(seconds / 0.25)));
    for (let t = 0; t <= ticks; t++) {
      const frac = t / ticks;
      const x = padL + frac * innerW;
      ctx.fillText((seconds * frac).toFixed(2), x, h - padB + 14);
    }

    // axis titles
    ctx.fillText("Time (s)", padL + innerW / 2, h - 8);
    ctx.save();
    ctx.translate(16, padT + innerH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = "center";
    ctx.fillText("Amplitude (rel)", 0, 0);
    ctx.restore();

    // border
    ctx.strokeStyle = "#1a2532";
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, w - 1, h - 1);
  }, [data, fs]);

  return (
    <canvas ref={ref} width={980} height={280} style={{ borderRadius: 14, display: "block", width: "100%" }} />
  );
}

/* ========================= Main App ========================= */
export default function App() {
  const [status, setStatus] = useState("checking…");
  const [data, setData] = useState<number[]>([]);
  const [step, setStep] = useState<Step>("idle");

  // ---- Loader state ----
  const [loading, setLoading] = useState(true);
  const [fadeOut, setFadeOut] = useState(false);
  useEffect(() => {
    const fadeTimer = setTimeout(() => setFadeOut(true), 7000);
    const endTimer = setTimeout(() => setLoading(false), 8000);
    return () => {
      clearTimeout(fadeTimer);
      clearTimeout(endTimer);
    };
  }, []);

  // ---- Backend health polling ----
  useEffect(() => {
    let stop = false;
    async function ping() {
      try {
        const h = await health();
        if (!stop) setStatus(h.status);
      } catch {
        if (!stop) setStatus("error");
      }
    }
    ping();
    const id = setInterval(ping, 3000);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, []);

  // ==================== nRF aggregator hookup ====================
  const ms = useRef(new MultiSender(4096, true, false)).current;
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 250);
    return () => clearInterval(id);
  }, []);

  const [deviceConnected, setDeviceConnected] = useState(false);
  const [lastSampleAt, setLastSampleAt] = useState<number>(0);
  const [samplesPerSecond, setSamplesPerSecond] = useState(0);

  // Accept both old (number[]) and new (Parsed) shapes
  const { connect } = useSerialNRF((incoming: any) => {
    const rec = Array.isArray(incoming)
      ? ({ kind: "simple", nodeId: 1, samples: incoming } as any)
      : incoming;

    ms.push(rec as any);
    setDeviceConnected(true);
    setLastSampleAt(performance.now());
  });

  const nodes = Array.from(ms.snapshot().keys()).sort((a, b) => a - b);
  const [selectedNodeId, setSelectedNodeId] = useState<number | null>(null);
  const activeId = selectedNodeId ?? nodes[0] ?? null;
  const sel = activeId != null ? ms.snapshot().get(activeId) : undefined;
  const devCh0 = sel?.ch0 ?? [];

  useEffect(() => {
    if (!sel) return;
    setSamplesPerSecond(Math.round(sel.hz));
  }, [sel?.hz]);

  // ==================== BLE additions ====================
  const [bleList, setBleList] = useState<{ addr: string; name: string }[]>([]);
  const [bleFocus, setBleFocus] = useState<string | null>(null);
  const [bleEnabled, setBleEnabled] = useState(true); // gate to avoid WS races

  // Use only one feed at a time
  const wantSingle = false;
  const { data: bleSingleData } = useBleFeed(bleFocus ?? undefined, 10, bleEnabled && wantSingle);
  const { data: bleMultiData } = useBleFeed(undefined, 10, bleEnabled && !wantSingle);
  const bleSamples = wantSingle ? bleSingleData : bleMultiData;

  // Convert samples to chart series
  const bleSeries = bleToSeries(bleSamples);
  const firstBleCh = bleSeries[0]?.map(([, v]) => v) ?? [];

  // Show BLE frame rate
  const bleFps = (() => {
    if (!bleSamples.length) return 0;
    const t0 = bleSamples[0].t,
      t1 = bleSamples[bleSamples.length - 1].t;
    const secs = Math.max(0.25, t1 - t0);
    return Math.round(bleSamples.length / secs);
  })();

  // ==================== Synthetic generator (off when device connected or BLE active) ====================
  useEffect(() => {
    // if BLE is active or Serial is connected, skip synthetic
    if (firstBleCh.length || deviceConnected) return;
    let phase = 0,
      env = 0.2,
      last = performance.now(),
      raf: number;

    const tick = () => {
      const now = performance.now();
      const dt = (now - last) / 1000;
      last = now;

      const nsamp = Math.max(1, Math.round(FS * dt));
      const baseHz = 25;
      const out = new Array<number>(nsamp);
      for (let i = 0; i < nsamp; i++) {
        phase += 2 * Math.PI * (baseHz / FS);
        const s = Math.sin(phase) + 0.15 * randn();
        out[i] = Math.max(-1, Math.min(1, env * s));
      }

      setData((prev) => {
        const merged = prev.length ? [...prev, ...out] : out;
        return merged.length > BUFFER ? merged.slice(merged.length - BUFFER) : merged;
      });

      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [deviceConnected, firstBleCh.length]);

  // ---------- Guided calibration ----------
  const [guideIdx, setGuideIdx] = useState(0);
  const guideOrder: Step[] = ["open", "close", "rest", "done"];
  function startCalibration() {
    setGuideIdx(0);
    setStep("open");
  }
  function nextCalibration() {
    setGuideIdx((i) => Math.min(i + 1, guideOrder.length - 1));
    setStep(guideOrder[Math.min(guideIdx + 1, guideOrder.length - 1)]);
  }
  function resetCalibration() {
    setGuideIdx(0);
    setStep("idle");
  }

  // BrainFlow single-series feed for the main chart
  const { series: bfSeries, visible: bfVisible, setVisible: setBfVisible } = useBrainflowSeries(2500);
  const brainflowActive = bfSeries.length > 0;
  const firstVisibleIdx = brainflowActive ? (bfVisible.findIndex((v) => v) >= 0 ? bfVisible.findIndex((v) => v) : 0) : -1;
  const bfCh = brainflowActive && firstVisibleIdx >= 0 ? bfSeries[firstVisibleIdx] : null;

  // BrainFlow multi-panel
  // new
  const { series: bfMulti, fs: bfFs } = useBrainflowMulti(8, 250);
  const bfXY = seriesToXY(bfMulti, bfFs);


  // Which buffer feeds the UI — Priority: BLE -> Serial -> BrainFlow -> SIM
  const displayData = firstBleCh.length
    ? normalizeForChart(firstBleCh)
    : deviceConnected
    ? normalizeForChart(devCh0)
    : bfCh
    ? normalizeForChart(bfCh)
    : data;

  // ====== Training UI state ======
  const [files, setFiles] = useState<File[]>([]);
  const [cfg, setCfg] = useState({
    fs: 250,
    win_ms: 200,
    hop_ms: 100,
    channel: "auto" as "auto" | "ch0" | "ch1" | "median",
  });

  // Pair rates (only used when exactly 2 files are picked)
  const [pairRates, setPairRates] = useState({ exg_fs: 250, prompt_fs: 0.2 });

  const [training, setTraining] = useState(false);
  const [trainMsg, setTrainMsg] = useState<string | null>(null);
  const [predictMsg, setPredictMsg] = useState<string | null>(null);

  async function handleTrain() {
    try {
      setTraining(true);
      setTrainMsg("Uploading and training…");
      const json = await apiTrain(files, {
        ...cfg,
        exg_fs: files.length === 2 ? pairRates.exg_fs : undefined,
        prompt_fs: files.length === 2 ? pairRates.prompt_fs : undefined,
      });
      setTrainMsg(JSON.stringify(json, null, 2));
    } catch (e: any) {
      setTrainMsg("Training failed: " + String(e?.message ?? e));
    } finally {
      setTraining(false);
    }
  }

  async function handlePredictFromLive() {
    const N = Math.max(1, Math.min(50, displayData.length));
    const last = displayData.slice(displayData.length - N);
    try {
      const res = await apiPredict(last);
      setPredictMsg(res?.label ? `Predicted: ${res.label}` : JSON.stringify(res));
    } catch (e: any) {
      setPredictMsg("Predict failed: " + String(e?.message ?? e));
    }
  }

  if (loading) {
    return (
      <div className="loading-overlay" style={{ opacity: fadeOut ? 0 : 1, transition: "opacity 1s ease" }}>
        <div className="loading-card">
          <img className="loading-mascot" src={mascot} alt="Mascot" />
          <div className="loading-title">Activating muscle interface…</div>
          <div className="loading-sub">“Touch the future and reach out”</div>
        </div>
      </div>
    );
  }

  return (
    <>
      <header className="app-header">
        <img src={bionic_logo} alt="Bionic logo" />
        <div>
          <div className="app-title">BIONIC INTERFACE • Local Demo</div>
          <div className="app-subtitle">EMG Visualizer & Calibration</div>
        </div>
      </header>

      <main className="container">
        {/* Status / controls row */}
        <div className="status">
          <div className="badge">
            <span className={`dot ${status === "ok" ? "ok" : ""}`} />
            Backend: <b>{status}</b>
          </div>
          <div className="badge">Mode: <b>{step}</b></div>

          {/* BLE control capsule */}
          <div className="badge" style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
            <button className="button" onClick={async () => setBleList(await scanBle())}>Scan BLE</button>
            <select
              className="select"
              value={bleFocus ?? ""}
              onChange={(e) => setBleFocus(e.target.value || null)}
              title="Pick a node name or address"
            >
              <option value="">(no focus)</option>
              {bleList.map((d) => {
                const label = d.name ? `${d.name} — ${d.addr}` : d.addr;
                return (
                  <option key={d.addr} value={d.name || d.addr}>
                    {label}
                  </option>
                );
              })}
            </select>
            <button
              className="button primary"
              disabled={!bleFocus}
              onClick={async () => {
                if (!bleFocus) return;
                // Pause feeds during focus switch to avoid double-WS race
                setBleEnabled(false);
                try {
                  await connectBleOne(bleFocus); // GET /ble/connect/{name}
                } finally {
                  setTimeout(() => setBleEnabled(true), 150);
                }
              }}
            >
              Connect BLE
            </button>
            <button className="button" onClick={disconnectBle}>Disconnect</button>
            <div className="badge">BLE frames: <b>{bleFps}/s</b></div>
          </div>

          {/* Group: Source + connect button */}
          <div className="badge" style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
            <span>
              Source:{" "}
              <b>
                {firstBleCh.length ? "BLE" : deviceConnected ? "nRF" : brainflowActive ? "BrainFlow" : "SIM"}
              </b>
            </span>
            <button className="button primary" onClick={() => connect()}>
              {deviceConnected ? "nRF Connected" : "Connect nRF (Serial)"}
            </button>
          </div>

          {/* nRF runtime info */}
          {deviceConnected && (
            <>
              <div className="badge">
                {samplesPerSecond} sps • {performance.now() - lastSampleAt < 1000 ? "live" : "idle"}
              </div>
              <NodeSelect value={activeId} options={nodes} onChange={setSelectedNodeId} />
            </>
          )}

          {/* BrainFlow control + toggles */}
          <div className="badge brainflow-capsule">
            <BrainflowPanel />
          </div>
          {brainflowActive && (
            <div className="badge" style={{ display: "block" }}>
              <ChannelToggles visible={bfVisible} setVisible={setBfVisible} />
            </div>
          )}

          <RMSChip data={displayData} />

          {/* Manual controls */}
          <button className="button" onClick={() => setStep("pinch")}>Pinch</button>
          <button className="button" onClick={() => setStep("wave")}>Wave</button>
          <button className="button" onClick={() => setStep("rest")}>Rest</button>
          <button className="button" onClick={() => setStep("open")}>Open</button>
          <button className="button" onClick={() => setStep("close")}>Close</button>

          <button className="button" onClick={startCalibration}>Start Calibration</button>
          <button className="button" onClick={nextCalibration}>Next</button>
          <button className="button" onClick={resetCalibration}>Reset</button>

          <button className="button" onClick={() => setData([])}>Clear Buffer</button>
        </div>

{/* USER VIEW */}
<Accordion title="User View (Simple): Copy the gestures on the left; the cyan line should rise during contraction and settle at rest." defaultOpen>
  <div className="card" style={{ padding: 16 }}>
    {/* Row: video on left, live signal on right */}
    <div
      style={{
        display: "flex",
        gap: 24,
        alignItems: "stretch",  // 👈 make heights more even
        flexWrap: "wrap",
      }}
    >
      {/* LEFT: Gesture instructions video */}
      <div
        className="graph-card"
        style={{
          width: 280,
          flexShrink: 0,
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div className="graph-title">
          Gesture Instructions
          <InfoTip text="These are the hand poses the user should perform while EMG is recorded." />
        </div>
        <video
          src="/HandInstructions.mp4"
          controls
          loop
          muted
          autoPlay
          playsInline
          style={{
            width: "100%",
            borderRadius: 12,
            marginTop: 8,
            display: "block",
          }}
        />
        {/* no extra text here so it stays clean */}
      </div>

      {/* RIGHT: Live signal graph */}
      <div className="graph-card" style={{ flex: 1, minWidth: 0 }}>
        <div className="graph-title">
          Signal Activity (Live)
          <InfoTip text="Real-time EMG-like amplitude. Peaks appear during contractions." />
        </div>
        <div className="graph-sub">
          Time (s) vs Amplitude (rel). Sampling ~250 Hz.
        </div>
        <LineCanvas data={displayData} fs={FS} />
      </div>
    </div>

    <p
  style={{
    color: "var(--text-dim)",
    marginTop: 16,
    fontStyle: "italic",
    fontSize: "0.9rem",
    letterSpacing: "0.03em",
    textAlign: "center",
    textShadow: "0 0 6px rgba(0, 255, 255, 0.35)",  // tiny soft glow

  }}
>
      Your hand is here for the demo, but the learning it leaves behind is meant for someone who doesn’t have this motion yet
    </p>
  </div>
</Accordion>


<div style={{ marginTop: 16 }}>
  {/* Show BLE multi if available; otherwise BrainFlow multi */}
  <MultiEmgPanel
    series={bleSeries.length ? (bleSeries as [number, number][][]) : bfXY}
    height={240}
  />
</div>

{/* 3D Hand Viewer */}
<section style={{ marginTop: 16 }}>
  <HandViewer />
</section>

        {/* MODEL TRAINING PANEL */}
        <Accordion title="Model Training & Prediction" defaultOpen>
          <div className="card" style={{ padding: 16, display: "grid", gap: 12 }}>
            <p className="muted">
              Upload EMG CSVs. If you select <b>exactly two</b> files (EXG + PROMPT), you’ll see the pair rates below.
            </p>

            <div className="row">
              <label className="pill">
                <span>Dataset CSV(s)</span>
                <input type="file" multiple accept=".csv" onChange={(e) => setFiles(Array.from(e.target.files || []))} />
              </label>

              <label className="pill">
                <span>fs</span>
                <input
                  className="input"
                  type="number"
                  value={cfg.fs}
                  onChange={(e) => setCfg({ ...cfg, fs: Number(e.target.value) })}
                />
              </label>

              <label className="pill">
                <span>win_ms</span>
                <input
                  className="input"
                  type="number"
                  value={cfg.win_ms}
                  onChange={(e) => setCfg({ ...cfg, win_ms: Number(e.target.value) })}
                />
              </label>

              <label className="pill">
                <span>hop_ms</span>
                <input
                  className="input"
                  type="number"
                  value={cfg.hop_ms}
                  onChange={(e) => setCfg({ ...cfg, hop_ms: Number(e.target.value) })}
                />
              </label>
            </div>

            {/* Only show pair rates if exactly two files are selected */}
            {files.length === 2 && (
              <div className="row">
                <label className="pill">
                  <span>exg_fs</span>
                  <input
                    className="input"
                    type="number"
                    step="0.01"
                    value={pairRates.exg_fs}
                    onChange={(e) => setPairRates({ ...pairRates, exg_fs: Number(e.target.value) })}
                  />
                </label>

                <label className="pill">
                  <span>prompt_fs</span>
                  <input
                    className="input"
                    type="number"
                    step="0.01"
                    value={pairRates.prompt_fs}
                    onChange={(e) => setPairRates({ ...pairRates, prompt_fs: Number(e.target.value) })}
                  />
                </label>

                <span className="muted">
                  Tip: use <b>250</b> and <b>0.2</b> for your compressed-sensing set.
                </span>
              </div>
            )}

            <div className="row">
              <button className="button primary" onClick={handleTrain} disabled={training || files.length === 0}>
                {training ? "Training…" : "Train Model"}
              </button>

              <button className="button" onClick={handlePredictFromLive}>
                Predict from Live Window
              </button>
              <span className="muted">
                Uses last <b>50</b> samples from active source (BLE / nRF / BrainFlow / SIM).
              </span>
            </div>

            {training && (
              <div className="progress">
                <div className="bar" />
              </div>
            )}

            {trainMsg && <pre className="log">{trainMsg}</pre>}
            {predictMsg && <div className="toast">{predictMsg}</div>}
          </div>
        </Accordion>

        {/* ENGINEER VIEW */}
        <Accordion title="Engineer Analytics (Advanced)">
          <div className="card" style={{ padding: 16 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <div className="graph-card">
                <div className="graph-title">
                  RMS Trend (relative units)
                  <InfoTip text="Sliding-window RMS (w=64, hop=16) approximates muscle effort." />
                </div>
                <RMSTrend data={displayData} fs={FS} />
              </div>

              <div className="graph-card">
                <div className="graph-title">
                  Power Spectrum (PSD)
                  <InfoTip text="Frequency content of the current buffer. Useful for spotting noise (e.g., mains hum)." />
                </div>
                <PSD data={displayData} fs={FS} />
              </div>
            </div>
          </div>
        </Accordion>
      </main>
    </>
  );
}
