import type { ReactNode } from "react";
import Link from "next/link";

// Nutri AI writes links as [label](/path), with paths copied from its tool results. Only paths inside the app become
// links (no other site, no "//"); anything else stays text. The page opened still checks the person's rights.
const LINK = /\[([^\]\n]{1,80})\]\((?:https:\/\/app\.nutrikal\.com)?(\/[A-Za-z0-9\-/]*(?:\?[A-Za-z0-9=&_-]*)?(?:#[A-Za-z0-9-]*)?)\)/g;

/** The text of an answer, with its links as buttons. */
export function AssistantText({ text, className, onNavigate }: { text: string; className: string; onNavigate?: () => void }) {
  const parts: ReactNode[] = [];
  let at = 0;
  for (const m of text.matchAll(LINK)) {
    const [whole, label, href] = m;
    if (href.startsWith("//")) continue;
    parts.push(text.slice(at, m.index));
    parts.push(
      <Link key={m.index} href={href} prefetch={false} onClick={onNavigate}
        className="mx-0.5 inline-flex min-h-9 items-center rounded-sm border border-line-strong bg-paper px-2 align-baseline font-semibold text-ink underline-offset-2 hover:underline">
        {label}
      </Link>,
    );
    at = m.index + whole.length;
  }
  parts.push(text.slice(at));
  return <p className={className}>{parts}</p>;
}
