export type Scene = {
  id: string;
  /** Background layers for this beat (CSS backgrounds, stacked) */
  background: string;
  /** Accent glow color */
  glow: string;
  kicker: string;
  title: string;
  copy: string;
  /** Optional stat / pillar chips shown in the visual panel */
  chips?: string[];
  /** Visual variant rendered in the right/feature panel */
  visual:
    | "ai"
    | "context"
    | "practice"
    | "billing"
    | "followup"
    | "none";
};

/**
 * SCENES[0] is the hero/base layer. The rest are the scroll beats.
 * Each beat's backdrop crossfades in as its section enters the viewport.
 *
 * Narrative: AI-first clinical intelligence. The AI scribe + patient
 * context + assistance lead. Operations (queue, billing, follow-up)
 * are framed as "and the rest runs itself."
 */
export const SCENES: Scene[] = [
  {
    id: "hero",
    background:
      "radial-gradient(120% 120% at 50% -10%, rgba(47,143,211,0.20) 0%, rgba(7,13,24,0) 55%), radial-gradient(80% 80% at 80% 110%, rgba(103,183,255,0.12) 0%, rgba(4,7,13,0) 60%), linear-gradient(180deg, #04070d 0%, #070d18 100%)",
    glow: "#67b7ff",
    kicker: "",
    title: "",
    copy: "",
    visual: "none",
  },
  {
    id: "ai",
    background:
      "radial-gradient(120% 120% at 50% 0%, rgba(103,183,255,0.30) 0%, rgba(2,5,10,0) 50%), radial-gradient(90% 90% at 50% 120%, rgba(47,143,211,0.18) 0%, rgba(2,5,10,0) 55%), linear-gradient(180deg, #03060c 0%, #061021 100%)",
    glow: "#9ed1ff",
    kicker: "01 — The AI Scribe",
    title: "A few words in. A full note out.",
    copy: "Jot the symptoms and findings in shorthand. The AI expands them into a complete, structured clinical note — history, examination, diagnosis, plan — ready for you to review and sign.",
    chips: ["Type shorthand", "AI expands", "Review & sign"],
    visual: "ai",
  },
  {
    id: "chart",
    background:
      "radial-gradient(100% 100% at 20% 10%, rgba(47,143,211,0.18) 0%, rgba(7,13,24,0) 55%), radial-gradient(90% 90% at 95% 95%, rgba(80,156,247,0.12) 0%, rgba(4,7,13,0) 60%), linear-gradient(165deg, #050a14 0%, #091523 100%)",
    glow: "#67b7ff",
    kicker: "02 — Patient Context",
    title: "It already knows the whole story.",
    copy: "Every visit, note, attachment and result, understood. Walk into the room and the AI surfaces what matters about this patient — before you ask.",
    chips: ["Timeline", "Summaries", "Recall"],
    visual: "context",
  },
  {
    id: "queue",
    background:
      "radial-gradient(110% 100% at 80% 15%, rgba(47,143,211,0.22) 0%, rgba(7,13,24,0) 55%), radial-gradient(80% 80% at 10% 90%, rgba(103,183,255,0.10) 0%, rgba(4,7,13,0) 60%), linear-gradient(180deg, #060b16 0%, #081120 100%)",
    glow: "#67b7ff",
    kicker: "03 — Practice Management",
    title: "The whole practice, on one schedule.",
    copy: "Appointments, reception, staff and rooms — across every doctor and location, in one live view. The AI books, checks patients in, and keeps the day moving on its own.",
    chips: ["Scheduling", "Multi-location", "Front desk"],
    visual: "practice",
  },
  {
    id: "billing",
    background:
      "radial-gradient(110% 100% at 85% 20%, rgba(79,156,247,0.20) 0%, rgba(7,13,24,0) 55%), radial-gradient(80% 80% at 5% 85%, rgba(47,143,211,0.12) 0%, rgba(4,7,13,0) 60%), linear-gradient(180deg, #060c17 0%, #0a1422 100%)",
    glow: "#7fc0ff",
    kicker: "04 — Runs itself",
    title: "And the rest takes care of itself.",
    copy: "Billing, inventory and earnings stay in lockstep. Tracked stock deducts on finalized invoices. Revenue reflects only real, paid work — no spreadsheets.",
    chips: ["Invoices", "Inventory", "Earnings"],
    visual: "billing",
  },
  {
    id: "followup",
    background:
      "radial-gradient(120% 120% at 50% -10%, rgba(103,183,255,0.16) 0%, rgba(7,13,24,0) 55%), radial-gradient(90% 90% at 50% 110%, rgba(47,143,211,0.12) 0%, rgba(4,7,13,0) 60%), linear-gradient(180deg, #060b15 0%, #081020 100%)",
    glow: "#67b7ff",
    kicker: "05 — Continuity",
    title: "Care that doesn't end at the door.",
    copy: "The AI schedules follow-ups, sends the reminders, and lets patients re-book within your hours. The loop closes on its own.",
    chips: ["Schedule", "Remind", "Re-book"],
    visual: "followup",
  },
];
