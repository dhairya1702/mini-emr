import {
  createContext,
  useCallback,
  useContext,
  useRef,
  type ReactNode,
} from "react";
import { useNavigate } from "react-router-dom";
import { gsap } from "gsap";

const TransitionContext = createContext<{ go: (path: string) => void }>({
  go: () => {},
});

export const useTransition = () => useContext(TransitionContext);

/**
 * Cinematic vertical wipe between routes.
 * A full-screen panel slides up to cover the screen, we swap the route
 * behind it, then it continues up to reveal the new page.
 */
export function TransitionProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const panel = useRef<HTMLDivElement>(null);
  const animating = useRef(false);

  const go = useCallback(
    (path: string) => {
      if (animating.current || !panel.current) {
        navigate(path);
        return;
      }
      animating.current = true;
      const el = panel.current;

      const tl = gsap.timeline({
        onComplete: () => {
          animating.current = false;
        },
      });
      tl.set(el, { pointerEvents: "auto", display: "flex" })
        .fromTo(
          el,
          { yPercent: 100 },
          { yPercent: 0, duration: 0.55, ease: "power3.inOut" }
        )
        .fromTo(
          el.querySelector(".wipe__mark"),
          { opacity: 0, scale: 0.85 },
          { opacity: 1, scale: 1, duration: 0.3, ease: "power2.out" },
          "-=0.25"
        )
        .add(() => {
          navigate(path);
          window.scrollTo(0, 0);
        })
        .to(el.querySelector(".wipe__mark"), {
          opacity: 0,
          duration: 0.25,
          ease: "power2.in",
        })
        .to(el, {
          yPercent: -100,
          duration: 0.6,
          ease: "power3.inOut",
        })
        .set(el, { yPercent: 100, pointerEvents: "none", display: "none" });
    },
    [navigate]
  );

  return (
    <TransitionContext.Provider value={{ go }}>
      {children}
      <div className="wipe" ref={panel} aria-hidden>
        <span className="wipe__mark">
          Clinic<span className="nav__brand-thin">EMR</span>
        </span>
      </div>
    </TransitionContext.Provider>
  );
}
