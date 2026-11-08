"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { memeTemplates, type MemeTemplate } from "@/app/chat-actions";
import { fuzzyMatch } from "@/lib/fuzzy";

type Text = {
  memeTitle: string; memeSearch: string; memeOwn: string; memeTop: string; memeBottom: string; memeAdd: string;
  memeBack: string; memeNone: string; memeLoading: string; memePowered: string; close: string;
};

const MAX_W = 800;

/** The words of a meme: white capitals with a black outline, wrapped to the picture, at the top or the bottom. */
function drawText(ctx: CanvasRenderingContext2D, text: string, w: number, h: number, top: boolean) {
  const words = text.trim().toUpperCase().split(/\s+/).filter(Boolean);
  if (!words.length) return;
  let size = Math.round(w / 9);
  const lines: string[] = [];
  // Smaller letters until the text fits in at most three lines
  for (; size > 14; size -= 2) {
    ctx.font = `900 ${size}px Impact, "Anton", "Arial Black", sans-serif`;
    lines.length = 0;
    let line = "";
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (ctx.measureText(next).width > w - 24 && line) { lines.push(line); line = word; } else line = next;
    }
    lines.push(line);
    if (lines.length <= 3 && lines.every((l) => ctx.measureText(l).width <= w - 24)) break;
  }
  ctx.textAlign = "center";
  ctx.lineJoin = "round";
  ctx.lineWidth = Math.max(2, size / 7);
  ctx.strokeStyle = "#000";
  ctx.fillStyle = "#fff";
  const lh = size * 1.08;
  lines.forEach((l, i) => {
    const y = top ? 12 + size + i * lh : h - 14 - (lines.length - 1 - i) * lh;
    ctx.strokeText(l, w / 2, y);
    ctx.fillText(l, w / 2, y);
  });
}

/** Memes in the chat (owner, Nov 2026): a template or one's own picture, words on top and bottom, added to the message. */
export function MemeMaker({ T, onAdd, onClose }: { T: Text; onAdd: (file: File) => void; onClose: () => void }) {
  const [list, setList] = useState<MemeTemplate[] | null>(null);
  const [find, setFind] = useState("");
  const [src, setSrc] = useState<string | null>(null);
  const [top, setTop] = useState("");
  const [bottom, setBottom] = useState("");
  const canvas = useRef<HTMLCanvasElement>(null);
  const image = useRef<HTMLImageElement | null>(null);
  const own = useRef<HTMLInputElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => { memeTemplates().then(setList).catch(() => setList([])); }, []);
  const shown = useMemo(() => (list ?? []).filter((m) => !find.trim() || fuzzyMatch(m.name, find)).slice(0, 60), [list, find]);

  // The picture is loaded once; the words are drawn again on every key
  useEffect(() => {
    if (!src) return;
    setReady(false);
    const img = new Image();
    img.onload = () => { image.current = img; setReady(true); };
    img.src = src;
  }, [src]);
  useEffect(() => {
    const img = image.current, c = canvas.current;
    if (!ready || !img || !c) return;
    const scale = Math.min(1, MAX_W / img.naturalWidth);
    c.width = Math.round(img.naturalWidth * scale);
    c.height = Math.round(img.naturalHeight * scale);
    const ctx = c.getContext("2d")!;
    ctx.drawImage(img, 0, 0, c.width, c.height);
    drawText(ctx, top, c.width, c.height, true);
    drawText(ctx, bottom, c.width, c.height, false);
  }, [ready, top, bottom]);

  const add = () => canvas.current?.toBlob((b) => { if (b) onAdd(new File([b], "meme.jpg", { type: "image/jpeg" })); }, "image/jpeg", 0.9);

  return (
    <div role="dialog" aria-label={T.memeTitle} className="flex max-h-[70vh] flex-col gap-2 overflow-y-auto rounded-xl border border-line bg-paper p-3 shadow-xl">
      <div className="flex items-center gap-2">
        <strong className="flex-1 text-sm">{T.memeTitle}</strong>
        <button type="button" onClick={onClose} aria-label={T.close} className="grid h-9 w-9 place-items-center rounded-md text-lg text-ink-2 hover:bg-mist">×</button>
      </div>
      {!src ? (
        <>
          <div className="flex gap-2">
            <label htmlFor="meme-find" className="sr-only">{T.memeSearch}</label>
            <input id="meme-find" type="search" value={find} onChange={(e) => setFind(e.target.value)} placeholder={T.memeSearch} className="input min-w-0 flex-1" autoFocus />
            <input ref={own} type="file" accept="image/png,image/jpeg,image/webp" hidden aria-label={T.memeOwn}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) setSrc(URL.createObjectURL(f)); e.target.value = ""; }} />
            <button type="button" onClick={() => own.current?.click()} className="min-h-11 shrink-0 rounded-md border border-line-strong px-3 text-xs font-semibold hover:bg-mist">{T.memeOwn}</button>
          </div>
          {list === null ? <p className="m-0 text-sm text-ink-2">{T.memeLoading}</p>
            : shown.length === 0 ? <p className="m-0 text-sm text-ink-2">{T.memeNone}</p> : (
              <div className="grid grid-cols-3 gap-1.5">
                {shown.map((m) => (
                  <button key={m.id} type="button" title={m.name} aria-label={m.name}
                    onClick={() => { setSrc(`/api/meme-image?u=${encodeURIComponent(m.url)}`); setTop(""); setBottom(""); }}
                    className="overflow-hidden rounded-md border border-line hover:border-ink">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={m.url} alt="" loading="lazy" className="block aspect-square w-full object-cover" />
                  </button>
                ))}
              </div>
            )}
          <p className="m-0 text-right text-[10px] font-semibold tracking-[1px] text-ink-2 uppercase">{T.memePowered}</p>
        </>
      ) : (
        <>
          <canvas ref={canvas} className="block h-auto w-full rounded-md bg-mist" aria-label={T.memeTitle} />
          <label className="flex flex-col gap-1 text-xs font-semibold">{T.memeTop}
            <input value={top} onChange={(e) => setTop(e.target.value)} maxLength={120} className="input" autoFocus />
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold">{T.memeBottom}
            <input value={bottom} onChange={(e) => setBottom(e.target.value)} maxLength={120} className="input" />
          </label>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => { setSrc(null); setReady(false); }} className="min-h-11 rounded-md border border-line-strong px-3 text-sm font-semibold hover:bg-mist">{T.memeBack}</button>
            <button type="button" disabled={!ready} onClick={add} className="ml-auto min-h-11 rounded-md bg-[#007a5a] px-4 text-sm font-semibold text-white hover:bg-[#148567] disabled:opacity-50">{T.memeAdd}</button>
          </div>
        </>
      )}
    </div>
  );
}
