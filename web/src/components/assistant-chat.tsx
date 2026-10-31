"use client";

import { useEffect, useRef, useState, useTransition, type KeyboardEvent } from "react";
import Link from "next/link";
import { askAssistant, deleteConversation, saveProposal } from "@/app/assistant-actions";
import { ActionForm } from "@/components/action-form";
import { fmt, formatDate, formatNumber, formatPrice, type Locale } from "@/lib/i18n";
import type { Dict } from "@/lib/i18n/en";

export type ChatConversation = { id: string; title: string; created_at: string };
export type ChatLine = { id: string; role: "user" | "assistant"; content: string; model: string | null; created_at: string };
type ProposalLine = {
  sku: string; name: string; name_bg: string | null; amount: number; unit: string; base_unit: string; qty_per_pack: number;
  cost_per_pack: number | null; available: number | null; novel_food: string | null;
};
export type ChatProposal = {
  id: string; formula_id: string | null; created_at: string;
  recipe: { name: string; name_bg?: string; product_format: string; serving_size: number; servings_per_pack: number; description?: string };
  estimate: {
    lines: ProposalLine[]; mg_per_serving: number; mg_per_capsule: number | null; max_fill_mg: number | null; fits: boolean | null;
    materials_cost_per_pack: number | null; shell_cost_per_pack: number | null; prices_hidden: boolean; lines_without_price: number;
  };
};

/** A proposal with the system's figures; only a person saves it as a draft. */
function ProposalCard({ p, locale, A }: { p: ChatProposal; locale: Locale; A: Dict["assistant"] }) {
  const e = p.estimate;
  const name = locale === "bg" && p.recipe.name_bg ? p.recipe.name_bg : p.recipe.name;
  const total = e.materials_cost_per_pack == null ? null : e.materials_cost_per_pack + (e.shell_cost_per_pack ?? 0);
  const short = e.lines.filter((l) => (l.available ?? 0) < l.qty_per_pack);
  const risky = e.lines.filter((l) => !l.novel_food || !["not_novel", "authorised"].includes(l.novel_food));
  return (
    <div className="card flex min-w-0 flex-col gap-3 p-4">
      <div className="min-w-0">
        <span className="label">{A.proposal}</span>
        <h3 className="m-0 text-base font-bold break-words">{name}</h3>
        <p className="m-0 text-xs text-ink-2">{fmt(A.proposalServing, { size: formatNumber(locale, p.recipe.serving_size), servings: p.recipe.servings_per_pack })}</p>
      </div>
      <div className="flex flex-col">
        {e.lines.map((l) => (
          <div key={l.sku} className="row grid-cols-[minmax(0,1fr)_auto] border-b border-mist py-2 text-sm sm:grid-cols-[minmax(0,1fr)_110px_100px]">
            <span className="min-w-0 break-words">{locale === "bg" && l.name_bg ? l.name_bg : l.name}</span>
            <span className="text-right">{formatNumber(locale, l.amount)} {l.unit === "mcg" ? "µg" : l.unit}</span>
            <span className="hide-sm text-right text-ink-2">{l.cost_per_pack != null ? formatPrice(locale, l.cost_per_pack, "EUR", 2) : "—"}</span>
          </div>
        ))}
      </div>
      <div className="flex flex-col gap-1 text-sm">
        {!!e.shell_cost_per_pack && <div className="text-ink-2">{fmt(A.proposalShell, { cost: formatPrice(locale, e.shell_cost_per_pack, "EUR", 2) })}</div>}
        {total != null && <div><strong>{fmt(A.proposalCost, { cost: formatPrice(locale, total, "EUR", 2) })}</strong></div>}
        {e.prices_hidden && <div className="text-ink-2">{A.proposalNoPrices}</div>}
        {e.lines_without_price > 0 && !e.prices_hidden && <div className="font-semibold text-amber-ink">{fmt(A.proposalMissingPrices, { n: e.lines_without_price })}</div>}
        {e.mg_per_capsule != null && (
          <div className={e.fits ? "text-ink-2" : "font-semibold text-red-ink"}>
            {fmt(e.fits ? A.proposalFits : A.proposalNoFit, { mg: formatNumber(locale, e.mg_per_capsule), max: formatNumber(locale, e.max_fill_mg ?? 0) })}
          </div>
        )}
        {short.length > 0 && <div className="font-semibold text-amber-ink">{fmt(A.proposalShort, { names: short.map((l) => (locale === "bg" && l.name_bg ? l.name_bg : l.name)).join(", ") })}</div>}
        {risky.length > 0 && <div className="font-semibold text-amber-ink">{fmt(A.proposalNovel, { names: risky.map((l) => (locale === "bg" && l.name_bg ? l.name_bg : l.name)).join(", ") })}</div>}
        <div className="text-xs text-ink-2">{A.proposalNotChecked}</div>
      </div>
      {p.formula_id
        ? <Link href={`/formulas/${p.formula_id}`} className="btn btn-outline self-start">{A.proposalOpen}</Link>
        : (
          <ActionForm action={saveProposal} submitLabel={A.proposalSave} resetOnSuccess={false}>
            <input type="hidden" name="id" value={p.id} />
          </ActionForm>
        )}
    </div>
  );
}

/** The chat: conversations on the side, messages in the middle, the composer stays at the bottom. Enter sends, Shift+Enter starts a new line. */
export function AssistantChat({ conversations, current, messages, proposals, models, configured, locale, text }: {
  conversations: ChatConversation[];
  current: ChatConversation | null;
  messages: ChatLine[];
  proposals: ChatProposal[];
  models: { label: string; id: string }[];
  configured: boolean;
  locale: Locale;
  text: Dict["assistant"];
}) {
  const A = text;
  const [draft, setDraft] = useState("");
  const [waiting, setWaiting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [model, setModel] = useState(models[0]?.id ?? "");
  const [copied, setCopied] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const box = useRef<HTMLTextAreaElement>(null);
  const end = useRef<HTMLDivElement>(null);

  // The answer has arrived: the question now comes from the saved conversation
  useEffect(() => { setWaiting(null); }, [messages.length]);
  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [messages.length, waiting, current?.id]);
  // The box grows with the text, up to its maximum height in the styles
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [draft]);
  useEffect(() => { box.current?.focus(); }, [current?.id]);

  const send = (value: string) => {
    const question = value.trim();
    if (!question || pending || !configured) return;
    setError(null);
    setDraft("");
    setWaiting(question);
    const fd = new FormData();
    fd.set("text", question);
    fd.set("model", model);
    if (current) fd.set("conversation_id", current.id);
    start(async () => {
      // On success the action opens the conversation
      const r = await askAssistant({}, fd);
      if (r?.error) {
        setError(r.error);
        setWaiting(null);
        setDraft(question);
      }
    });
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send(draft);
    }
  };
  const copy = async (m: ChatLine) => {
    await navigator.clipboard.writeText(m.content);
    setCopied(m.id);
  };
  // A proposal is saved just before the answer that presents it
  const answerOf = (p: ChatProposal) => messages.find((m) => m.role === "assistant" && m.created_at >= p.created_at)?.id;
  const list = (
    <>
      <Link href="/assistant" className="btn btn-outline w-full">{A.newChat}</Link>
      <nav aria-label={A.history} className="flex min-w-0 flex-col gap-0.5">
        {conversations.map((c) => (
          <Link key={c.id} href={`/assistant?c=${c.id}`} aria-current={c.id === current?.id ? "page" : undefined}
            className={`flex min-h-11 min-w-0 flex-col justify-center rounded-sm px-3 py-1.5 text-sm text-ink no-underline ${c.id === current?.id ? "bg-neutral-tint font-semibold" : "hover:bg-canvas"}`}>
            <span className="truncate">{c.title}</span>
            <span className="text-xs font-normal text-ink-2">{formatDate(locale, c.created_at.slice(0, 10))}</span>
          </Link>
        ))}
      </nav>
    </>
  );

  return (
    <div className="grid min-w-0 grid-cols-1 gap-6 lg:grid-cols-[260px_minmax(0,1fr)]">
      <aside className="hidden min-w-0 lg:block">
        <div className="sticky top-6 flex max-h-[calc(100dvh-48px)] flex-col gap-3 overflow-y-auto">{list}</div>
      </aside>

      <section aria-label={current?.title ?? A.newChat} className="flex min-h-[calc(100dvh-220px)] min-w-0 flex-col">
        {conversations.length > 0 && (
          <details className="mb-3 lg:hidden">
            <summary className="flex min-h-11 cursor-pointer items-center text-sm font-semibold">{A.history}</summary>
            <div className="mt-2 flex flex-col gap-2">{list}</div>
          </details>
        )}

        <div className="mx-auto flex w-full max-w-[800px] flex-1 flex-col gap-5 pb-6">
          {messages.length === 0 && !waiting && (
            <div className="my-auto flex flex-col gap-4 py-10 text-center">
              <h2 className="m-0 text-2xl font-bold">{A.welcome}</h2>
              <p className="m-0 text-sm text-ink-2">{A.subtitle}</p>
              <div className="flex flex-wrap justify-center gap-2">
                {A.suggestions.map((s) => (
                  <button key={s} type="button" disabled={!configured || pending} onClick={() => send(s)}
                    className="min-h-11 rounded-full border border-line-strong bg-paper px-4 text-left text-sm text-ink hover:border-ink">{s}</button>
                ))}
              </div>
            </div>
          )}
          {messages.map((m) => m.role === "user" ? (
            <div key={m.id} className="ml-auto max-w-[85%] min-w-0 rounded-2xl rounded-br-sm bg-ink px-4 py-2.5 text-sm text-white">
              <p className="m-0 whitespace-pre-line break-words">{m.content}</p>
            </div>
          ) : (
            <div key={m.id} className="flex min-w-0 flex-col gap-3 text-[15px] leading-relaxed">
              <p className="m-0 whitespace-pre-line break-words">{m.content}</p>
              {proposals.filter((p) => answerOf(p) === m.id).map((p) => <ProposalCard key={p.id} p={p} locale={locale} A={A} />)}
              <div className="flex flex-wrap items-center gap-3 text-xs text-ink-2">
                {m.model && <span>{m.model}</span>}
                <button type="button" onClick={() => copy(m)} className="min-h-11 min-w-11 text-left underline">{copied === m.id ? A.copied : A.copy}</button>
              </div>
            </div>
          ))}
          {waiting && (
            <>
              <div className="ml-auto max-w-[85%] min-w-0 rounded-2xl rounded-br-sm bg-ink px-4 py-2.5 text-sm text-white">
                <p className="m-0 whitespace-pre-line break-words">{waiting}</p>
              </div>
              <p role="status" className="m-0 animate-pulse text-sm text-ink-2">{A.thinking}</p>
            </>
          )}
          <div ref={end} />
        </div>

        <div className="sticky bottom-0 mx-auto w-full max-w-[800px] bg-canvas pt-2 pb-4">
          {!configured && <p className="m-0 mb-2 text-sm font-semibold">{A.notConfigured}</p>}
          {error && <p role="alert" className="m-0 mb-2 text-sm font-semibold text-red-ink">{error}</p>}
          <form onSubmit={(e) => { e.preventDefault(); send(draft); }}
            className="flex min-w-0 flex-col gap-1 rounded-2xl border border-line-strong bg-paper p-2 focus-within:border-ink">
            <label htmlFor="assistant-text" className="sr-only">{A.question}</label>
            <textarea id="assistant-text" ref={box} rows={1} value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={onKey}
              placeholder={A.placeholder} className="max-h-48 w-full resize-none border-0 bg-transparent px-2 py-2 text-[15px] text-ink outline-none" />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex min-w-0 flex-wrap items-center gap-3">
                {models.length > 1 && (
                  <>
                    <label htmlFor="assistant-model" className="sr-only">{A.model}</label>
                    <select id="assistant-model" value={model} onChange={(e) => setModel(e.target.value)}
                      className="min-h-11 max-w-[180px] rounded-sm border-0 bg-transparent px-1 text-sm font-semibold text-ink">
                      {models.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                    </select>
                  </>
                )}
                <span className="hide-sm text-xs text-ink-2">{A.enterHint}</span>
              </div>
              <button type="submit" aria-label={A.send} disabled={pending || !draft.trim() || !configured}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-ink text-lg text-white disabled:opacity-40">↑</button>
            </div>
          </form>
          {current && (
            <form action={deleteConversation} className="mt-1 text-right">
              <input type="hidden" name="id" value={current.id} />
              <button type="submit" className="min-h-11 text-xs text-ink-2 underline">{A.delete}</button>
            </form>
          )}
        </div>
      </section>
    </div>
  );
}
