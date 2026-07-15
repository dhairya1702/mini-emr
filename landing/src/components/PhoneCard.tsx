import { useTilt } from "./useTilt";

/** Patient-side continuity: reminders, re-book, results/Rx, resume care. */
export default function PhoneCard() {
  const phoneRef = useTilt<HTMLDivElement>(5);

  return (
    <div className="viz viz--phone">
      <div className="viz-phone" ref={phoneRef}>
        <div className="viz-sheen" aria-hidden />
        <div className="viz-phone__frame">
          <span className="viz-phone__notch" aria-hidden />

          <div className="viz-phone__screen">
            <div className="viz-phone__status">
              <span>9:41</span>
              <span className="viz-phone__brand">Clinic</span>
            </div>

            {/* 1 — follow-up reminder / notification */}
            <div className="viz-pcard viz-pcard--notif" style={{ ["--i" as string]: 0 }}>
              <span className="viz-pico viz-pico--bell" aria-hidden>
                <svg width="15" height="15" viewBox="0 0 16 16">
                  <path d="M8 2a3.2 3.2 0 0 0-3.2 3.2v2.3L3.6 9.4h8.8L11.2 7.5V5.2A3.2 3.2 0 0 0 8 2Z" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
                  <path d="M6.6 11.4a1.4 1.4 0 0 0 2.8 0" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                </svg>
              </span>
              <div className="viz-pcard__body">
                <span className="viz-pcard__title">Follow-up reminder</span>
                <span className="viz-pcard__sub">Dr. Rao · Fri, 10:30</span>
              </div>
              <span className="viz-pcard__pulse" aria-hidden />
            </div>

            {/* 2 — one-tap re-book */}
            <div className="viz-pcard" style={{ ["--i" as string]: 1 }}>
              <span className="viz-pico viz-pico--cal" aria-hidden>
                <svg width="15" height="15" viewBox="0 0 16 16">
                  <rect x="2.5" y="3.5" width="11" height="10" rx="2" fill="none" stroke="currentColor" strokeWidth="1.2" />
                  <path d="M2.5 6.3h11M5.5 2.4v2M10.5 2.4v2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                </svg>
              </span>
              <div className="viz-pcard__body">
                <span className="viz-pcard__title">Re-book a visit</span>
                <span className="viz-pcard__sub">Next open · Fri 10:30</span>
              </div>
              <span className="viz-pbtn">1 tap</span>
            </div>

            {/* 3 — results & prescription */}
            <div className="viz-pcard" style={{ ["--i" as string]: 2 }}>
              <span className="viz-pico viz-pico--file" aria-hidden>
                <svg width="15" height="15" viewBox="0 0 16 16">
                  <path d="M4 2.5h5l3 3v8H4Z" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
                  <path d="M9 2.5v3h3M6 9h4M6 11h3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                </svg>
              </span>
              <div className="viz-pcard__body">
                <span className="viz-pcard__title">Results & prescription</span>
                <span className="viz-pcard__sub">Labs ready · Rx Amoxicillin</span>
              </div>
              <span className="viz-pcard__badge">new</span>
            </div>

            {/* 4 — resume / continue care */}
            <div className="viz-pcont" style={{ ["--i" as string]: 3 }}>
              <span className="viz-pcont__label">Continue care</span>
              <span className="viz-pcont__bar">
                <span className="viz-pcont__fill" />
              </span>
              <span className="viz-pcont__meta">Pick up where you left off</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
