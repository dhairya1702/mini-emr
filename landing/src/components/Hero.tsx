import { useEffect, useRef } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

export default function Hero() {
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const ctx = gsap.context(() => {
      // Intro
      const intro = gsap.timeline({ defaults: { ease: "power3.out" } });
      intro
        .from(".hero__eyebrow", { y: 24, opacity: 0, duration: 0.9, delay: 0.2 })
        .from(
          ".hero__line .hero__word",
          { yPercent: 120, opacity: 0, duration: 1.1, stagger: 0.12 },
          "-=0.5"
        )
        .from(
          ".hero__sub",
          { y: 24, opacity: 0, duration: 0.9 },
          "-=0.6"
        )
        .from(".hero__cue", { opacity: 0, duration: 0.8 }, "-=0.4");

      // Scroll-driven parallax + fade as you leave the hero
      const out = gsap.timeline({
        scrollTrigger: {
          trigger: root.current,
          start: "top top",
          end: "bottom top",
          scrub: 0.6,
        },
      });
      out
        .to(".hero__title", { yPercent: -28, opacity: 0, ease: "none" }, 0)
        .to(".hero__sub", { yPercent: -60, opacity: 0, ease: "none" }, 0)
        .to(".hero__eyebrow", { opacity: 0, ease: "none" }, 0)
        .to(".hero__cue", { opacity: 0, ease: "none" }, 0);
    }, root);

    ScrollTrigger.refresh();
    return () => ctx.revert();
  }, []);

  return (
    <section className="hero" id="top" ref={root}>
      <div className="hero__inner">
        <div className="hero__eyebrow">
          <span className="hero__dot" /> AI-first clinical intelligence
        </div>
        <h1 className="hero__title">
          <span className="hero__line">
            <span className="hero__word">Your clinic,</span>
          </span>
          <span className="hero__line">
            <span className="hero__word hero__word--glow">unified</span>
            <span className="hero__word">by AI.</span>
          </span>
        </h1>
        <p className="hero__sub hero__sub--accent">
          One intelligence running your entire clinic
        </p>
      </div>
      <div className="hero__cue">
        <span>Scroll</span>
        <span className="hero__cue-line" />
      </div>
    </section>
  );
}
