/**
 * Shown the moment a page is opened, while the server prepares it (owner, Nov 2026: a faster phone app):
 * the menu stays, the content area shows its outline at once instead of the old page waiting.
 */
export default function Loading() {
  const bar = "nk-skel rounded-md bg-mist";
  return (
    <div role="status" aria-busy="true" className="flex flex-col gap-5">
      <span className="sr-only">…</span>
      <div className="flex flex-col gap-2">
        <div className={`${bar} h-7 w-[min(320px,70%)]`} />
        <div className={`${bar} h-4 w-[min(220px,50%)]`} />
      </div>
      <div className="card flex flex-col gap-3 p-4">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="flex items-center gap-3">
            <div className={`${bar} h-9 w-9 shrink-0 rounded-full`} />
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <div className={`${bar} h-3.5`} style={{ width: `${80 - i * 7}%` }} />
              <div className={`${bar} h-3 w-1/3`} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
