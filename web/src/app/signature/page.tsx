import { q } from "@/lib/db/engine";
import { requireRole } from "@/lib/session";
import { cleanSignature } from "@/lib/signature";
import { Card, PageHeader } from "@/components/ui";
import { SignatureEditor } from "@/components/signature-editor";
import { AvatarEditor } from "@/components/avatar-editor";

/** One's own photo and e-mail signature, put under the documents one sends (everyone except Production). */
export default async function SignaturePage() {
  const { user, t } = await requireRole("admin", "sales", "bookkeeper", "accountant", "designer");
  const S = t.signature;
  const [row] = await q<{ html: string }>(user.id, "select html from mail_signatures where user_id = auth.uid()");
  const [me] = await q<{ avatar_path: string | null; avatar_updated_at: string | null }>(user.id,
    "select avatar_path, avatar_updated_at::text from avatar_of(auth.uid())");

  return (
    <div className="flex max-w-[860px] flex-col gap-6">
      <PageHeader title={t.avatar.profile} subtitle={user.name} />
      {!user.readOnly && (
        <Card title={t.avatar.title}>
          <AvatarEditor userId={user.id} name={user.name} version={me?.avatar_updated_at ?? null} hasPhoto={!!me?.avatar_path} T={t.avatar} />
        </Card>
      )}
      <Card title={S.title}>
        <p className="m-0 text-sm text-ink-2">{S.subtitle}</p>
        <p className="m-0 text-sm text-ink-2">{S.note}</p>
        <SignatureEditor userId={user.id} initial={cleanSignature(row?.html ?? "")} text={S} label={S.title} />
      </Card>
    </div>
  );
}
