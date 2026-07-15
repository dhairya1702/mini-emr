import { useEffect, useRef } from "react";

/* ---- graph model (viewBox 480 x 360) ---- */
const CX = 240;
const CY = 180;
const RX1 = 122;
const RY1 = 96;
const RX2 = 196;
const RY2 = 150;

type Frag = { label: string; warn?: boolean };
type Primary = { id: string; label: string; a: number; frags: Frag[] };

const PRIMARIES: Primary[] = [
  { id: "vaccines", label: "Vaccines", a: -90, frags: [{ label: "MMR ✓" }, { label: "Tdap" }] },
  { id: "visits", label: "Visits", a: -45, frags: [{ label: "12d ago" }, { label: "Mar 3" }] },
  { id: "labs", label: "Labs", a: 0, frags: [{ label: "HbA1c 7.2" }, { label: "Lipids" }, { label: "CBC" }] },
  { id: "vitals", label: "Vitals", a: 45, frags: [{ label: "BP 148/92" }, { label: "BMI 28" }] },
  { id: "imaging", label: "Imaging", a: 90, frags: [{ label: "CXR clear" }] },
  { id: "meds", label: "Meds", a: 135, frags: [{ label: "Metformin" }, { label: "Amlodipine" }] },
  { id: "allergies", label: "Allergies", a: 180, frags: [{ label: "Penicillin", warn: true }] },
  { id: "notes", label: "Notes", a: -135, frags: [{ label: "Smoker" }, { label: "F/H cardiac" }] },
];

const rad = (deg: number) => (deg * Math.PI) / 180;
const primaryPos = (a: number) => ({ x: CX + RX1 * Math.cos(rad(a)), y: CY + RY1 * Math.sin(rad(a)) });
const fragPos = (a: number, off: number) => ({
  x: CX + RX2 * Math.cos(rad(a + off)),
  y: CY + RY2 * Math.sin(rad(a + off)),
});
const pct = (x: number, y: number) => ({ left: `${(x / 480) * 100}%`, top: `${(y / 360) * 100}%` });

/* deterministic-ish particle field */
const PARTICLES = Array.from({ length: 30 }).map((_, i) => ({
  x: (Math.sin(i * 12.9898) * 43758.5453) % 1,
  y: (Math.sin(i * 78.233) * 12543.32) % 1,
  s: 0.6 + ((i * 7) % 5) * 0.5,
  d: (i % 10) * 0.6,
  dur: 6 + ((i * 3) % 7),
})).map((p) => ({ ...p, x: Math.abs(p.x) * 100, y: Math.abs(p.y) * 100 }));

/* AI synthesis lines (streamed word-by-word) */
const SUMMARY: { words: string[]; warn?: boolean }[] = [
  { words: ["42M", "·", "Type", "2", "diabetes,", "hypertension"] },
  { words: ["Last", "visit", "12", "days", "ago", "·", "BP", "148/92"] },
  { words: ["HbA1c", "↑", "0.6", "since", "March"] },
  { words: ["Penicillin", "allergy", "on", "file"], warn: true },
  { words: ["Statin", "due", "·", "review", "flagged"] },
];

export default function ContextCard() {
  const stageRef = useRef<HTMLDivElement>(null);

  // pointer parallax
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (window.matchMedia("(hover: none)").matches) return;
    let raf = 0;
    const onMove = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width - 0.5;
      const py = (e.clientY - r.top) / r.height - 0.5;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        el.style.setProperty("--px", px.toFixed(3));
        el.style.setProperty("--py", py.toFixed(3));
      });
    };
    const onLeave = () => {
      el.style.setProperty("--px", "0");
      el.style.setProperty("--py", "0");
    };
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerleave", onLeave);
    return () => {
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerleave", onLeave);
      cancelAnimationFrame(raf);
    };
  }, []);

  // build node + edge geometry
  const nodes = PRIMARIES.map((p, i) => {
    const pos = primaryPos(p.a);
    const n = p.frags.length;
    const frags = p.frags.map((f, fi) => {
      const off = (fi - (n - 1) / 2) * 17;
      return { ...f, pos: fragPos(p.a, off), key: `${p.id}-${fi}` };
    });
    return { ...p, pos, frags, i };
  });

  // ring order for the faint web polygon
  const ringOrder = [-90, -45, 0, 45, 90, 135, 180, -135].map((a) => primaryPos(a));

  let edgeIndex = 0;
  let wordCursor = 0;

  return (
    <div className="viz viz--ctx">
      <div className="ctx-stage" ref={stageRef}>
        <div className="ctx-lattice" aria-hidden />

        <div className="ctx-particles" aria-hidden>
          {PARTICLES.map((p, i) => (
            <span
              key={i}
              className="ctx-particle"
              style={{
                left: `${p.x}%`,
                top: `${p.y}%`,
                ["--s" as string]: `${p.s}px`,
                ["--d" as string]: `${p.d}s`,
                ["--dur" as string]: `${p.dur}s`,
              }}
            />
          ))}
        </div>

        <div className="ctx-graph">
          <svg className="ctx-edges" viewBox="0 0 480 360" preserveAspectRatio="none" aria-hidden>
            {/* faint web ring between primaries */}
            <polygon
              className="ctx-web"
              points={ringOrder.map((p) => `${p.x},${p.y}`).join(" ")}
            />
            {nodes.map((n) => {
              const primaryEdge = edgeIndex++;
              return (
                <g key={n.id}>
                  {/* fragment edges */}
                  {n.frags.map((f) => (
                    <line
                      key={f.key}
                      className="ctx-edge ctx-edge--frag"
                      x1={n.pos.x}
                      y1={n.pos.y}
                      x2={f.pos.x}
                      y2={f.pos.y}
                      pathLength={100}
                      style={{ ["--i" as string]: primaryEdge }}
                    />
                  ))}
                  {/* core -> primary base */}
                  <line
                    className="ctx-edge"
                    x1={CX}
                    y1={CY}
                    x2={n.pos.x}
                    y2={n.pos.y}
                    pathLength={100}
                    style={{ ["--i" as string]: primaryEdge }}
                  />
                  {/* traveling pulse (primary -> core) */}
                  <line
                    className="ctx-pulse"
                    x1={n.pos.x}
                    y1={n.pos.y}
                    x2={CX}
                    y2={CY}
                    pathLength={100}
                    style={{ ["--i" as string]: primaryEdge }}
                  />
                </g>
              );
            })}
          </svg>

          {/* core */}
          <div className="ctx-core" style={pct(CX, CY)}>
            <span className="ctx-core__orb" />
            <span className="ctx-core__label">Patient</span>
          </div>

          {/* primary nodes */}
          {nodes.map((n) => (
            <span
              key={n.id}
              className="ctx-node"
              style={{ ...pct(n.pos.x, n.pos.y), ["--i" as string]: n.i }}
            >
              <span
                className="ctx-node__float"
                style={{ ["--dur" as string]: `${5 + (n.i % 4)}s`, ["--d" as string]: `${n.i * 0.4}s` }}
              >
                <span className="ctx-node__pill">
                  <span className="ctx-node__dot" />
                  {n.label}
                </span>
              </span>
            </span>
          ))}

          {/* secondary fragments */}
          {nodes.flatMap((n) =>
            n.frags.map((f, fi) => (
              <span
                key={f.key}
                className={`ctx-frag${f.warn ? " is-warn" : ""}`}
                style={{ ...pct(f.pos.x, f.pos.y), ["--i" as string]: n.i * 2 + fi }}
              >
                <span
                  className="ctx-frag__float"
                  style={{ ["--dur" as string]: `${6 + (fi % 3)}s`, ["--d" as string]: `${(n.i + fi) * 0.35}s` }}
                >
                  {f.label}
                </span>
              </span>
            ))
          )}

          {/* reading sweep */}
          <span className="ctx-sweep" aria-hidden />
        </div>
      </div>

      {/* AI synthesis panel */}
      <div className="ctx-summary">
        <div className="ctx-summary__head">
          <span className="ctx-summary__spark" />
          AI summary
          <span className="ctx-summary__tag">reading chart</span>
        </div>
        <div className="ctx-summary__body">
          {SUMMARY.map((line, li) => (
            <p className={`ctx-line${line.warn ? " is-warn" : ""}`} key={li}>
              {line.warn && <span className="ctx-line__ic">!</span>}
              {line.words.map((w, wi) => (
                <span
                  key={wi}
                  className="ctx-word"
                  style={{ ["--w" as string]: wordCursor++ }}
                >
                  {w}
                </span>
              ))}
            </p>
          ))}
        </div>
      </div>
    </div>
  );
}
