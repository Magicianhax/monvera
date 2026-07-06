// iPhone-style chrome overlaid on a marketing phone: a Dynamic Island + a status
// bar with the clock and cellular / Wi-Fi / battery glyphs. Goes inside
// `.phone-screen` (the embedded app gets extra top padding so it clears this).
export function PhoneChrome() {
  return (
    <div className="phone-chrome" aria-hidden>
      <span className="phone-island" />
      <div className="phone-status">
        <span className="phone-time">9:41</span>
        <span className="phone-sys">
          <svg viewBox="0 0 18 12" className="ic" fill="currentColor">
            <rect x="0" y="8" width="3" height="4" rx="1" />
            <rect x="5" y="5.5" width="3" height="6.5" rx="1" />
            <rect x="10" y="3" width="3" height="9" rx="1" />
            <rect x="15" y="0.5" width="3" height="11.5" rx="1" />
          </svg>
          <svg viewBox="0 0 16 12" className="ic" fill="currentColor">
            <path d="M8 2C5 2 2.3 3.2 0.4 5.1L2 6.8C3.6 5.3 5.7 4.4 8 4.4s4.4.9 6 2.4l1.6-1.7C13.7 3.2 11 2 8 2z" />
            <path d="M8 6.4c-1.6 0-3.1.6-4.2 1.7l1.6 1.7C6 9 6.9 8.6 8 8.6s2 .4 2.6 1.2l1.6-1.7C11.1 7 9.6 6.4 8 6.4z" />
            <circle cx="8" cy="11" r="1.1" />
          </svg>
          <svg viewBox="0 0 27 13" className="ic ic-batt" fill="none">
            <rect x="0.6" y="0.6" width="22.8" height="11.8" rx="3.4" stroke="currentColor" strokeOpacity="0.45" />
            <rect x="2" y="2" width="18" height="9" rx="2" fill="currentColor" />
            <path d="M25.2 4.4c.9.3.9 3.9 0 4.2z" fill="currentColor" fillOpacity="0.45" />
          </svg>
        </span>
      </div>
    </div>
  );
}
