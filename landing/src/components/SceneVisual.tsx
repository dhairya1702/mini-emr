import type { Scene } from "../scenes";

/** Abstract, generated UI-flavored visuals per beat. No external media. */
export default function SceneVisual({ scene }: { scene: Scene }) {
  switch (scene.visual) {
    case "ai":
      return (
        <div className="viz viz--ai">
          <div className="viz-card">
            <div className="viz-card__head">
              <span className="viz-orb" />
              <span className="viz-card__title">AI Scribe</span>
              <span className="viz-badge">draft</span>
            </div>
            <div className="viz-input">
              <span className="viz-input__label">You type</span>
              <div className="viz-tokens">
                {["fever 3d", "sore throat", "T 38.4", "rx amox"].map((t, i) => (
                  <span key={t} className="viz-token" style={{ ["--i" as string]: i }}>
                    {t}
                  </span>
                ))}
                <span className="viz-caret" />
              </div>
            </div>
            <div className="viz-expand">
              <span className="viz-expand__icon" />
              <span>AI expands</span>
            </div>
            <div className="viz-note">
              <span className="viz-note__h">History</span>
              <span className="viz-line w90 fill" style={{ ["--d" as string]: 0 }} />
              <span className="viz-line w75 fill" style={{ ["--d" as string]: 1 }} />
              <span className="viz-note__h">Examination</span>
              <span className="viz-line w85 fill" style={{ ["--d" as string]: 2 }} />
              <span className="viz-note__h">Plan</span>
              <span className="viz-line w70 fill" style={{ ["--d" as string]: 3 }} />
            </div>
            <div className="viz-tag">Structured note · ready to sign</div>
          </div>
        </div>
      );
    case "chart":
      return (
        <div className="viz viz--chart">
          <div className="viz-card">
            <div className="viz-card__head">
              <span className="viz-avatar" />
              <span className="viz-card__title">Patient timeline</span>
            </div>
            <ul className="viz-timeline">
              {["Visit · note finalized", "Lab attached", "Follow-up booked", "Invoice paid"].map(
                (t, i) => (
                  <li key={i} style={{ ["--i" as string]: i }}>
                    <span className="viz-node" />
                    {t}
                  </li>
                )
              )}
            </ul>
          </div>
        </div>
      );
    case "queue":
      return (
        <div className="viz viz--queue">
          {["Waiting", "In consult", "Done"].map((col, ci) => (
            <div className="viz-col" key={col} style={{ ["--i" as string]: ci }}>
              <div className="viz-col__head">{col}</div>
              {Array.from({ length: 3 - ci > 0 ? 3 - ci + 1 : 1 }).map((_, i) => (
                <div className="viz-chip" key={i} style={{ ["--j" as string]: i }} />
              ))}
            </div>
          ))}
        </div>
      );
    case "billing":
      return (
        <div className="viz viz--billing">
          <div className="viz-card">
            <div className="viz-card__head">
              <span className="viz-card__title">Invoice</span>
              <span className="viz-badge viz-badge--ok">paid</span>
            </div>
            <div className="viz-rows">
              {[["Consultation", "₹—"], ["Medication", "₹—"], ["Procedure", "₹—"]].map(
                (r, i) => (
                  <div className="viz-row" key={i} style={{ ["--i" as string]: i }}>
                    <span className="viz-line w60" />
                    <span className="viz-amt">{r[1]}</span>
                  </div>
                )
              )}
            </div>
            <div className="viz-total">
              <span>Total</span>
              <span className="viz-amt viz-amt--big">₹—</span>
            </div>
          </div>
        </div>
      );
    case "followup":
      return (
        <div className="viz viz--followup">
          <div className="viz-cal">
            {Array.from({ length: 28 }).map((_, i) => (
              <span
                key={i}
                className={`viz-day${[9, 15, 22].includes(i) ? " is-on" : ""}`}
                style={{ ["--i" as string]: i }}
              />
            ))}
          </div>
          <div className="viz-tag">Reminders sent automatically</div>
        </div>
      );
    case "intro":
      return (
        <div className="viz viz--intro">
          <div className="viz-scatter">
            {["Notes", "Paper", "Billing", "Charts", "Sheets", "SMS"].map((t, i) => (
              <span key={t} className="viz-frag" style={{ ["--i" as string]: i }}>
                {t}
              </span>
            ))}
          </div>
        </div>
      );
    default:
      return null;
  }
}
