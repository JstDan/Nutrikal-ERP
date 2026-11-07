import type { Metadata } from "next";
import { qPublic } from "@/lib/db/engine";
import { fmt, formatDate, getDict } from "@/lib/i18n";
import type { ContractRow } from "@/lib/contract-model";
import { Wordmark } from "@/components/logo";
import { ContractBody } from "@/components/contract-body";
import { ContractPublic, type PublicComment } from "@/components/contract-public";

export const metadata: Metadata = { title: "Nutrikal · Contract", robots: { index: false, follow: false } };

type Data = ContractRow & {
  version: number; updated_at: string; comments: PublicComment[];
  seller: { name: string; address: string; email: string | null; phone: string | null; company_id: string | null };
};

/** A contract's private link: the client reads it, writes comments and accepts it, without signing in. */
export default async function ContractLinkPage({ params }: PageProps<"/contract/[token]">) {
  const { token } = await params;
  const valid = /^[0-9a-f-]{36}$/i.test(token);
  const [row] = valid ? await qPublic<{ d: Data | null }>("select contract_public($1) as d", [token]) : [];
  const k = row?.d ?? null;
  const C = getDict(k?.locale ?? "en").contract;
  return (
    <main className="mx-auto flex w-full max-w-[860px] flex-col gap-6 px-4 py-8 sm:px-6">
      <header className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-ink px-5 py-4 text-white">
        <Wordmark height={22} inverted />
        {k && <span className="text-sm font-semibold">{fmt(C.number, { no: k.number })} · {C.status[k.status as "sent"]}</span>}
      </header>
      {!k ? <p className="m-0 rounded-lg border border-line bg-white p-5 text-sm">{C.open.notAvailable}</p> : (
        <>
          <p className="m-0 text-sm text-ink-2">
            {C.open.intro}
            {k.version > 1 && <> · {fmt(C.open.updated, { date: formatDate(k.locale, k.updated_at), n: k.version })}</>}
          </p>
          <div className="rounded-lg border border-line bg-white p-5 shadow-sm sm:p-8"><ContractBody k={k} /></div>
          <ContractPublic token={token} k={k} comments={k.comments} C={C}
            seller={{ name: k.seller.name, address: k.seller.address, email: k.seller.email ?? "", phone: k.seller.phone ?? "", companyId: k.seller.company_id ?? "" }} />
        </>
      )}
    </main>
  );
}
