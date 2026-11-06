import { avatarUrl } from "@/lib/avatar";

/**
 * The round picture of a person: their photo, or their initials (served by /api/avatar).
 * Decorative by default: the name is always written next to it or in a label.
 */
export function UserAvatar({ id, size = 32, v, className = "", title }: { id: string; size?: number; v?: string | null; className?: string; title?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={avatarUrl(id, v)} alt="" title={title} width={size} height={size} loading="lazy" decoding="async"
      style={{ width: size, height: size }} className={`shrink-0 rounded-full bg-mist object-cover ${className}`} />
  );
}
