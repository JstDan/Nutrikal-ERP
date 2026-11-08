"use client";

// The live connection of the signed-in app (owner, Nov 2026: the chat like Slack): new messages at once, who is
// typing, who is online, huddles. On Supabase it is Realtime with private topics (rules in the database,
// migration 20261108000200); in local development the tabs of one browser talk through a BroadcastChannel, so the
// same code can be tried there. Nothing here is needed for the app to work: without it the chat polls.
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createBrowserClient } from "@supabase/ssr";
import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";

type Meta = Record<string, unknown>;
type Handler = (event: string, payload: Meta) => void;

/** One topic: send and receive broadcasts, and say who of this browser is there (presence). */
export type Topic = {
  send: (event: string, payload: Meta) => void;
  on: (fn: Handler) => () => void;
  /** This browser on the topic: its state, or null to leave. */
  track: (state: Meta | null) => void;
  onPresence: (fn: (list: Meta[]) => void) => () => void;
  release: () => void;
};

type Entry = { refs: number; handlers: Set<Handler>; presence: Set<(l: Meta[]) => void>; list: Meta[]; tracked: Meta | null; close: () => void; send: (e: string, p: Meta) => void; track: (s: Meta | null) => void };

export type Live = {
  /** True when messages come at once (Realtime connected); otherwise the chat keeps polling. */
  realtime: boolean;
  /** This browser tab (a person can be in a huddle from two devices). */
  session: string;
  userId: string;
  name: string;
  join: (topic: string) => Topic;
  /** Who is online: active, or away (the app hidden or untouched for 10 minutes). */
  status: (userId: string) => "active" | "away" | null;
};

const LiveContext = createContext<Live | null>(null);
export const useLive = () => useContext(LiveContext);

let supabase: SupabaseClient | null = null;
const AWAY_MS = 10 * 60 * 1000;
const BEAT_MS = 4000;

/** The pings of the database for this person, for whoever on the page wants them (the bell, the chat badge). */
export function onPing(fn: (event: string, payload: Meta) => void) {
  const h = (e: Event) => { const d = (e as CustomEvent<{ event: string; payload: Meta }>).detail; fn(d.event, d.payload); };
  window.addEventListener("nk:ping", h);
  return () => window.removeEventListener("nk:ping", h);
}

export function LiveProvider({ config, userId, authId, name, children }: {
  config: { url: string; key: string } | null; userId: string; authId: string; name: string; children: ReactNode;
}) {
  const session = useMemo(() => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Math.random()).slice(2)), []);
  const topics = useRef(new Map<string, Entry>());
  const [realtime, setRealtime] = useState(false);
  const [online, setOnline] = useState<Map<string, "active" | "away">>(new Map());

  const join = useMemo(() => {
    const open = (name: string): Entry => {
      const handlers = new Set<Handler>();
      const presence = new Set<(l: Meta[]) => void>();
      const entry: Entry = { refs: 0, handlers, presence, list: [], tracked: null, close: () => {}, send: () => {}, track: () => {} };
      const setList = (list: Meta[]) => { entry.list = list; presence.forEach((f) => f(list)); };

      if (config) {
        supabase ??= createBrowserClient(config.url, config.key);
        const client = supabase;
        let ch: RealtimeChannel | null = null;
        let joined = false;
        const pending: (() => void)[] = [];
        const whenJoined = (f: () => void) => (joined ? f() : pending.push(f));
        void (async () => {
          await client.realtime.setAuth().catch(() => {});
          ch = client.channel(name, { config: { private: true, broadcast: { self: false }, presence: { key: session } } });
          ch.on("broadcast", { event: "*" }, (m) => handlers.forEach((f) => f(String(m.event), (m.payload ?? {}) as Meta)));
          ch.on("presence", { event: "sync" }, () => {
            const state = ch!.presenceState() as Record<string, Meta[]>;
            setList(Object.entries(state).map(([key, metas]) => ({ ...(metas.at(-1) ?? {}), session: key })));
          });
          ch.subscribe((status) => {
            if (status === "SUBSCRIBED") {
              joined = true;
              setRealtime(true);
              pending.splice(0).forEach((f) => f());
              if (entry.tracked) void ch!.track(entry.tracked);
            }
          });
        })();
        entry.send = (event, payload) => whenJoined(() => { void ch?.send({ type: "broadcast", event, payload }); });
        entry.track = (state) => {
          entry.tracked = state;
          whenJoined(() => { if (state) void ch?.track(state); else void ch?.untrack(); });
        };
        entry.close = () => { joined = false; pending.length = 0; if (ch) void client.removeChannel(ch); ch = null; };
      } else if (typeof BroadcastChannel !== "undefined") {
        // Local development: the tabs of this browser; presence is a beat every few seconds
        const bc = new BroadcastChannel(`nk-live:${name}`);
        let closed = false;
        const seen = new Map<string, { meta: Meta; at: number }>();
        const publish = () => setList([...seen.entries()].map(([s, v]) => ({ ...v.meta, session: s })));
        bc.onmessage = (e: MessageEvent<{ kind: string; event?: string; payload?: Meta; from: string; meta?: Meta | null }>) => {
          const m = e.data;
          if (m.kind === "b") handlers.forEach((f) => f(m.event!, m.payload ?? {}));
          else if (m.kind === "p") {
            if (m.meta) seen.set(m.from, { meta: m.meta, at: Date.now() }); else seen.delete(m.from);
            publish();
          } else if (m.kind === "hello" && entry.tracked) bc.postMessage({ kind: "p", from: session, meta: entry.tracked });
        };
        const beat = window.setInterval(() => {
          if (entry.tracked) bc.postMessage({ kind: "p", from: session, meta: entry.tracked });
          const now = Date.now();
          let gone = false;
          for (const [s, v] of seen) if (now - v.at > BEAT_MS * 3) { seen.delete(s); gone = true; }
          if (gone) publish();
        }, BEAT_MS);
        bc.postMessage({ kind: "hello", from: session });
        entry.send = (event, payload) => { if (!closed) bc.postMessage({ kind: "b", event, payload, from: session }); };
        entry.track = (state) => {
          entry.tracked = state;
          if (closed) return;
          bc.postMessage({ kind: "p", from: session, meta: state });
          // This tab is part of the list too
          if (state) seen.set(session, { meta: state, at: Date.now() }); else seen.delete(session);
          publish();
        };
        entry.close = () => { closed = true; bc.postMessage({ kind: "p", from: session, meta: null }); window.clearInterval(beat); bc.close(); };
      }
      return entry;
    };

    return (name: string): Topic => {
      let entry = topics.current.get(name);
      if (!entry) { entry = open(name); topics.current.set(name, entry); }
      const e = entry;
      e.refs += 1;
      const mine = new Set<Handler>();
      const minePresence = new Set<(l: Meta[]) => void>();
      let released = false;
      return {
        // A released topic ignores what still comes (a component that lets go after the channel closed)
        send: (event, payload) => { if (!released) e.send(event, payload); },
        on: (fn) => { e.handlers.add(fn); mine.add(fn); return () => { e.handlers.delete(fn); mine.delete(fn); }; },
        track: (state) => { if (!released) e.track(state); },
        onPresence: (fn) => { e.presence.add(fn); minePresence.add(fn); fn(e.list); return () => { e.presence.delete(fn); minePresence.delete(fn); }; },
        release: () => {
          if (released) return;
          released = true;
          mine.forEach((f) => e.handlers.delete(f));
          minePresence.forEach((f) => e.presence.delete(f));
          e.refs -= 1;
          if (e.refs <= 0) { e.close(); topics.current.delete(name); }
        },
      };
    };
  }, [config, session]);

  // Who is online: this browser says it is here, active or away
  useEffect(() => {
    const topic = join("chat-presence");
    let last = Date.now();
    let away: boolean | null = null;
    const update = () => {
      const now = document.visibilityState === "hidden" || Date.now() - last > AWAY_MS;
      if (now !== away) { away = now; topic.track({ id: userId, away: now }); }
    };
    const touch = () => { last = Date.now(); update(); };
    const stop = topic.onPresence((list) => {
      const map = new Map<string, "active" | "away">();
      for (const m of list) {
        const id = String(m.id ?? "");
        if (!id) continue;
        if (!m.away) map.set(id, "active"); else if (!map.has(id)) map.set(id, "away");
      }
      setOnline(map);
    });
    update();
    const timer = window.setInterval(update, 30000);
    const events = ["pointerdown", "keydown", "focus"] as const;
    events.forEach((ev) => window.addEventListener(ev, touch, { passive: true }));
    document.addEventListener("visibilitychange", touch);
    return () => {
      window.clearInterval(timer);
      events.forEach((ev) => window.removeEventListener(ev, touch));
      document.removeEventListener("visibilitychange", touch);
      stop();
      topic.release();
    };
  }, [join, userId]);

  // The database's pings for this person go to whoever listens on the page
  useEffect(() => {
    const topic = join(`user:${authId}`);
    const off = topic.on((event, payload) => window.dispatchEvent(new CustomEvent("nk:ping", { detail: { event, payload } })));
    return () => { off(); topic.release(); };
  }, [join, authId]);

  const value = useMemo<Live>(() => ({
    realtime, session, userId, name, join,
    status: (id) => online.get(id) ?? null,
  }), [realtime, session, userId, name, join, online]);

  return <LiveContext.Provider value={value}>{children}</LiveContext.Provider>;
}

/** The green dot (active) or the hollow one (away) on a person's picture, as in Slack. */
export function PresenceDot({ id, label, ring = "border-paper" }: { id: string | undefined; label?: { active: string; away: string }; ring?: string }) {
  const live = useLive();
  const s = id && live ? live.status(id) : null;
  if (!s) return null;
  const text = label ? (s === "active" ? label.active : label.away) : undefined;
  return (
    <span role={text ? "img" : undefined} aria-label={text} aria-hidden={text ? undefined : true} title={text}
      className={`absolute -right-0.5 -bottom-0.5 block h-3 w-3 rounded-full border-2 ${s === "active" ? `${ring} bg-[#2bac76]` : "border-[#9aa0a6] bg-paper"}`} />
  );
}
