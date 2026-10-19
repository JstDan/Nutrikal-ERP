/** Nutrikal "n" mark. Vector redraw of the brand icon; replace with the original artwork when available. */
export function LogoMark({ size = 32, inverted = false, className = "" }: { size?: number; inverted?: boolean; className?: string }) {
  const box = inverted ? "#ffffff" : "#222831";
  const n = inverted ? "#222831" : "#ffffff";
  return (
    <svg width={size} height={size} viewBox="0 0 720 720" aria-hidden="true" className={`shrink-0 ${className}`}>
      <rect width="720" height="720" rx="130" fill={box} />
      <path
        d="M88 580V340C88 200 200 135 360 135S632 200 632 340V580H465V330C465 285 440 258 395 258H325C280 258 255 285 255 330V580Z"
        fill={n}
      />
    </svg>
  );
}
