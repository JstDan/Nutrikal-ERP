// Server stand-in for libraries that only ever run in the browser (PDF
// export, HEIC photo conversion). Used in the Cloudflare build (see
// next.config.ts) to keep them out of the Worker, which has a size limit.
function browserOnly(): never {
  throw new Error("Browser-only library called on the server");
}
export class jsPDF {
  constructor() {
    browserOnly();
  }
}
export default browserOnly;
