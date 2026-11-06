"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Dict } from "@/lib/i18n/en";
import { removeAvatar, uploadAvatar } from "@/app/avatar-actions";
import { AVATAR_SIZE } from "@/lib/avatar";
import { UserAvatar } from "@/components/user-avatar";

/** A picture cut to a centred square and made small in the browser, as WebP (JPEG where WebP is missing). */
async function squareImage(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = AVATAR_SIZE;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, AVATAR_SIZE, AVATAR_SIZE);
  const blob = (type: string) => new Promise<Blob | null>((r) => canvas.toBlob(r, type, 0.88));
  const webp = await blob("image/webp");
  return webp?.type === "image/webp" ? webp : (await blob("image/jpeg"))!;
}

/** Shows a person's picture with Upload / Remove. */
export function AvatarEditor({ userId, name, version, hasPhoto, T }: {
  userId: string; name: string; version: string | null; hasPhoto: boolean; T: Dict["avatar"];
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const pick = (file: File | undefined) => file && start(async () => {
    setError(null);
    try {
      const blob = await squareImage(file);
      const fd = new FormData();
      fd.set("user_id", userId);
      fd.set("file", new File([blob], blob.type === "image/webp" ? "avatar.webp" : "avatar.jpg", { type: blob.type }));
      const r = await uploadAvatar(fd);
      if (r.error) setError(r.error); else router.refresh();
    } catch {
      setError(T.invalid);
    }
  });
  return (
    <div className="flex flex-wrap items-center gap-4">
      <UserAvatar id={userId} v={version} size={72} title={name} />
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap gap-2">
          <label className={`btn btn-outline cursor-pointer ${pending ? "pointer-events-none opacity-60" : ""}`}>
            {hasPhoto ? T.change : T.upload}
            <input type="file" accept="image/png,image/jpeg,image/webp,image/heic" className="sr-only" disabled={pending}
              onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; pick(f); }} />
          </label>
          {hasPhoto && (
            <button type="button" className="btn btn-outline" disabled={pending}
              onClick={() => start(async () => { const r = await removeAvatar(userId); if (r.error) setError(r.error); else router.refresh(); })}>
              {T.remove}
            </button>
          )}
        </div>
        <p className="m-0 text-xs text-ink-2">{pending ? T.saving : T.hint}</p>
        {error && <p role="alert" className="m-0 text-sm font-semibold text-red-ink">{error}</p>}
      </div>
    </div>
  );
}
