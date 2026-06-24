export default function Footer() {
  return (
    <footer className="footer">
      <div className="footer__divider" />
      <div className="footer__inner">
        <div className="footer__compliance">
          <span className="footer__shield" aria-hidden>
            <svg viewBox="0 0 24 24" fill="none">
              <path
                d="M12 2.5 4.5 5.5v6c0 4.5 3.2 8.4 7.5 10 4.3-1.6 7.5-5.5 7.5-10v-6L12 2.5Z"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinejoin="round"
              />
              <path
                d="m8.5 12 2.5 2.5 4.5-5"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
          <p>
            Designed to support India's <strong>DPDP Act, 2023</strong>. Patient
            data is encrypted in transit and at rest, and is never used to train
            third-party AI models.
          </p>
        </div>
        <div className="footer__base">
          <span>
            © {new Date().getFullYear()} Clinic
            <span className="nav__brand-thin">EMR</span>
          </span>
          <span className="footer__note">
            This page is an early preview and not an offer of service.
          </span>
        </div>
      </div>
    </footer>
  );
}
