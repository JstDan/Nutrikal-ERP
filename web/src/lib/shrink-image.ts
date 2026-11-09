/**
 * Photos are made smaller in the browser before they are uploaded (owner, Nov 2026: uploading photos from the phone
 * app failed): a phone photo is 5–15 MB, more than the server takes comfortably. The longest side becomes maxSide,
 * HEIC (iPhone) becomes JPEG, a picture with transparency (PNG, WebP) stays WebP so it keeps it. Small pictures,
 * GIFs, SVGs and every other file go as they are; a picture that cannot be read goes as it is too.
 */
/** photosOnly: only camera photos (JPEG, HEIC) are made smaller; PNG and WebP designs stay exactly as they are. */
export type ShrinkOptions = { maxSide?: number; quality?: number; minBytes?: number; photosOnly?: boolean };

const KEEP = /^image\/(gif|svg\+xml)$/;
const HEIC = (f: File) => /hei[cf]/i.test(f.type) || /\.hei[cf]$/i.test(f.name);

export async function shrinkImage(f: File, { maxSide = 2000, quality = 0.82, minBytes = 1_200_000, photosOnly = false }: ShrinkOptions = {}): Promise<File> {
  const heic = HEIC(f);
  if (!heic && (!f.type.startsWith("image/") || KEEP.test(f.type))) return f;
  if (!heic && photosOnly && f.type !== "image/jpeg") return f;
  if (!heic && f.size < minBytes) return f;
  try {
    let bmp: ImageBitmap;
    try {
      bmp = await createImageBitmap(f);
    } catch (e) {
      if (!heic) throw e;
      // Only Safari reads HEIC itself; elsewhere it is converted first (loaded only when needed)
      const { default: heic2any } = await import("heic2any");
      const jpeg = await heic2any({ blob: f, toType: "image/jpeg", quality: 0.9 });
      bmp = await createImageBitmap(Array.isArray(jpeg) ? jpeg[0] : jpeg);
    }
    const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    bmp.close();
    const alpha = /^image\/(png|webp)$/.test(f.type);
    const type = alpha ? "image/webp" : "image/jpeg";
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("encode"))), type, quality));
    // Nothing gained (a small, already compressed picture): the original goes
    if (!heic && blob.size >= f.size) return f;
    return new File([blob], f.name.replace(/\.[^.]+$/, "") + (alpha ? ".webp" : ".jpg"), { type: blob.type || type });
  } catch {
    return f;
  }
}

export const shrinkImages = (files: File[], o?: ShrinkOptions) => Promise.all(files.map((f) => shrinkImage(f, o)));
