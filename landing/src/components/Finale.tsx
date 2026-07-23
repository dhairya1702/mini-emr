import { useEffect, useRef } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useTransition } from "../transition-context";
import { trackAnalyticsEvent } from "../track";

export default function Finale() {
  const root = useRef<HTMLDivElement>(null);
  const { go } = useTransition();

  useEffect(() => {
    const ctx = gsap.context(() => {
      const tl = gsap.timeline({
        scrollTrigger: {
          trigger: root.current,
          start: "top 70%",
          end: "center center",
          scrub: 0.7,
        },
      });
      tl.from(".finale__word", {
        yPercent: 120,
        opacity: 0,
        stagger: 0.1,
        ease: "none",
      })
        .from(".finale__sub", { y: 30, opacity: 0, ease: "none" }, 0.1)
        .from(".finale__cta", { y: 24, opacity: 0, ease: "none" }, 0.2)
        .from(".finale__foot", { opacity: 0, ease: "none" }, 0.3);
    }, root);

    ScrollTrigger.refresh();
    return () => ctx.revert();
  }, []);

  return (
    <section className="finale" id="finale" ref={root}>
      <div className="finale__inner">
        <h2 className="finale__title">
          <span className="finale__line">
            <span className="finale__word">Your clinic,</span>
          </span>
          <span className="finale__line">
            <span className="finale__word finale__word--glow">running itself.</span>
          </span>
        </h2>
        <p className="finale__sub">
          The intelligence layer for the modern clinic. Built around the work
          that actually matters.
        </p>
        <div className="finale__cta">
          <button
            className="btn btn--primary"
            onClick={() => {
              trackAnalyticsEvent("select_content", {
                content_type: "cta",
                content_id: "finale_request_access",
              });
              go("/early-access");
            }}
          >
            Request early access
          </button>
          <a className="btn btn--ghost" href="#top">
            Back to top
          </a>
        </div>
        <div className="finale__foot">
          <span className="finale__brand">
            Clinic<span className="nav__brand-thin">OS</span>
          </span>
          <span className="finale__copy-note">Coming soon</span>
        </div>
      </div>
    </section>
  );
}
