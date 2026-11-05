import { q } from "@/lib/db/engine";
import { requireRole } from "@/lib/session";
import { cleanSignature } from "@/lib/signature";
import { Card, PageHeader } from "@/components/ui";
import { SignatureEditor } from "@/components/signature-editor";

/** One's own e-mail signature, put under the documents one sends (everyone except Production). */
export default async function SignaturePage() {
  const { user, t } = await requireRole("admin", "sales", "bookkeeper", "accountant", "designer");
  const S = t.signature;
  const [row] = await q<{ html: string }>(user.id, "select html from mail_signatures where user_id = auth.uid()");

  return (
    <div className="flex max-w-[860px] flex-col gap-6">
      <PageHeader title={S.title} subtitle={S.subtitle} />
      <Card title={user.name}>
        <p className="m-0 text-sm text-ink-2">{S.note}</p>
        <SignatureEditor userId={user.id} initial={cleanSignature(row?.html ?? "")} text={S} label={S.title} />
      </Card>
    </div>
  );
}
