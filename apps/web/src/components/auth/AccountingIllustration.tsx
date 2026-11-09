/**
 * Professional accounting/finance illustration for the auth panel.
 * Uses currentColor inheritance so it adapts to the auth-panel foreground.
 */
export function AccountingIllustration({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 400 300" fill="none" className={className} aria-hidden="true">
      {/* Ledger / open book */}
      <rect x="60" y="120" width="160" height="120" rx="4" fill="currentColor" fillOpacity="0.08" stroke="currentColor" strokeOpacity="0.2" strokeWidth="1.5" />
      <line x1="140" y1="120" x2="140" y2="240" stroke="currentColor" strokeOpacity="0.15" strokeWidth="1" />
      {/* Ledger lines — left page */}
      <line x1="75" y1="145" x2="128" y2="145" stroke="currentColor" strokeOpacity="0.18" strokeWidth="1" />
      <line x1="75" y1="160" x2="120" y2="160" stroke="currentColor" strokeOpacity="0.13" strokeWidth="1" />
      <line x1="75" y1="175" x2="125" y2="175" stroke="currentColor" strokeOpacity="0.18" strokeWidth="1" />
      <line x1="75" y1="190" x2="110" y2="190" stroke="currentColor" strokeOpacity="0.13" strokeWidth="1" />
      <line x1="75" y1="205" x2="128" y2="205" stroke="currentColor" strokeOpacity="0.18" strokeWidth="1" />
      <line x1="75" y1="220" x2="115" y2="220" stroke="currentColor" strokeOpacity="0.13" strokeWidth="1" />
      {/* Ledger lines — right page */}
      <line x1="152" y1="145" x2="205" y2="145" stroke="currentColor" strokeOpacity="0.18" strokeWidth="1" />
      <line x1="152" y1="160" x2="198" y2="160" stroke="currentColor" strokeOpacity="0.13" strokeWidth="1" />
      <line x1="152" y1="175" x2="205" y2="175" stroke="currentColor" strokeOpacity="0.18" strokeWidth="1" />
      <line x1="152" y1="190" x2="190" y2="190" stroke="currentColor" strokeOpacity="0.13" strokeWidth="1" />
      <line x1="152" y1="205" x2="205" y2="205" stroke="currentColor" strokeOpacity="0.18" strokeWidth="1" />
      <line x1="152" y1="220" x2="195" y2="220" stroke="currentColor" strokeOpacity="0.13" strokeWidth="1" />

      {/* Bar chart */}
      <rect x="260" y="175" width="22" height="65" rx="3" fill="currentColor" fillOpacity="0.25" />
      <rect x="290" y="145" width="22" height="95" rx="3" fill="currentColor" fillOpacity="0.35" />
      <rect x="320" y="160" width="22" height="80" rx="3" fill="currentColor" fillOpacity="0.2" />
      <rect x="350" y="130" width="22" height="110" rx="3" fill="currentColor" fillOpacity="0.3" />
      {/* Chart baseline */}
      <line x1="252" y1="240" x2="380" y2="240" stroke="currentColor" strokeOpacity="0.2" strokeWidth="1.5" />

      {/* Trend line across chart */}
      <polyline
        points="271,170 301,140 331,155 361,125"
        stroke="currentColor"
        strokeOpacity="0.5"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      {/* Trend dot */}
      <circle cx="361" cy="125" r="3.5" fill="currentColor" fillOpacity="0.5" />

      {/* Floating document / invoice */}
      <g transform="translate(240, 40)">
        <rect width="90" height="70" rx="4" fill="currentColor" fillOpacity="0.07" stroke="currentColor" strokeOpacity="0.18" strokeWidth="1.2" />
        <line x1="14" y1="18" x2="56" y2="18" stroke="currentColor" strokeOpacity="0.25" strokeWidth="1.2" />
        <line x1="14" y1="30" x2="76" y2="30" stroke="currentColor" strokeOpacity="0.15" strokeWidth="1" />
        <line x1="14" y1="40" x2="70" y2="40" stroke="currentColor" strokeOpacity="0.15" strokeWidth="1" />
        <line x1="14" y1="50" x2="50" y2="50" stroke="currentColor" strokeOpacity="0.15" strokeWidth="1" />
        {/* Checkmark */}
        <polyline points="60,48 66,54 78,42" stroke="currentColor" strokeOpacity="0.4" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      </g>

      {/* Coin / currency circle */}
      <circle cx="100" cy="80" r="28" fill="currentColor" fillOpacity="0.06" stroke="currentColor" strokeOpacity="0.18" strokeWidth="1.5" />
      <text x="100" y="87" textAnchor="middle" fill="currentColor" fillOpacity="0.3" fontSize="22" fontWeight="600" fontFamily="inherit">
        &euro;
      </text>

      {/* Small decorative dots */}
      <circle cx="185" cy="70" r="2.5" fill="currentColor" fillOpacity="0.12" />
      <circle cx="200" cy="60" r="2" fill="currentColor" fillOpacity="0.1" />
      <circle cx="175" cy="55" r="1.5" fill="currentColor" fillOpacity="0.08" />
    </svg>
  );
}
