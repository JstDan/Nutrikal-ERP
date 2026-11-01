import Link from "next/link";
import { requestPasswordReset } from "@/app/actions";
import { ActionForm } from "@/components/action-form";
import { Wordmark } from "@/components/logo";
import { getDict } from "@/lib/i18n";
import { getLocale } from "@/lib/session";

export default async function ForgotPasswordPage() {
  const t = getDict(await getLocale());
  return (
    <main className="grid min-h-screen place-items-center bg-canvas px-4 py-10">
      <div className="card flex w-full max-w-[420px] flex-col gap-6 p-6 sm:p-8">
        <Wordmark height={22} />
        <h1 className="m-0 text-2xl font-bold">{t.login.forgot}</h1>
        <p className="m-0 text-sm text-ink-2">{t.login.forgotNote}</p>
        <ActionForm action={requestPasswordReset} submitLabel={t.login.forgotSend}>
          <label className="field"><span>{t.login.email}</span><input name="email" type="email" autoComplete="username" required autoFocus className="input" /></label>
        </ActionForm>
        <Link href="/login" className="text-sm">{t.login.back}</Link>
      </div>
    </main>
  );
}
