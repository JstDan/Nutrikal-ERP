// Windows only, for the Cloudflare build: creating directory symlinks
// needs admin rights or Developer Mode, junctions do not. OpenNext links
// the traced node_modules folders, so make those links junctions.
const fs = require("node:fs");
const path = require("node:path");
if (process.platform === "win32") {
  const original = fs.symlinkSync;
  fs.symlinkSync = function (target, linkPath, type) {
    const abs = path.resolve(path.dirname(String(linkPath)), String(target));
    if (!type && fs.existsSync(abs) && fs.statSync(abs).isDirectory()) return original.call(this, abs, linkPath, "junction");
    return original.call(this, target, linkPath, type);
  };
}
