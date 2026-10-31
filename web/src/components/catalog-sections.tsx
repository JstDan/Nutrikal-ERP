import { CatalogVideo } from "@/components/catalog-browser";
import type { Dict } from "@/lib/i18n/en";

const SITE = "/catalog/site";
const PRESENTATION = `${SITE}/Nutrikal-Company-Presentation.pdf`;
const CERTIFICATES = `${SITE}/Nutrikal-GMP-HACCP-Certificates.pdf`;
const light = "inline-flex min-h-11 items-center justify-center rounded-full bg-[#fff] px-6 text-sm font-semibold text-[#222831] no-underline";
const outline = "inline-flex min-h-11 items-center justify-center rounded-full border border-side-muted px-6 text-sm font-semibold text-side-strong no-underline";
const eyebrow = "m-0 font-mono text-xs tracking-[2px] uppercase";

/** Who makes it: video, capabilities, brands, certificates and contact. */
export function CatalogCompany({ text }: { text: Dict["publicCatalog"] }) {
  const T = text;
  return (
    <>
      <section id="about" className="scroll-mt-16 border-t border-line bg-paper">
        <div className="mx-auto grid max-w-[1200px] grid-cols-1 items-center gap-8 px-4 py-10 lg:grid-cols-2">
          <div className="flex min-w-0 flex-col gap-3">
            <h2 className="m-0 text-2xl font-bold">{T.aboutTitle}</h2>
            <p className="m-0 text-ink-2">{T.aboutText}</p>
            <p className="m-0 text-ink-2">{T.aboutText2}</p>
            <a href={PRESENTATION} target="_blank" rel="noopener" className="btn btn-outline self-start">{T.heroPresentation}</a>
          </div>
          <CatalogVideo title={T.videoTitle} />
        </div>
      </section>

      <section aria-label={T.capabilitiesTitle} className="bg-canvas">
        <div className="mx-auto flex max-w-[1200px] flex-col gap-5 px-4 py-10">
          <h2 className="m-0 text-2xl font-bold">{T.capabilitiesTitle}</h2>
          <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {T.capabilities.map((c) => (
              <div key={c.title} className="flex min-w-0 flex-col gap-2 rounded-lg bg-green-tint p-4">
                <h3 className="m-0 font-mono text-sm font-semibold tracking-[1px] uppercase">{c.title}</h3>
                <ul className="m-0 flex list-disc flex-col gap-1 pl-4 text-sm">{c.items.map((i) => <li key={i}>{i}</li>)}</ul>
              </div>
            ))}
          </div>
          <div className="flex min-w-0 flex-col gap-2 pt-2">
            <p className="m-0 text-sm text-ink-2">{T.brands}</p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`${SITE}/brands.webp`} alt={T.brandsAlt} loading="lazy" className="w-full rounded-lg bg-[#fff]" />
          </div>
        </div>
      </section>

      <section id="certificates" className="scroll-mt-16 border-t border-line bg-paper">
        <div className="mx-auto flex max-w-[1200px] flex-col gap-5 px-4 py-10">
          <div className="flex min-w-0 flex-col gap-2">
            <h2 className="m-0 text-2xl font-bold">{T.certificatesTitle}</h2>
            <p className="m-0 max-w-[720px] text-ink-2">{T.certificatesText}</p>
          </div>
          <div className="grid min-w-0 grid-cols-1 gap-4 md:grid-cols-2">
            {[{ img: "cert-gmp", name: T.certGmp, no: "BG450010GMP" }, { img: "cert-haccp", name: T.certHaccp, no: "BG850010H" }].map((c) => (
              <a key={c.no} href={CERTIFICATES} target="_blank" rel="noopener" className="flex min-w-0 gap-4 rounded-lg border border-line p-3 text-ink no-underline hover:bg-canvas">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`${SITE}/${c.img}.webp`} alt="" loading="lazy" className="h-40 w-auto shrink-0 rounded-sm border border-line" />
                <span className="flex min-w-0 flex-col gap-1 text-sm">
                  <span className="break-words font-bold">{c.name}</span>
                  <span className="text-ink-2">{T.certIssuer}</span>
                  <span className="text-ink-2">{c.no}</span>
                  <span className="text-ink-2">{T.certValid}</span>
                  <span className="mt-auto font-semibold underline">{T.certOpen}</span>
                </span>
              </a>
            ))}
          </div>
        </div>
      </section>

      <section id="contact" className="scroll-mt-16 bg-side text-side-strong">
        <div className="mx-auto flex max-w-[1200px] flex-col items-center gap-4 px-4 py-12 text-center">
          <p className={`${eyebrow} text-side-muted`}>{T.contactEyebrow}</p>
          <h2 className="m-0 max-w-[640px] text-3xl leading-tight font-bold">{T.contactTitle}</h2>
          <p className="m-0 max-w-[560px] text-side-text">{T.contactText}</p>
          <div className="flex flex-wrap justify-center gap-3 pt-1">
            <a href="mailto:sales@nutrikal.com" className={light}>sales@nutrikal.com</a>
            <a href="https://wa.me/359882919140" target="_blank" rel="noopener" className={outline}>WhatsApp</a>
          </div>
          <div className="flex flex-wrap justify-center gap-x-6 text-sm">
            <a href="tel:+359882919140" className="flex min-h-11 items-center text-side-text no-underline">{T.phoneEu}: +359 882 919 140</a>
            <a href="tel:+18888488534" className="flex min-h-11 items-center text-side-text no-underline">{T.phoneUs}: +1 (888) 848 8534</a>
          </div>
        </div>
      </section>
    </>
  );
}
