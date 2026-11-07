// The contract card of an order: the open contract with its comments, earlier versions, the seller for the PDF,
// the private link and the proposed e-mail (row-level security: Admin and Sales).
import { headers } from "next/headers";
import { q } from "@/lib/db/engine";
import { fmt, getDict } from "@/lib/i18n";
import { loadSendInfo } from "@/lib/sends";
import { fillContractProducts, needsProducts } from "@/lib/contract-products";
import type { ContractSeller } from "@/lib/contract-model";
import type { CardComment, CardContract, CardVersion } from "@/components/contract-card";
import type { SendInfo } from "@/components/send-document";

export async function loadContractCard(userId: string, userName: string, orderId: string, orderCode: string) {
  const [k] = await q<CardContract>(userId,
    `select k.id, k.token, k.number, k.locale, k.body, k.schedule, k.status, k.version, k.accepted_at::text, k.accepted_name, k.accepted_title,
            k.accepted_email, k.accepted_ip, k.signed_at::text, k.created_at::text, c.legal_name as client,
            k.drive_url, k.drive_version, k.signed_url
       from order_contracts k join sales_orders so on so.id = k.order_id join clients c on c.id = so.client_id
      where k.order_id = $1 and k.status <> 'cancelled'`, [orderId]);
  const [s] = await q<{ name: string; address: string; email: string | null; phone: string | null; company_id: string | null; bg: { name: string; address: string } | null }>(userId,
    "select company_name as name, company_address as address, company_email as email, company_phone as phone, company_id, company_bg() as bg from calc_settings limit 1");
  const seller: ContractSeller = {
    name: (k?.locale === "bg" && s?.bg?.name) || s?.name || "", address: (k?.locale === "bg" && s?.bg?.address) || s?.address || "",
    email: s?.email ?? "", phone: s?.phone ?? "", companyId: s?.company_id ?? "",
  };
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "app.nutrikal.com";
  const link = k ? `${host.startsWith("localhost") ? "http" : "https"}://${host}/contract/${k.token}` : "";
  if (!k) return { k: null, comments: [], versions: [], seller, link, send: null };
  // A contract made before Schedule A named the products: filled once, while it can still change
  if (k.status !== "signed" && needsProducts(k.schedule.rows as never[])) {
    await fillContractProducts(userId, k.id).catch((e) => console.error("[contract products]", e));
    const [again] = await q<{ schedule: CardContract["schedule"] }>(userId, "select schedule from order_contracts where id = $1", [k.id]);
    if (again) k.schedule = again.schedule;
  }
  const comments = await q<CardComment>(userId,
    "select from_client, author_name, body, created_at::text, version from contract_comments where contract_id = $1 order by created_at", [k.id]);
  const versions = await q<CardVersion>(userId,
    `select version, created_at::text, case when accepted is null then null else jsonb_build_object('name', accepted ->> 'name', 'at', accepted ->> 'at') end as accepted
       from contract_versions where contract_id = $1 order by version desc`, [k.id]);
  const D = getDict(k.locale).contract;
  const info = await loadSendInfo(userId, userName, "contract", k.id, { orderId, title: D.pdf.title, no: k.number, lang: k.locale });
  const values = { no: k.number, code: orderCode, link, name: userName };
  const send: SendInfo = { ...info, subject: fmt(D.mailSubject, values), body: fmt(info.signed ? D.mailBodySigned : D.mailBody, values) };
  return { k, comments, versions, seller, link, send };
}
