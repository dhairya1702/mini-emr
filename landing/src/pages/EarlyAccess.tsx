import { useEffect, useRef, useState } from "react";
import { gsap } from "gsap";
import {
  ACCESS_EMAIL,
  ACCESS_LIVE,
  WEB3FORMS_ACCESS_KEY,
  WEB3FORMS_ENDPOINT,
} from "../access";
import { useTransition } from "../transition-context";
import { trackAnalyticsEvent } from "../track";
import "../App.css";

type Status = "idle" | "submitting" | "done" | "error";
const ROLES = ["Doctor", "Clinic admin", "Front desk", "Other"];

const PERKS = [
  {
    k: "01",
    t: "Shape the product",
    d: "Your workflow becomes our roadmap. Tell us what's broken — watch it get built.",
  },
  {
    k: "02",
    t: "Founding-clinic pricing",
    d: "Lock in early pricing for life. The clinics that show up first pay the least, forever.",
  },
  {
    k: "03",
    t: "A direct line",
    d: "White-glove onboarding and a real human on the team who knows your clinic by name.",
  },
];

export default function EarlyAccess() {
  const { go } = useTransition();
  const root = useRef<HTMLDivElement>(null);

  const [status, setStatus] = useState<Status>("idle");
  const [form, setForm] = useState({
    name: "",
    email: "",
    clinic: "",
    role: ROLES[0],
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  // Honeypot: real users never fill this hidden field; bots do.
  const botField = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const ctx = gsap.context(() => {
      const tl = gsap.timeline({ defaults: { ease: "power3.out" } });
      tl.from(".ea__eyebrow", { y: 20, opacity: 0, duration: 0.6, delay: 0.15 })
        .from(
          ".ea__title .ea__line span",
          { yPercent: 120, duration: 0.9, stagger: 0.1 },
          "-=0.3"
        )
        .from(".ea__lead", { y: 24, opacity: 0, duration: 0.7 }, "-=0.5")
        .from(
          ".ea__perk",
          { y: 24, opacity: 0, duration: 0.6, stagger: 0.1 },
          "-=0.4"
        )
        .from(".ea__card", { y: 40, opacity: 0, duration: 0.8 }, "-=0.7");
    }, root);
    return () => ctx.revert();
  }, []);

  const set = (k: keyof typeof form, v: string) =>
    setForm((f) => ({ ...f, [k]: v }));

  const validate = () => {
    const e: Record<string, string> = {};
    if (!form.name.trim()) e.name = "Tell us your name";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email))
      e.email = "Enter a valid email";
    if (!form.clinic.trim()) e.clinic = "Your clinic's name";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (status === "submitting" || !validate()) return;

    // Silently drop bot submissions caught by the honeypot.
    if (botField.current?.value) {
      setStatus("done");
      return;
    }

    setStatus("submitting");

    // Demo mode until a real Web3Forms key is set — never breaks the live form.
    if (!ACCESS_LIVE) {
      await new Promise((r) => setTimeout(r, 1100));
      setStatus("done");
      trackAnalyticsEvent("generate_lead", { form_name: "early_access" });
      return;
    }

    try {
      const res = await fetch(WEB3FORMS_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          access_key: WEB3FORMS_ACCESS_KEY,
          subject: `ClinicOS early access — ${form.clinic || form.name}`,
          from_name: "ClinicOS Landing",
          to: ACCESS_EMAIL,
          name: form.name,
          email: form.email,
          clinic: form.clinic,
          role: form.role,
        }),
      });

      const data = await res.json().catch(() => null);
      if (res.ok && data?.success) {
        setStatus("done");
        trackAnalyticsEvent("generate_lead", { form_name: "early_access" });
      } else {
        setStatus("error");
      }
    } catch {
      setStatus("error");
    }
  };

  return (
    <div className="ea" ref={root}>
      <div className="ea__bg" aria-hidden>
        <div className="backdrop__orb backdrop__orb--a" />
        <div className="backdrop__orb backdrop__orb--b" />
        <div className="backdrop__vignette" />
      </div>
      <div className="grain" aria-hidden />

      <button className="ea__home" onClick={() => go("/")}>
        <span aria-hidden>←</span> Clinic
        <span className="nav__brand-thin">OS</span>
      </button>

      <div className="ea__inner">
        {/* LEFT — copy */}
        <div className="ea__copy">
          <div className="ea__eyebrow">
            <span className="hero__dot" /> Early access · limited intake
          </div>
          <h1 className="ea__title">
            <span className="ea__line">
              <span>You're early.</span>
            </span>
            <span className="ea__line">
              <span className="ea__glow">That's the point.</span>
            </span>
          </h1>
          <p className="ea__lead">
            We're letting a handful of clinics in before anyone else — to build
            the AI that fits how <em>you</em> actually work. Less software you
            bend to. More software that bends to you.
          </p>

          <div className="ea__perks">
            {PERKS.map((p) => (
              <div className="ea__perk" key={p.k}>
                <span className="ea__perk-k">{p.k}</span>
                <div>
                  <h3>{p.t}</h3>
                  <p>{p.d}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* RIGHT — form / success */}
        <div className="ea__card">
          {status === "done" ? (
            <div className="modal__done">
              <div className="modal__check" aria-hidden>
                <svg viewBox="0 0 52 52">
                  <circle cx="26" cy="26" r="24" />
                  <path d="M14 27 l8 8 l16 -18" />
                </svg>
              </div>
              <h3 className="modal__title">You're on the list.</h3>
              <p className="modal__sub">
                Thanks, {form.name.split(" ")[0] || "there"}. We'll reach out to{" "}
                <strong>{form.email}</strong> when early access opens for{" "}
                {form.clinic}.
              </p>
              <button className="btn btn--ghost" onClick={() => go("/")}>
                ← Back to home
              </button>
            </div>
          ) : (
            <>
              <h2 className="ea__card-title">Claim your spot</h2>
              <form className="modal__form" onSubmit={submit} noValidate>
                {/* honeypot — visually hidden, off-screen, not tabbable */}
                <input
                  ref={botField}
                  type="text"
                  name="botcheck"
                  tabIndex={-1}
                  autoComplete="off"
                  aria-hidden
                  style={{
                    position: "absolute",
                    left: "-9999px",
                    opacity: 0,
                    height: 0,
                    width: 0,
                  }}
                />
                <div className="field">
                  <label>Name</label>
                  <input
                    value={form.name}
                    onChange={(e) => set("name", e.target.value)}
                    placeholder="Dr. Asha Rao"
                    className={errors.name ? "is-error" : ""}
                  />
                  {errors.name && (
                    <span className="field__err">{errors.name}</span>
                  )}
                </div>
                <div className="field">
                  <label>Work email</label>
                  <input
                    type="email"
                    value={form.email}
                    onChange={(e) => set("email", e.target.value)}
                    placeholder="asha@clinic.com"
                    className={errors.email ? "is-error" : ""}
                  />
                  {errors.email && (
                    <span className="field__err">{errors.email}</span>
                  )}
                </div>
                <div className="field">
                  <label>Clinic</label>
                  <input
                    value={form.clinic}
                    onChange={(e) => set("clinic", e.target.value)}
                    placeholder="Rao Family Clinic"
                    className={errors.clinic ? "is-error" : ""}
                  />
                  {errors.clinic && (
                    <span className="field__err">{errors.clinic}</span>
                  )}
                </div>
                <div className="field">
                  <label>Your role</label>
                  <div className="seg">
                    {ROLES.map((r) => (
                      <button
                        type="button"
                        key={r}
                        className={`seg__opt${
                          form.role === r ? " is-on" : ""
                        }`}
                        onClick={() => set("role", r)}
                      >
                        {r}
                      </button>
                    ))}
                  </div>
                </div>
                <button
                  type="submit"
                  className="btn btn--primary modal__submit"
                  disabled={status === "submitting"}
                >
                  {status === "submitting" ? (
                    <span className="spinner" aria-hidden />
                  ) : status === "error" ? (
                    "Try again"
                  ) : (
                    "Request early access"
                  )}
                </button>
                {status === "error" && (
                  <p className="modal__err" role="alert">
                    Something went wrong sending that. Please try again, or
                    email us at {ACCESS_EMAIL}.
                  </p>
                )}
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
