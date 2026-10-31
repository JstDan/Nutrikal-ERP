import { q } from "@/lib/db/engine";
import { requireRole } from "@/lib/session";
import { fmt, formatDate, formatNumber } from "@/lib/i18n";
import { ActionForm } from "@/components/action-form";
import { Card, Fact, PageHeader } from "@/components/ui";
import { SettingsTabs } from "@/components/settings-tabs";
import { disconnectGmail, syncGmailNow } from "@/app/mail-actions";
import { gmailConfigured } from "@/lib/gmail";

/** The shared mailbox: connected once, read only. */
export default async function MailSettingsPage({ searchParams }: PageProps<"/settings/mail">) {
  const { user, locale, t } = await requireRole("admin");
  const S = t.adminSettings;
  const M = S.mail;
  const sp = await searchParams;
  const [g] = await q<{ email: string | null; last_sync_at: string | null; last_error: string | null; messages: string }>(
    user.id, "select email, last_sync_at::text, last_error, messages::text from gmail_status()");
  const error = typeof sp.error === "string" ? M.errors[sp.error as "failed"] ?? M.errors.failed : null;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={S.title} subtitle={S.subtitle} />
      <SettingsTabs t={t} active="mail" />
      <Card title={M.title} id="mail-h">
        <p className="m-0 text-sm text-ink-2">{M.note}</p>
        {error && <p role="alert" className="m-0 text-sm font-semibold text-red-ink">{error}</p>}
        {sp.connected === "1" && <p role="status" className="m-0 text-sm font-semibold text-green-ink">{M.connected}</p>}
        {!gmailConfigured() && <p className="m-0 text-sm font-semibold">{M.notConfigured}</p>}
        {g?.email ? (
          <>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Fact label={M.mailbox}><span className="break-all">{g.email}</span></Fact>
              <Fact label={M.lastSync}>{g.last_sync_at ? `${formatDate(locale, g.last_sync_at.slice(0, 10))} ${g.last_sync_at.slice(11, 16)}` : "—"}</Fact>
              <Fact label={M.saved}>{formatNumber(locale, g.messages)}</Fact>
            </div>
            {g.last_error && <p role="alert" className="m-0 text-sm font-semibold text-red-ink">{fmt(M.lastError, { error: g.last_error })}</p>}
            <div className="flex flex-wrap items-start gap-3">
              <ActionForm action={syncGmailNow} submitLabel={M.syncNow} resetOnSuccess={false}>{null}</ActionForm>
              <ActionForm action={disconnectGmail} submitLabel={M.disconnect} resetOnSuccess={false}>{null}</ActionForm>
            </div>
            <p className="m-0 text-xs text-ink-2">{M.disconnectNote}</p>
          </>
        ) : (
          gmailConfigured() && <a href="/api/google/start" className="btn btn-primary self-start">{M.connect}</a>
        )}
      </Card>
    </div>
  );
}
