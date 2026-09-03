import { useEffect, useRef } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import type { Scene as SceneType } from "../scenes";
import SceneVisual from "./SceneVisual";

type Props = {
  scene: SceneType;
  index: number;
};

export default function Scene({ scene, index }: Props) {
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const ctx = gsap.context(() => {
      const reveal = gsap.timeline({
        scrollTrigger: {
          trigger: root.current,
          start: "top 72%",
          end: "top 30%",
          scrub: 0.7,
        },
      });
      reveal
        .from(".scene__kicker", { y: 30, opacity: 0, ease: "none" }, 0)
        .from(
          ".scene__title",
          { y: 48, opacity: 0, ease: "none" },
          0.05
        )
        .from(".scene__copy", { y: 36, opacity: 0, ease: "none" }, 0.12)
        .from(
          ".scene__chip",
          { y: 24, opacity: 0, stagger: 0.06, ease: "none" },
          0.18
        )
        .from(
          ".scene__visual",
          { y: 60, opacity: 0, scale: 0.96, ease: "none" },
          0
        );

      // start any in-view "writing" animations only when the beat arrives
      ScrollTrigger.create({
        trigger: root.current,
        start: "top 62%",
        once: true,
        onEnter: () =>
          root.current?.querySelector(".viz")?.classList.add("is-writing"),
      });

      // gentle parallax on the visual as the section travels through —
      // only on wide layouts. When the scene stacks (mobile/tablet) the
      // visual sits directly below the copy, so shifting it up would overlap
      // the text.
      const isStacked = window.matchMedia("(max-width: 860px)").matches;
      if (!isStacked) {
        gsap.to(".scene__visual", {
          yPercent: -12,
          ease: "none",
          scrollTrigger: {
            trigger: root.current,
            start: "top bottom",
            end: "bottom top",
            scrub: 1,
          },
        });
      }
    }, root);

    ScrollTrigger.refresh();
    return () => ctx.revert();
  }, []);

  const flip = index % 2 === 0;

  return (
    <section
      className={`scene${flip ? " scene--flip" : ""}`}
      id={scene.id}
      data-scene={index}
      ref={root}
      style={{ ["--glow" as string]: scene.glow }}
    >
      <div className="scene__text">
        {scene.kicker && <div className="scene__kicker">{scene.kicker}</div>}
        <h2 className="scene__title">
          {scene.title.split("\n").map((line) => (
            <span className="scene__title-line" key={line}>
              {line}
            </span>
          ))}
        </h2>
        <p className="scene__copy">{scene.copy}</p>
        {scene.chips && (
          <div className="scene__chips">
            {scene.chips.map((c) => (
              <span className="scene__chip" key={c}>
                {c}
              </span>
            ))}
          </div>
        )}
      </div>
      <div className="scene__visual">
        <SceneVisual scene={scene} />
      </div>
    </section>
  );
}
