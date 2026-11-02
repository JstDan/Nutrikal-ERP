// Turns a raw recording into onboarding/out/<name>.mp4 (1920×1080, 30 fps,
// Bulgarian captions burned in) plus <name>.bg.srt, <name>.en.srt and
// <name>.captions.json (the caption data, ready for a later voiceover).
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import ffmpeg from "ffmpeg-static";
import { ONBOARDING } from "./app-server.mjs";

export const OUT = path.join(ONBOARDING, "out");

const stamp = (ms) => {
  const t = Math.max(0, Math.round(ms));
  const h = Math.floor(t / 3600000), m = Math.floor((t % 3600000) / 60000), s = Math.floor((t % 60000) / 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(t % 1000).padStart(3, "0")}`;
};

/** Long captions are split into two lines near the middle. */
const wrap = (text, max = 70) => {
  if (text.length <= max) return text;
  const mid = text.length / 2;
  let best = -1;
  for (let i = 0; i < text.length; i++) if (text[i] === " " && (best < 0 || Math.abs(i - mid) < Math.abs(best - mid))) best = i;
  return best < 0 ? text : `${text.slice(0, best)}\n${text.slice(best + 1)}`;
};

export const srt = (cues, lang) =>
  cues.filter((c) => c.end - c.start > 300)
    .map((c, i) => `${i + 1}\n${stamp(c.start)} --> ${stamp(c.end)}\n${wrap(c[lang])}\n`).join("\n");

export function stitch({ name, video, cues }) {
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, `${name}.bg.srt`), srt(cues, "bg"));
  fs.writeFileSync(path.join(OUT, `${name}.en.srt`), srt(cues, "en"));
  fs.writeFileSync(path.join(OUT, `${name}.captions.json`), JSON.stringify(cues.map(({ id, start, end, bg, en }) => ({
    step: id, start_ms: start, end_ms: end, caption_bg: bg, caption_en: en })), null, 2));
  const style = "FontName=Arial,FontSize=20,PrimaryColour=&H00FFFFFF,BackColour=&HB0312822,BorderStyle=4,Outline=0,Shadow=0,MarginV=36";
  // Run in OUT so the subtitles filter gets a plain relative file name (no drive letter to escape)
  execFileSync(ffmpeg, [
    "-y", "-hide_banner", "-loglevel", "error", "-i", video,
    "-vf", `fps=30,scale=1920:1080,subtitles=${name}.bg.srt:force_style='${style}'`,
    "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an",
    `${name}.mp4`,
  ], { cwd: OUT, stdio: "inherit" });
  return path.join(OUT, `${name}.mp4`);
}
