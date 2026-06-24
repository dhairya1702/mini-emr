import type { Scene } from "../scenes";

type Props = {
  scenes: Scene[];
  registerRef: (index: number, el: HTMLDivElement | null) => void;
};

/**
 * Fixed full-viewport stack of gradient layers, one per scene.
 * Layers are crossfaded by GSAP ScrollTrigger in App.tsx.
 * Two slow-drifting glow orbs sit on top for cinematic life.
 */
export default function Backdrop({ scenes, registerRef }: Props) {
  return (
    <div className="backdrop" aria-hidden>
      {scenes.map((scene, i) => (
        <div
          key={scene.id}
          className="backdrop__layer"
          ref={(el) => registerRef(i, el)}
          style={{ background: scene.background }}
        />
      ))}
      <div className="backdrop__orb backdrop__orb--a" />
      <div className="backdrop__orb backdrop__orb--b" />
      <div className="backdrop__vignette" />
    </div>
  );
}
