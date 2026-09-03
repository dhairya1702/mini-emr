import type { Scene } from "../scenes";
import PracticeCard from "./PracticeCard";
import EarningsCard from "./EarningsCard";
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
      const typedInput = "redness, irritation, blurry vision, give drops, take rest, review next week";
      const note = [
        {
          h: "Complaint",
          text: "Patient reports redness, irritation and blurry vision.",
        },
        {
          h: "Examination",
          text: "No urgent red flags noted. Vision and ocular surface reviewed.",
        },
        { h: "Assessment", text: "Likely mild ocular irritation with temporary visual discomfort." },
        {
          h: "Treatment",
          text: "Start lubricating eye drops, advise rest from contact lenses and review next week.",
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
              <div className="viz-typed">
                {typedInput}
                <span className="viz-caret" />
              </div>
            </div>
            <div className="viz-expand">
              <span className="viz-enter">Enter</span>
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
            <div className="viz-tag">Structured note, ready to sign</div>
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
    default:
      return null;
  }
}
