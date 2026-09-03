import { useTilt } from "./useTilt";

type Appt = { patient: string; type: string; tone: string };
type Slot = Appt | "booking" | null;
type Doc = {
  name: string;
  initials: string;
  color: string;
  status: "busy" | "open";
  slots: Slot[];
};

const times = ["9:00", "9:30", "10:00", "10:30", "11:00"];

const doctors: Doc[] = [
  {
    name: "Dr. Rao",
    initials: "R",
    color: "linear-gradient(135deg, #67b7ff, #2f8fd3)",
    status: "busy",
    slots: [
      { patient: "Aarav S.", type: "Follow-up", tone: "#67b7ff" },
      null,
      { patient: "Meera N.", type: "New patient", tone: "#5fe3c2" },
      "booking",
      null,
    ],
  },
  {
    name: "Dr. Iyer",
    initials: "I",
    color: "linear-gradient(135deg, #9d8cff, #6b7bff)",
    status: "open",
    slots: [
      null,
      { patient: "Kabir R.", type: "Review", tone: "#9d8cff" },
      { patient: "Diya P.", type: "Vaccination", tone: "#5fe3c2" },
      null,
      { patient: "Rohan V.", type: "Consult", tone: "#67b7ff" },
    ],
  },
];

/** Premium day-scheduler card with pointer-driven 3D tilt + light sheen. */
export default function PracticeCard() {
  const cardRef = useTilt<HTMLDivElement>(7);

  return (
    <div className="viz viz--practice">
      <div className="viz-card viz-card--practice" ref={cardRef}>
        <div className="viz-sheen" aria-hidden />

        <div className="viz-card__head" style={{ ["--z" as string]: "40px" }}>
          <span className="viz-card__title">Schedule · Today</span>
          <div className="viz-locs">
            <span className="viz-loc is-on">Clinic A</span>
            <span className="viz-loc">Clinic B</span>
          </div>
        </div>

        <div className="viz-sched" style={{ ["--z" as string]: "24px" }}>
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
                <span
                  className="viz-avatar viz-avatar--sm"
                  style={{ backgroundImage: doc.color }}
                >
                  {doc.initials}
                </span>
                <span className="viz-doc__name">{doc.name}</span>
                <span className={`viz-doc__status is-${doc.status}`} />
              </div>

              <div className="viz-sched__slots">
                {doc.slots.map((slot, i) => {
                  if (slot === "booking") {
                    return (
                      <span
                        key={i}
                        className="viz-slot is-booking"
                        style={{ ["--i" as string]: i }}
                      >
                        <span className="viz-book__spark" />
                        <span className="viz-book__label">AI booking…</span>
                      </span>
                    );
                  }
                  if (slot) {
                    return (
                      <span
                        key={i}
                        className="viz-slot is-appt"
                        style={{
                          ["--i" as string]: i,
                          ["--tone" as string]: slot.tone,
                        }}
                      >
                        <span className="viz-appt__bar" />
                        <span className="viz-appt__body">
                          <span className="viz-appt__name">{slot.patient}</span>
                          <span className="viz-appt__type">{slot.type}</span>
                        </span>
                        <span className="viz-appt__dot" />
                      </span>
                    );
                  }
                  return (
                    <span key={i} className="viz-slot">
                      <span className="viz-slot__open">Open</span>
                    </span>
                  );
                })}
              </div>
            </div>
          ))}

          <span className="viz-now" aria-hidden>
            <span className="viz-now__dot" />
            <span className="viz-now__label">now</span>
          </span>
        </div>

        <div className="viz-tag">Staff, rooms &amp; reminders handled</div>
      </div>
    </div>
  );
}
