// Development helper: runs the recording app (local demo database) until stopped.
import { BASE_URL, prepareWorktree, startServer } from "../lib/app-server.mjs";

prepareWorktree();
const server = await startServer();
console.log(`[onboarding] app on ${BASE_URL} (log ${server.log})`);
process.on("SIGINT", async () => { await server.stop(); process.exit(0); });
process.on("SIGTERM", async () => { await server.stop(); process.exit(0); });
await new Promise(() => {});
