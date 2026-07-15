import type { Scene } from "../scenes";
import PracticeCard from "./PracticeCard";
import EarningsCard from "./EarningsCard";
import PhoneCard from "./PhoneCard";
import ContextCard from "./ContextCard";

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
    case "context":
      return <ContextCard />;
    case "practice":
      return <PracticeCard />;
    case "ops":
      return <EarningsCard />;
    case "continuity":
      return <PhoneCard />;
    default:
      return null;
  }
}
