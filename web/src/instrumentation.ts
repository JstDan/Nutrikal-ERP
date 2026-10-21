// Runs once when the server starts.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startPriceTimer } = await import("./lib/calculator/price-timer");
    startPriceTimer();
  }
}
