import { ActionForm } from "@/components/action-form";
import { Card, PageHeader } from "@/components/ui";
import { changePortalPassword } from "@/app/portal/actions";
import { getPortalSession } from "@/lib/session";

export default async function PortalAccount() {
  const { t } = await getPortalSession();
  const A = t.portal.account;
  return (
    <>
      <PageHeader title={A.title} />
      <Card title={A.newPassword}>
        <ActionForm action={changePortalPassword} submitLabel={A.save} className="max-w-[420px]">
          <label className="field"><span>{A.newPassword}</span><input name="password" type="password" autoComplete="new-password" required className="input" /></label>
          <label className="field"><span>{A.repeat}</span><input name="repeat" type="password" autoComplete="new-password" required className="input" /></label>
        </ActionForm>
      </Card>
    </>
  );
}
