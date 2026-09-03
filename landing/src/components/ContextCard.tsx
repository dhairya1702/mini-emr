import { useEffect, useRef } from "react";

/* ---- graph model (viewBox 480 x 360) ---- */
const CX = 240;
const CY = 180;
const RX1 = 122;
const RY1 = 96;
const RX2 = 196;
const RY2 = 150;

type Frag = { label: string; warn?: boolean; mobilePriority?: boolean };
type Primary = { id: string; label: string; a: number; frags: Frag[] };

const PRIMARIES: Primary[] = [
  {
    id: "rx",
    label: "Rx history",
    a: -90,
    frags: [{ label: "-2.25 OU", mobilePriority: true }, { label: "changed 6mo" }],
  },
  {
    id: "visits",
    label: "Visits",
    a: -45,
    frags: [{ label: "14d ago", mobilePriority: true }, { label: "annual due" }],
  },
  {
    id: "scans",
    label: "Scans",
    a: 0,
    frags: [
      { label: "OCT stable", mobilePriority: true },
      { label: "fundus" },
      { label: "topography" },
    ],
  },
  {
    id: "iop",
    label: "IOP",
    a: 45,
    frags: [{ label: "18/19", mobilePriority: true }, { label: "watch trend" }],
  },
  {
    id: "lenses",
    label: "Lenses",
    a: 90,
    frags: [{ label: "CL irritation", mobilePriority: true }],
  },
  {
    id: "drops",
    label: "Drops",
    a: 135,
    frags: [{ label: "lubricant", mobilePriority: true }, { label: "night use" }],
  },
  {
    id: "allergies",
    label: "Alerts",
    a: 180,
    frags: [{ label: "redness", warn: true, mobilePriority: true }],
  },
  {
    id: "notes",
    label: "Notes",
    a: -135,
    frags: [{ label: "screen time", mobilePriority: true }, { label: "dry eyes" }],
  },
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

const SUMMARY =
  "Priya is a 42-year-old contact lens wearer. Her prescription changed six months ago, and her myopia has been gradually progressing. OCT and fundus records look stable, but she reported redness after switching lens brands. Check lens fit, comfort and wearing time today.";

const SUMMARY_ALERT_WORDS = new Set(["redness", "brands."]);

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
  const summaryWords = SUMMARY.split(" ");

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
                      className={`ctx-edge ctx-edge--frag${
                        f.mobilePriority ? " is-mobile-priority" : ""
                      }`}
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
                className={`ctx-frag${f.warn ? " is-warn" : ""}${
                  f.mobilePriority ? " is-mobile-priority" : ""
                }`}
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
        </div>
        <div className="ctx-summary__body">
          <p className="ctx-line ctx-line--paragraph">
            {summaryWords.map((word, index) => (
              <span
                key={`${word}-${index}`}
                className={`ctx-word${SUMMARY_ALERT_WORDS.has(word) ? " is-warn" : ""}`}
                style={{ ["--w" as string]: index }}
              >
                {word}
              </span>
            ))}
          </p>
        </div>
      </div>
    </div>
  );
}
