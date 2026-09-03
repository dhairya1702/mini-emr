import { useEffect, useRef } from "react";
import Lenis from "lenis";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import "../App.css";
import { SCENES } from "../scenes";
import Backdrop from "../components/Backdrop";
import Hero from "../components/Hero";
import PhoneHero from "../components/PhoneHero";
import Scene from "../components/Scene";
import Finale from "../components/Finale";
import Footer from "../components/Footer";
import Nav from "../components/Nav";
import ScrollProgress from "../components/ScrollProgress";

gsap.registerPlugin(ScrollTrigger);

export default function Landing() {
  const backdropRefs = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    const prefersReduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;

    let lenis: Lenis | null = null;
    const tickerFn = (time: number) => lenis?.raf(time * 1000);

    if (!prefersReduced) {
      lenis = new Lenis({
        duration: 1.15,
        easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
        smoothWheel: true,
      });
      lenis.on("scroll", ScrollTrigger.update);
      gsap.ticker.add(tickerFn);
      gsap.ticker.lagSmoothing(0);
    }

    const triggers: ScrollTrigger[] = [];
    backdropRefs.current.forEach((layer, i) => {
      if (!layer) return;
      if (i === 0) {
        gsap.set(layer, { opacity: 1 });
        return;
      }
      gsap.set(layer, { opacity: 0 });
      const section = document.querySelector<HTMLElement>(
        `[data-scene="${i}"]`
      );
      if (!section) return;
      const tween = gsap.fromTo(
        layer,
        { opacity: 0 },
        {
          opacity: 1,
          ease: "none",
          scrollTrigger: {
            trigger: section,
            start: "top 92%",
            end: "top 38%",
            scrub: prefersReduced ? false : 0.8,
          },
        }
      );
      if (tween.scrollTrigger) triggers.push(tween.scrollTrigger);
    });

    ScrollTrigger.refresh();

    return () => {
      triggers.forEach((t) => t.kill());
      ScrollTrigger.getAll().forEach((t) => t.kill());
      gsap.ticker.remove(tickerFn);
      lenis?.destroy();
    };
  }, []);

  return (
    <>
      <Backdrop
        scenes={SCENES}
        registerRef={(i, el) => (backdropRefs.current[i] = el)}
      />
      <div className="grain" aria-hidden />
      <Nav />
      <ScrollProgress />

      <main>
        <Hero />
        <PhoneHero />
        {SCENES.slice(1, SCENES.length).map((scene, idx) => (
          <Scene key={scene.id} scene={scene} index={idx + 1} />
        ))}
        <Finale />
        <Footer />
      </main>
    </>
  );
}
