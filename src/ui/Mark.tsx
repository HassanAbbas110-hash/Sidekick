// The split-S mark, drawn inline so it can animate: the two halves close together once on load.
export function Mark({ size = 32, animate = false }: { size?: number; animate?: boolean }) {
  return (
    <svg className={`mark${animate ? ' mark-in' : ''}`} viewBox="120 104 272 304" width={size} height={size * 304 / 272} aria-hidden>
      <defs>
        <linearGradient id="mark-gold" gradientUnits="userSpaceOnUse" x1="180" y1="120" x2="330" y2="260">
          <stop offset="0" stopColor="#F8DDA0" /><stop offset="1" stopColor="#D99A2B" />
        </linearGradient>
      </defs>
      <g fill="none" strokeWidth="46">
        <g className="mark-top">
          <path d="M311.4 160 A64 64 0 1 0 249 256" stroke="url(#mark-gold)" />
          <circle cx="311.4" cy="160" r="23" fill="url(#mark-gold)" stroke="none" />
        </g>
        <g className="mark-bottom">
          <path d="M263 256 A64 64 0 1 1 200.6 352" stroke="#F4EFE6" />
          <circle cx="200.6" cy="352" r="23" fill="#F4EFE6" stroke="none" />
        </g>
      </g>
    </svg>
  );
}
