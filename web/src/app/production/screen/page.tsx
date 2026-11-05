import { redirect } from "next/navigation";
import { q } from "@/lib/db/engine";
import { requireRole, type ActAsTarget } from "@/lib/session";
import { openProductionScreen } from "@/app/actions";
import { Card, PageHeader } from "@/components/ui";
import { fmt } from "@/lib/i18n";

/** Admin: open the app as the partner facility sees it, and work in it as the production account (owner, Nov 2026). */
export default async function ProductionScreenPage() {
  const { user, t } = await requireRole("admin");
  if (user.access !== "admin") redirect("/");
  const S = t.productionScreen;
  const targets = await q<ActAsTarget>(user.id, "select id, full_name, email, role, locale from production_screen_targets()");

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={S.title} subtitle={S.subtitle} />
      <Card title={S.accounts} id="production-screen-h">
        <p className="m-0 text-sm text-ink-2">{S.note}</p>
        <p className="m-0 text-sm font-semibold">{S.warning}</p>
        {targets.length === 0 && <p className="m-0 text-sm">{S.none}</p>}
        {targets.map((x) => (
          <form key={x.id} action={openProductionScreen} className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2 border-t border-mist pt-3">
            <input type="hidden" name="user" value={x.id} />
            <span className="min-w-0 flex-[1_1_220px] text-sm">
              <span className="font-semibold break-words">{x.full_name}</span>
              <span className="block break-all text-ink-2">{x.email}</span>
            </span>
            <button type="submit" className="btn btn-primary">{fmt(S.open, { name: x.full_name })}</button>
          </form>
        ))}
      </Card>
    </div>
  );
}
