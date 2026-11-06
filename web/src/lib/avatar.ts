// Profile photos: shared by the server and the browser. The picture of a
// person is always /api/avatar/{id}: their photo, or their initials on a colour.

export const AVATAR_BUCKET = "avatars";
export const AVATAR_COLOURS = ["#222831", "#4a5160", "#3b6fd8", "#8a5cd6", "#c2610f", "#1a8078"];
/** Square side of a stored photo (resized in the browser before upload). */
export const AVATAR_SIZE = 256;
export const AVATAR_MAX_BYTES = 2 * 1024 * 1024;

export const avatarColour = (id: string) => AVATAR_COLOURS[[...id].reduce((a, c) => a + c.charCodeAt(0), 0) % AVATAR_COLOURS.length];

export const avatarInitials = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("");

/** Address of a person's picture; v (the time of the last change) makes a new photo show at once. */
export const avatarUrl = (id: string, v?: string | null) => `/api/avatar/${id}${v ? `?v=${encodeURIComponent(v)}` : ""}`;
