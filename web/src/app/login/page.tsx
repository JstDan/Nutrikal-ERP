import { redirect } from "next/navigation";
import { setLocale, signIn, signOut } from "@/app/actions";
import { ActionForm } from "@/components/action-form";
import { Wordmark } from "@/components/logo";
import { getAuthUser, getLocale, getOptionalSession, homeFor } from "@/lib/session";
import { getDict, LOCALES } from "@/lib/i18n";

export default async function LoginPage() {
  const session = await getOptionalSession();
  if (session) redirect(homeFor(session.user.role));
  const locale = await getLocale();
  const t = getDict(locale);
  // Signed in to Supabase, but no active profile in the app
  const noAccess = !!(await getAuthUser());

  return (
    <main className="grid min-h-screen place-items-center bg-canvas px-4 py-10">
      <div className="card flex w-full max-w-[420px] flex-col gap-6 p-6 sm:p-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex flex-col gap-2">
            <Wordmark height={22} />
            <span className="text-xs font-semibold tracking-[2px] text-ink-2">{t.login.subtitle.toUpperCase()}</span>
          </div>
          <form action={setLocale} role="group" aria-label={t.topbar.language} className="flex overflow-hidden rounded-sm border border-line-strong">
            {LOCALES.map((l) => (
              <button
                key={l}
                type="submit"
                name="locale"
                value={l}
                aria-pressed={locale === l}
                lang={l}
                title={t.enums.locale[l]}
                className={`h-11 min-w-12 border-0 text-xs font-semibold tracking-[1.5px] ${locale === l ? "bg-ink text-white" : "bg-white text-ink-2 hover:bg-canvas"}`}
              >
                {l === "bg" ? "БГ" : "EN"}
              </button>
            ))}
          </form>
        </div>
        <h1 className="m-0 text-2xl font-bold">{t.login.title}</h1>
        {noAccess ? (
          <form action={signOut} className="flex flex-col gap-4">
            <p role="alert" className="m-0 text-sm font-semibold text-red-ink">{t.login.noAccess}</p>
            <button type="submit" className="btn btn-outline self-start">{t.login.signOut}</button>
          </form>
        ) : (
          <ActionForm action={signIn} submitLabel={t.login.submit} resetOnSuccess={false}>
            <label className="field">
              <span>{t.login.email}</span>
              <input name="email" type="email" autoComplete="username" required autoFocus className="input" />
            </label>
            <label className="field">
              <span>{t.login.password}</span>
              <input name="password" type="password" autoComplete="current-password" required className="input" />
            </label>
          </ActionForm>
        )}
        <p className="m-0 text-xs text-ink-2">{t.login.help}</p>
      </div>
    </main>
  );
}
