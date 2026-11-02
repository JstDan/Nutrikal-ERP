// Reads onboarding/storyboard.md: one "## <video>" section per video with a
// table | id | Български | English |. The scripts refer to the steps by id,
// so the text can be edited in the storyboard without touching code.
import fs from "node:fs";
import path from "node:path";
import { ONBOARDING } from "./app-server.mjs";

export function loadStoryboard(file = path.join(ONBOARDING, "storyboard.md")) {
  const videos = {};
  let current = null;
  for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    const h = /^##\s+([a-z-]+)\b/.exec(line);
    if (h) { current = videos[h[1]] = {}; continue; }
    if (!current || !line.startsWith("|")) continue;
    const cells = line.slice(1, line.endsWith("|") ? -1 : undefined).split("|").map((c) => c.trim());
    if (cells.length < 3 || /^-+$/.test(cells[0]) || cells[0] === "id") continue;
    const id = cells[0].replace(/`/g, "");
    current[id] = { bg: cells[1].replace(/\\\|/g, "|"), en: cells[2].replace(/\\\|/g, "|") };
  }
  return videos;
}
