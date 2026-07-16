import { useTransition } from "../transition-context";
import { trackAnalyticsEvent } from "../analytics";

export default function Nav() {
  const { go } = useTransition();
  return (
    <header className="nav">
      <a className="nav__brand" href="#top">
        <span className="nav__mark" aria-hidden>
          <span className="nav__pulse" />
        </span>
        Clinic<span className="nav__brand-thin">OS</span>
      </a>
      <nav className="nav__links">
        <a href="#ai">Scribe</a>
        <a href="#chart">Context</a>
        <a href="#queue">Assistance</a>
        <button
          className="nav__cta"
          onClick={() => {
            trackAnalyticsEvent("select_content", {
              content_type: "cta",
              content_id: "nav_request_access",
            });
            go("/early-access");
          }}
        >
          Request access
        </button>
      </nav>
    </header>
  );
}
