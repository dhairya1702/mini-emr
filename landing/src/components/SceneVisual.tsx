import type { Scene } from "../scenes";

/** Streams a line of note text in word-by-word. `start` is the running
 *  word index across the whole note so the cascade is continuous. */
function streamLine(text: string, start: number) {
  const words = text.split(" ");
  return {
    next: start + words.length,
    nodes: words.map((w, i) => (
      <span
        key={i}
        className="viz-word"
        style={{ ["--w" as string]: start + i }}
      >
        {w}
      </span>
    )),
  };
}

/** Abstract, generated UI-flavored visuals per beat. No external media. */
export default function SceneVisual({ scene }: { scene: Scene }) {
  switch (scene.visual) {
    case "ai": {
      const note = [
        {
          h: "History",
          text: "3-day history of fever with sore throat. No cough or breathlessness.",
        },
        {
          h: "Examination",
          text: "Temp 38.4°C. Pharynx congested, tonsils enlarged. Chest clear.",
        },
        { h: "Diagnosis", text: "Acute bacterial pharyngitis." },
        {
          h: "Plan",
          text: "Amoxicillin 500 mg TDS × 5 days. Paracetamol PRN. Review in 3 days.",
        },
      ];
      let idx = 0;
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
              {note.map((sec, si) => {
                const streamed = streamLine(sec.text, idx);
                idx = streamed.next;
                const isLast = si === note.length - 1;
                return (
                  <div className="viz-sec" key={sec.h}>
                    <span className="viz-note__h">{sec.h}</span>
                    <p className="viz-stream">
                      {streamed.nodes}
                      {isLast && (
                        <span
                          className="viz-caret viz-caret--stream"
                          style={{ ["--w" as string]: idx }}
                        />
                      )}
                    </p>
                  </div>
                );
              })}
            </div>
            <div className="viz-tag">Structured note · ready to sign</div>
          </div>
        </div>
      );
    }
    case "context": {
      // hexagon of history fragments around the patient (viewBox 400×300)
      const cx = 200;
      const cy = 150;
      const cnodes = [
        { label: "Visits", x: 270, y: 70.3 },
        { label: "Labs", x: 340, y: 150 },
        { label: "Vitals", x: 270, y: 229.7 },
        { label: "Meds", x: 130, y: 229.7 },
        { label: "Allergies", x: 60, y: 150 },
        { label: "Notes", x: 130, y: 70.3 },
      ];
      return (
        <div className="viz viz--context">
          <svg
            className="viz-links"
            viewBox="0 0 400 300"
            preserveAspectRatio="none"
            aria-hidden
          >
            {cnodes.map((n, i) => (
              <line
                key={n.label}
                className="viz-link"
                x1={cx}
                y1={cy}
                x2={n.x}
                y2={n.y}
                pathLength={1}
                style={{ ["--i" as string]: i }}
              />
            ))}
          </svg>

          <div className="viz-core">
            <span className="viz-core__avatar" />
            <span className="viz-core__label">Patient</span>
          </div>

          {cnodes.map((n, i) => (
            <span
              key={n.label}
              className="viz-cnode"
              style={{
                left: `${(n.x / 400) * 100}%`,
                top: `${(n.y / 300) * 100}%`,
                ["--i" as string]: i,
              }}
            >
              <span className="viz-cnode__dot" />
              {n.label}
            </span>
          ))}

          <div className="viz-insight">
            <span className="viz-insight__icon">!</span>
            Penicillin allergy · BP trending up · review due
          </div>
        </div>
      );
    }
    case "practice": {
      const times = ["9:00", "9:30", "10:00", "10:30", "11:00"];
      const doctors = [
        { name: "Dr. Rao", slots: [true, false, true, true, false] },
        { name: "Dr. Iyer", slots: [false, true, true, false, true] },
      ];
      let apptIndex = 0;
      return (
        <div className="viz viz--practice">
          <div className="viz-card">
            <div className="viz-card__head">
              <span className="viz-card__title">Schedule · Today</span>
              <div className="viz-locs">
                <span className="viz-loc is-on">Clinic A</span>
                <span className="viz-loc">Clinic B</span>
              </div>
            </div>
            <div className="viz-sched">
              <div className="viz-sched__times">
                {times.map((t) => (
                  <span key={t} className="viz-time">
                    {t}
                  </span>
                ))}
              </div>
              {doctors.map((doc) => (
                <div className="viz-sched__col" key={doc.name}>
                  <div className="viz-sched__doc">
                    <span className="viz-avatar viz-avatar--sm" />
                    {doc.name}
                  </div>
                  <div className="viz-sched__slots">
                    {doc.slots.map((on, i) => (
                      <span
                        key={i}
                        className={`viz-slot${on ? " is-appt" : ""}`}
                        style={
                          on
                            ? { ["--i" as string]: apptIndex++ }
                            : undefined
                        }
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <div className="viz-tag">Staff, rooms &amp; reminders — handled</div>
          </div>
        </div>
      );
    }
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
    default:
      return null;
  }
}
