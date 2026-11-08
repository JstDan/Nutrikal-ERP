"use client";

// Huddles (owner, Nov 2026: like Slack): a voice call in a channel or a direct conversation, straight between the
// browsers (WebRTC, every one to every one; fine for a handful of people). Who is in it is the presence of the channel's
// live topic; the offers, answers and network candidates go over the same topic, addressed to one browser.
// The sound never passes through the app; the TURN relay (Cloudflare, when set up) only forwards encrypted packets.
import { useEffect, useRef, useState } from "react";
import { huddleIceServers, ringHuddle } from "@/app/chat-actions";
import { fmt } from "@/lib/i18n";
import type { Dict } from "@/lib/i18n/en";
import { UserAvatar } from "@/components/user-avatar";
import type { Topic } from "@/components/live";

type Meta = Record<string, unknown>;
type Member = { session: string; id: string; name: string; muted: boolean };
type Peer = { pc: RTCPeerConnection; stream: MediaStream | null; queue: RTCIceCandidateInit[] };

function Icon({ d, size = 18 }: { d: string; size?: number }) {
  return <svg aria-hidden="true" viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>;
}
export const HEADPHONES = "M4 15v-3a8 8 0 0 1 16 0v3M4 15a2 2 0 0 1 2-2h1v7H6a2 2 0 0 1-2-2zM20 15a2 2 0 0 0-2-2h-1v7h1a2 2 0 0 0 2-2z";
const MIC = "M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5 11a7 7 0 0 0 14 0M12 18v3";
const MIC_OFF = "M3 3l18 18M9 9v3a3 3 0 0 0 5.1 2.1M15 9.3V6a3 3 0 0 0-5.7-1.3M5 11a7 7 0 0 0 11.3 5.5M19 11a7 7 0 0 1-.6 2.8M12 18v3";

/** A remote voice: an <audio> element that plays the peer's stream. */
function Voice({ stream }: { stream: MediaStream }) {
  const el = useRef<HTMLAudioElement>(null);
  useEffect(() => { if (el.current) { el.current.srcObject = stream; void el.current.play().catch(() => {}); } }, [stream]);
  return <audio ref={el} autoPlay playsInline />;
}

/** Who is speaking: the loudness of each stream, looked at a few times a second. */
function useSpeaking(streams: Map<string, MediaStream>) {
  const [speaking, setSpeaking] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!streams.size || typeof AudioContext === "undefined") { setSpeaking(new Set()); return; }
    const ctx = new AudioContext();
    const meters = [...streams.entries()].map(([key, s]) => {
      const a = ctx.createAnalyser();
      a.fftSize = 512;
      try { ctx.createMediaStreamSource(s).connect(a); } catch { /* a stream without sound yet */ }
      return { key, a, data: new Uint8Array(a.fftSize) };
    });
    const t = window.setInterval(() => {
      const now = new Set<string>();
      for (const m of meters) {
        m.a.getByteTimeDomainData(m.data);
        let sum = 0;
        for (const v of m.data) sum += ((v - 128) / 128) ** 2;
        if (Math.sqrt(sum / m.data.length) > 0.04) now.add(m.key);
      }
      setSpeaking((old) => (old.size === now.size && [...now].every((k) => old.has(k)) ? old : now));
    }, 250);
    return () => { window.clearInterval(t); void ctx.close().catch(() => {}); };
  }, [streams]);
  return speaking;
}

export function Huddle({ topic, channel, session, userId, name, direct, C, autoOffer = false }: {
  topic: Topic | null; channel: string; session: string; userId: string; name: string; direct: boolean; C: Dict["chat"];
  autoOffer?: boolean;   // opened from a huddle notification: the Join button is shown big
}) {
  const [members, setMembers] = useState<Member[]>([]);
  const [joined, setJoined] = useState(false);
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [streams, setStreams] = useState<Map<string, MediaStream>>(new Map());
  const local = useRef<MediaStream | null>(null);
  const peers = useRef(new Map<string, Peer>());
  const ice = useRef<RTCIceServer[]>([]);
  const speaking = useSpeaking(streams);

  // Who is in the huddle (also when this browser is not)
  useEffect(() => {
    if (!topic) return;
    return topic.onPresence((list: Meta[]) => setMembers(list.filter((m) => m.huddle).map((m) => ({
      session: String(m.session), id: String(m.id ?? ""), name: String(m.name ?? ""), muted: !!m.muted,
    }))));
  }, [topic]);

  const setStream = (key: string, s: MediaStream | null) => setStreams((old) => {
    const next = new Map(old);
    if (s) next.set(key, s); else next.delete(key);
    return next;
  });
  const drop = (s: string) => {
    const p = peers.current.get(s);
    if (!p) return;
    p.pc.close();
    peers.current.delete(s);
    setStream(s, null);
  };
  const peer = (s: string): Peer => {
    let p = peers.current.get(s);
    if (p) return p;
    const pc = new RTCPeerConnection({ iceServers: ice.current });
    p = { pc, stream: null, queue: [] };
    peers.current.set(s, p);
    local.current?.getTracks().forEach((t) => pc.addTrack(t, local.current!));
    pc.onicecandidate = (e) => { if (e.candidate) topic?.send("rtc", { to: s, from: session, candidate: e.candidate.toJSON() }); };
    pc.ontrack = (e) => { const stream = e.streams[0] ?? new MediaStream([e.track]); p!.stream = stream; setStream(s, stream); };
    pc.onconnectionstatechange = () => { if (pc.connectionState === "failed") drop(s); };
    return p;
  };

  // Signals for this browser: offers, answers and candidates
  useEffect(() => {
    if (!topic || !joined) return;
    return topic.on(async (event, m) => {
      if (event !== "rtc" || m.to !== session) return;
      const from = String(m.from);
      try {
        if (m.sdp) {
          const sdp = m.sdp as RTCSessionDescriptionInit;
          const p = peer(from);
          await p.pc.setRemoteDescription(sdp);
          for (const c of p.queue.splice(0)) await p.pc.addIceCandidate(c).catch(() => {});
          if (sdp.type === "offer") {
            await p.pc.setLocalDescription(await p.pc.createAnswer());
            topic.send("rtc", { to: from, from: session, sdp: p.pc.localDescription!.toJSON() });
          }
        } else if (m.candidate) {
          const p = peer(from);
          if (p.pc.remoteDescription) await p.pc.addIceCandidate(m.candidate as RTCIceCandidateInit).catch(() => {});
          else p.queue.push(m.candidate as RTCIceCandidateInit);
        }
      } catch (e) {
        console.error("Huddle", e);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topic, joined, session]);

  // New people in the huddle: the browser with the smaller id calls; people who left are let go
  useEffect(() => {
    if (!joined || !topic) return;
    const others = members.filter((m) => m.session !== session);
    for (const m of others) {
      if (peers.current.has(m.session) || session > m.session) continue;
      const p = peer(m.session);
      void (async () => {
        await p.pc.setLocalDescription(await p.pc.createOffer());
        topic.send("rtc", { to: m.session, from: session, sdp: p.pc.localDescription!.toJSON() });
      })().catch((e) => console.error("Huddle", e));
    }
    for (const s of [...peers.current.keys()]) if (!others.some((m) => m.session === s)) drop(s);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [members, joined, topic, session]);

  const join = async () => {
    setError(null);
    if (!navigator.mediaDevices?.getUserMedia) { setError(C.huddleNoMic); return; }
    try {
      local.current = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch {
      setError(C.huddleNoMic);
      return;
    }
    ice.current = await huddleIceServers().catch(() => [{ urls: "stun:stun.l.google.com:19302" }]);
    setStream(session, local.current);
    setMuted(false);
    setJoined(true);
    topic?.track({ id: userId, name, huddle: true, muted: false });
    // The first one in a direct conversation rings the other person's phone
    if (direct && !members.some((m) => m.session !== session)) void ringHuddle(channel).catch(() => {});
  };
  const leave = () => {
    for (const s of [...peers.current.keys()]) drop(s);
    local.current?.getTracks().forEach((t) => t.stop());
    local.current = null;
    setStream(session, null);
    setJoined(false);
    topic?.track(null);
  };
  const toggleMute = () => {
    const next = !muted;
    local.current?.getAudioTracks().forEach((t) => { t.enabled = !next; });
    setMuted(next);
    topic?.track({ id: userId, name, huddle: true, muted: next });
  };
  // Leaving the channel (or the page) leaves the huddle
  useEffect(() => () => {
    peers.current.forEach((p) => p.pc.close());
    peers.current.clear();
    if (local.current) topic?.track(null);
    local.current?.getTracks().forEach((t) => t.stop());
    local.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topic]);

  if (!topic) return null;
  const inCall = members.filter((m) => m.session !== session || joined);
  const live = inCall.length > 0;
  if (!live && !joined) {
    return (
      <>
        <button type="button" onClick={join} title={C.huddleStart} aria-label={C.huddleStart}
          className="flex min-h-9 items-center gap-1.5 rounded-md border border-line bg-paper px-2 text-xs font-semibold text-ink-2 hover:text-ink">
          <Icon d={HEADPHONES} size={15} /><span className="hide-sm">{C.huddle}</span>
        </button>
        {error && <span role="alert" className="text-xs font-semibold text-red-ink">{error}</span>}
      </>
    );
  }
  return (
    <div role="region" aria-label={C.huddle} className={`order-last flex w-full min-w-0 flex-wrap items-center gap-2 rounded-lg px-2 py-1.5 ${joined ? "bg-[#1a7f5a] text-white" : "border border-[#1a7f5a] bg-[#e9f7f1] text-ink"} ${autoOffer && !joined ? "chat-in" : ""}`}>
      <Icon d={HEADPHONES} size={16} />
      <span className="text-xs font-bold">{C.huddle}</span>
      <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
        {inCall.map((m) => (
          <span key={m.session} title={m.name} className={`relative rounded-md ${speaking.has(m.session) ? "ring-2 ring-[#7bc74d]" : ""}`}>
            <UserAvatar id={m.id} size={24} />
            {m.muted && <span aria-hidden="true" className="absolute -right-1 -bottom-1 grid h-3.5 w-3.5 place-items-center rounded-full bg-red text-white"><Icon d={MIC_OFF} size={9} /></span>}
          </span>
        ))}
        <span className="hide-sm truncate text-xs opacity-90">{fmt(C.huddlePeople, { n: inCall.length })}</span>
      </span>
      {joined ? (
        <>
          <button type="button" onClick={toggleMute} aria-pressed={muted} aria-label={muted ? C.huddleUnmute : C.huddleMute} title={muted ? C.huddleUnmute : C.huddleMute}
            className={`grid h-9 w-11 place-items-center rounded-md ${muted ? "bg-red text-white" : "bg-white/15 hover:bg-white/25"}`}><Icon d={muted ? MIC_OFF : MIC} /></button>
          <button type="button" onClick={leave} className="min-h-9 rounded-md bg-white px-3 text-xs font-bold text-[#1a7f5a] hover:bg-white/90">{C.huddleLeave}</button>
        </>
      ) : (
        <button type="button" onClick={join} className="min-h-9 rounded-md bg-[#1a7f5a] px-3 text-xs font-bold text-white hover:bg-[#156b4c]">{C.huddleJoin}</button>
      )}
      {error && <span role="alert" className="w-full text-xs font-semibold text-red-ink">{error}</span>}
      {[...streams.entries()].filter(([k]) => k !== session).map(([k, s]) => <Voice key={k} stream={s} />)}
    </div>
  );
}
