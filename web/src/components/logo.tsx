/** NUTRIKAL wordmark (black on transparent). `inverted` shows it white for dark backgrounds.
 *  The "n" icon is the browser icon: web/src/app/icon.svg. */
export function Wordmark({ height = 20, inverted = false, className = "" }: { height?: number; inverted?: boolean; className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/nutrikal-wordmark.webp"
      alt="Nutrikal"
      width={650}
      height={70}
      style={{ height, width: "auto" }}
      className={`block max-w-full self-start ${inverted ? "brightness-0 invert" : "wordmark-auto"} ${className}`}
    />
  );
}
