import { useEffect, useRef, useState } from "react";
import { useTilt } from "./useTilt";

const items = [
  { label: "Consultations", amt: 18400, tone: "#67b7ff" },
  { label: "Pharmacy", amt: 21260, tone: "#5fe3c2" },
  { label: "Procedures", amt: 8600, tone: "#9d8cff" },
];
const total = items.reduce((s, i) => s + i.amt, 0);
const bars = [42, 60, 48, 76, 90, 64, 82];
const handled = ["Invoice sent", "Stock updated", "Revenue booked"];

const fmt = (n: number) => Math.round(n).toLocaleString("en-IN");

export default function EarningsCard() {
  const cardRef = useTilt<HTMLDivElement>(6);
  const rootRef = useRef<HTMLDivElement>(null);
  const [value, setValue] = useState(0);

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      setValue(total);
      return;
    }
    let raf = 0;
    let started = false;
    const run = () => {
      const dur = 1300;
      const t0 = performance.now();
      const tick = (now: number) => {
        const p = Math.min(1, (now - t0) / dur);
        const eased = 1 - Math.pow(1 - p, 3);
        setValue(total * eased);
        if (p < 1) raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    };
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !started) {
          started = true;
          run();
          io.disconnect();
        }
      },
      { threshold: 0.4 }
    );
    io.observe(el);
    return () => {
      io.disconnect();
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div className="viz viz--ops" ref={rootRef}>
      <div className="viz-card viz-card--ops" ref={cardRef}>
        <div className="viz-sheen" aria-hidden />

        <div className="viz-card__head" style={{ ["--z" as string]: "36px" }}>
          <span className="viz-card__title">Today · Earnings</span>
          <span className="viz-trend">
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
              <path d="M1 7 L5 3 L9 7" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            12%
          </span>
        </div>

        <div className="viz-earn" style={{ ["--z" as string]: "28px" }}>
          <span className="viz-earn__cur">₹</span>
          <span className="viz-earn__num">{fmt(value)}</span>
          <span className="viz-earn__meta">booked · paid only</span>
        </div>

        <div className="viz-bars" aria-hidden>
          {bars.map((h, i) => (
            <span
              key={i}
              className="viz-bar"
              style={{ ["--h" as string]: `${h}%`, ["--i" as string]: i }}
            />
          ))}
        </div>

        <div className="viz-ledger">
          {items.map((it, i) => (
            <div
              className="viz-ledger__row"
              key={it.label}
              style={{ ["--i" as string]: i }}
            >
              <span
                className="viz-ledger__dot"
                style={{ background: it.tone, boxShadow: `0 0 8px ${it.tone}` }}
              />
              <span className="viz-ledger__label">{it.label}</span>
              <span className="viz-ledger__amt">₹{fmt(it.amt)}</span>
            </div>
          ))}
        </div>

        <div className="viz-handled">
          {handled.map((t, i) => (
            <span
              className="viz-check"
              key={t}
              style={{ ["--i" as string]: i }}
            >
              <span className="viz-check__ic" aria-hidden>
                <svg width="9" height="9" viewBox="0 0 10 10">
                  <path d="M1.5 5.2 L4 7.5 L8.5 2.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
              {t}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
