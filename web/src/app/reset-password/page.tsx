import { redirect } from "next/navigation";
import { setNewPassword } from "@/app/actions";
import { ActionForm } from "@/components/action-form";
import { Wordmark } from "@/components/logo";
import { getDict } from "@/lib/i18n";
import { getAuthUser, getLocale } from "@/lib/session";

/** Reached from the link in the e-mail, which has just signed the person in. */
export default async function ResetPasswordPage() {
  if (!(await getAuthUser())) redirect("/login");
  const t = getDict(await getLocale());
  return (
    <main className="grid min-h-screen place-items-center bg-canvas px-4 py-10">
      <div className="card flex w-full max-w-[420px] flex-col gap-6 p-6 sm:p-8">
        <Wordmark height={22} />
        <h1 className="m-0 text-2xl font-bold">{t.login.newPassword}</h1>
        <ActionForm action={setNewPassword} submitLabel={t.login.savePassword}>
          <label className="field"><span>{t.login.newPassword}</span><input name="password" type="password" autoComplete="new-password" required autoFocus className="input" /></label>
          <label className="field"><span>{t.login.repeatPassword}</span><input name="repeat" type="password" autoComplete="new-password" required className="input" /></label>
        </ActionForm>
      </div>
    </main>
  );
}
