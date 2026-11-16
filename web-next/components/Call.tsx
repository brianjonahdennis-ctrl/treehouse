'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */
// Call screens (design: Hydra's Treehouse calling mock-up, 16 Nov 2026): incoming call, calling,
// audio call (avatar, timer, live voice waves) and video call (their video full screen, yours in a
// movable corner). One CallLayer is mounted by the app; the engine is lib/calls.ts.
import { useEffect, useRef, useState } from 'react';
import * as api from '@/lib/api';
import * as calls from '@/lib/calls';
import { state } from '@/lib/state';
import { openChat } from '@/lib/nav';
import { Avatar, Icon } from './ui';
import { openSheet, toast, confirmSheet } from './overlay';
import { blockConvo, reportSheet } from './convo';

const fmt = (ms: number) => { const s = Math.max(0, Math.floor(ms / 1000)); const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); const r = s % 60;
  return `${h ? `${h}:${String(m).padStart(2, '0')}` : String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`; };
const short = (h: string) => h.replace(/\s+\d+$/, '');
const PHASE_TEXT: Record<string, string> = { calling: 'Calling…', ringing: 'Ringing…', connecting: 'Connecting…', reconnecting: 'Reconnecting…' };

/** Mounted once by the app: shows an incoming call, or the call in progress. */
export default function CallLayer() {
  const [v, setV] = useState<calls.CallView | null>(null);
  const [incoming, setIncoming] = useState<calls.Incoming | null>(null);
  useEffect(() => calls.onCall(setV), []);
  useEffect(() => {
    if (calls.callsHiddenHere()) return;
    const onIncoming = (e: Event) => {
      const n: any = (e as CustomEvent).detail || {};
      if (n.status === 'ringing' && !n.mine) { if (!calls.currentCall()) setIncoming({ id: n.id, conversationId: n.c, kind: n.kind, from: n.from || 'Someone' }); }
      else setIncoming((cur) => (cur && cur.id === n.id ? null : cur));
    };
    window.addEventListener('th-call', onIncoming);
    // Opening treehouse while someone is calling.
    const check = () => { if (!document.hidden && !calls.currentCall()) api.callRinging().then((c: any) => { if (c && c.id) setIncoming({ id: c.id, conversationId: c.conversation_id, kind: c.kind, from: c.other_handle || 'Someone' }); }); };
    check();
    document.addEventListener('visibilitychange', check);
    return () => { window.removeEventListener('th-call', onIncoming); document.removeEventListener('visibilitychange', check); };
  }, []);
  // An incoming call stops ringing after 40 s (the server marks it missed).
  useEffect(() => { if (!incoming) return; const t = setTimeout(() => setIncoming(null), 42000); return () => clearTimeout(t); }, [incoming]);
  if (v) return <CallScreen v={v} />;
  if (incoming) return <IncomingCall inc={incoming} done={() => setIncoming(null)} />;
  return null;
}

// ---- Incoming -----------------------------------------------------------------------------------------
function IncomingCall({ inc, done }: { inc: calls.Incoming; done: () => void }) {
  const [busy, setBusy] = useState(false);
  useEffect(() => ringtone(), []);
  return (
    <div className="call-page call-incoming" role="dialog" aria-label={`Incoming ${inc.kind} call from ${inc.from}`}>
      <CallTop text={inc.kind === 'video' ? 'Incoming video call' : 'Incoming audio call'} />
      <div className="call-center">
        <span className="call-ring"><Avatar seed={inc.from} label={inc.from} cls="xl" /></span>
        <h1>{short(inc.from)}</h1>
        <p className="call-sub">{inc.kind === 'video' ? 'Incoming video call' : 'Incoming audio call'}</p>
      </div>
      <div className="call-answer">
        <button className="call-btn decline" aria-label="Decline" disabled={busy} onClick={() => { calls.declineCall(inc.id); done(); }}><Icon name="phoneoff" /><span>Decline</span></button>
        <button className="call-btn accept" aria-label="Accept" disabled={busy} onClick={async () => {
          setBusy(true);
          const err = await calls.acceptCall(inc);
          done();
          if (err) toast(err, 'x');
        }}><Icon name={inc.kind === 'video' ? 'video' : 'phone'} /><span>Accept</span></button>
      </div>
    </div>
  );
}

// A soft two-tone ring and a vibration pattern while a call is coming in.
function ringtone() {
  let ctx: AudioContext | null = null; let stop = false;
  try { ctx = new (window.AudioContext || (window as any).webkitAudioContext)(); } catch { ctx = null; }
  const ring = () => {
    if (stop || !ctx) return;
    const t = ctx.currentTime;
    [0, 0.45].forEach((d) => {
      const o = ctx!.createOscillator(), g = ctx!.createGain();
      o.frequency.value = d ? 659 : 784; o.type = 'sine';
      g.gain.setValueAtTime(0, t + d); g.gain.linearRampToValueAtTime(0.15, t + d + 0.03); g.gain.linearRampToValueAtTime(0, t + d + 0.38);
      o.connect(g).connect(ctx!.destination); o.start(t + d); o.stop(t + d + 0.4);
    });
  };
  ring();
  const timer = setInterval(ring, 2600);
  try { navigator.vibrate && navigator.vibrate([400, 300, 400, 1500, 400, 300, 400]); } catch { /* not supported */ }
  return () => { stop = true; clearInterval(timer); try { navigator.vibrate && navigator.vibrate(0); } catch { /* ignore */ } try { ctx && ctx.close(); } catch { /* ignore */ } };
}

// ---- In a call --------------------------------------------------------------------------------------
function useNow(on: boolean) { const [, set] = useState(0); useEffect(() => { if (!on) return; const t = setInterval(() => set((n) => n + 1), 1000); return () => clearInterval(t); }, [on]); }

function CallScreen({ v }: { v: calls.CallView }) {
  const live = v.phase === 'active' || v.phase === 'reconnecting';
  useNow(!!v.answeredAt && v.phase !== 'ended');
  const timer = v.answeredAt && live ? fmt(Date.now() + v.serverSkew - v.answeredAt) : null;
  const status = v.phase === 'ended' ? (v.endText || 'Call ended') : timer && v.phase === 'active' ? null : PHASE_TEXT[v.phase] || '';
  return v.kind === 'video' ? <VideoCall v={v} timer={timer} status={status} /> : <AudioCall v={v} timer={timer} status={status} />;
}

function CallTop({ text, extra }: { text: string | null; extra?: React.ReactNode }) {
  return (
    <div className="call-top">
      <span className="call-logo"><img src="/treehouse-mark.svg" alt="" width={26} height={26} /><span>treehouse<i>.</i></span></span>
      {text ? <span className="call-top-sub"><Icon name="lock" cls="sm" />{text}</span> : null}
      {extra}
    </div>
  );
}

function AudioCall({ v, timer, status }: { v: calls.CallView; timer: string | null; status: string | null }) {
  const audio = useRef<HTMLAudioElement>(null);
  useEffect(() => { if (audio.current && audio.current.srcObject !== v.remote) { audio.current.srcObject = v.remote; audio.current.play().catch(() => {}); } }, [v.remote]);
  const level = useLevel(v.remote, v.phase === 'active');
  return (
    <div className="call-page call-audio" role="dialog" aria-label={`Audio call with ${v.other}`}>
      <CallTop text={null} />
      <div className="call-center">
        <span className={`call-ring ${v.phase === 'active' ? 'live' : ''}`}><Avatar seed={v.other} label={v.other} cls="xl" /></span>
        <h1>{short(v.other)}</h1>
        <p className="call-sub">Audio Call</p>
        <p className="call-time" aria-live="polite">{status || timer}</p>
        <Waves level={v.phase === 'active' ? level : 0} />
      </div>
      <audio ref={audio} autoPlay playsInline />
      <Controls v={v} />
    </div>
  );
}

function VideoCall({ v, timer, status }: { v: calls.CallView; timer: string | null; status: string | null }) {
  const remote = useRef<HTMLVideoElement>(null), self = useRef<HTMLVideoElement>(null);
  useEffect(() => { if (remote.current && remote.current.srcObject !== v.remote) { remote.current.srcObject = v.remote; remote.current.play().catch(() => {}); } }, [v.remote]);
  useEffect(() => { if (self.current && self.current.srcObject !== v.local) { self.current.srcObject = v.local; self.current.play().catch(() => {}); } }, [v.local]);
  const pip = useDrag();
  const showTheirs = !!v.remote && v.theirCamOn && v.phase !== 'ended';
  return (
    <div className="call-page call-video" role="dialog" aria-label={`Video call with ${v.other}`}>
      <video ref={remote} className="call-remote" autoPlay playsInline hidden={!showTheirs} />
      {!showTheirs ? (
        <div className="call-center call-novideo">
          <span className={`call-ring ${v.phase === 'active' ? 'live' : ''}`}><Avatar seed={v.other} label={v.other} cls="xl" /></span>
          <h1>{short(v.other)}</h1>
          <p className="call-sub">{v.phase === 'active' && !v.theirCamOn ? 'Camera off' : 'Video Call'}</p>
          {status ? <p className="call-time">{status}</p> : null}
        </div>
      ) : null}
      <CallTop text={`Video Call${timer ? ` · ${timer}` : ''}`} extra={showTheirs && status ? <span className="call-top-status">{status}</span> : <Quality q={v.quality} show={v.phase === 'active' || v.phase === 'reconnecting'} />} />
      <div className="call-pip" ref={pip.ref} {...pip.handlers} style={pip.style}>
        <video ref={self} autoPlay playsInline muted hidden={!v.camOn} className={v.facing === 'user' ? 'mirror' : ''} />
        {!v.camOn ? <span className="call-pip-off"><Avatar seed={state.profile?.handle || 'me'} cls="lg" /></span> : null}
        <button className="call-pip-flip" aria-label="Switch camera" onClick={(e) => { e.stopPropagation(); calls.flipCamera(); }}><Icon name="flip" cls="sm" /></button>
      </div>
      <Controls v={v} floating />
    </div>
  );
}

function Quality({ q, show }: { q: number; show: boolean }) {
  if (!show) return null;
  return <span className={`call-quality q${q}`} aria-label={q >= 3 ? 'Good connection' : q >= 1 ? 'Poor connection' : 'Connection lost'}>{[1, 2, 3].map((n) => <i key={n} className={n <= q ? 'on' : ''} />)}</span>;
}

function Controls({ v, floating = false }: { v: calls.CallView; floating?: boolean }) {
  const ended = v.phase === 'ended';
  const outputs = useOutputs();
  return (
    <div className={`call-controls ${floating ? 'floating' : ''}`}>
      <CtrlBtn icon={v.muted ? 'micoff' : 'mic'} label={v.muted ? 'Unmute' : 'Mute'} on={v.muted} disabled={ended} onClick={calls.toggleMute} />
      {v.kind === 'video' ? <CtrlBtn icon={v.camOn ? 'video' : 'videooff'} label="Camera" on={!v.camOn} disabled={ended} onClick={calls.toggleCamera} /> : null}
      {outputs.can ? <CtrlBtn icon="speaker" label="Speaker" on={outputs.alt} disabled={ended} onClick={outputs.next} /> : null}
      {v.kind === 'video' && !floating ? <CtrlBtn icon="flip" label="Flip" disabled={ended} onClick={calls.flipCamera} /> : null}
      <CtrlBtn icon="more" label="More" disabled={ended} onClick={() => moreSheet(v)} />
      <button className="call-btn end" aria-label={v.phase === 'ringing' || v.phase === 'calling' ? 'Cancel call' : 'End call'} disabled={ended} onClick={calls.hangUp}><Icon name="phoneoff" /></button>
    </div>
  );
}
function CtrlBtn({ icon, label, on = false, disabled = false, onClick }: { icon: string; label: string; on?: boolean; disabled?: boolean; onClick: () => void }) {
  return <button className={`call-ctrl ${on ? 'on' : ''}`} aria-pressed={on} disabled={disabled} onClick={onClick}><span><Icon name={icon} /></span>{label}</button>;
}

function moreSheet(v: calls.CallView) {
  const convo = state.convos.find((c) => c.conversation_id === v.conversationId);
  openSheet((close) => (
    <>
      <h2>{short(v.other)}</h2>
      <div className="menu-list">
        <button className="menu-item" onClick={() => { close(); openChat(v.conversationId); }}><Icon name="chat" />Open chat</button>
        {convo ? <button className="menu-item" onClick={() => { close(); reportSheet(convo); }}><Icon name="flag" />Report</button> : null}
        {convo ? <button className="menu-item danger" onClick={async () => {
          close();
          if (!(await confirmSheet({ title: `Block ${short(v.other)}?`, text: 'The call ends and they can’t message or call you.', yes: 'Block', danger: true }))) return;
          calls.hangUp(); blockConvo(convo, { leave: false });
        }}><Icon name="ban" />Block</button> : null}
      </div>
      <p className="tiny muted">Calls are private and never recorded.</p>
      <div className="sheet-actions"><button className="btn btn-soft btn-block" onClick={close}>Close</button></div>
    </>
  ), { label: 'Call options' });
}

// Speaker: where the browser lets us choose the sound output (Chrome on Android and computers), cycle
// through the outputs; elsewhere the phone decides (and the button is hidden).
function useOutputs() {
  const [list, setList] = useState<MediaDeviceInfo[]>([]);
  const [i, setI] = useState(0);
  useEffect(() => {
    if (!('setSinkId' in HTMLMediaElement.prototype) || !navigator.mediaDevices?.enumerateDevices) return;
    navigator.mediaDevices.enumerateDevices().then((d) => setList(d.filter((x) => x.kind === 'audiooutput' && x.deviceId))).catch(() => {});
  }, []);
  const can = list.length > 1;
  const next = () => {
    if (!can) return;
    const n = (i + 1) % list.length; setI(n);
    document.querySelectorAll<HTMLMediaElement>('.call-page audio, .call-page video.call-remote').forEach((el: any) => { el.setSinkId && el.setSinkId(list[n].deviceId).catch(() => {}); });
  };
  return { can, alt: i !== 0, next };
}

// How loud the other person is right now (0..1), for the voice waves.
function useLevel(stream: MediaStream | null, on: boolean) {
  const [lvl, setLvl] = useState(0);
  useEffect(() => {
    if (!stream || !on || !stream.getAudioTracks().length) return;
    let ctx: AudioContext | null = null, raf = 0, last = 0;
    try {
      ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const src = ctx.createMediaStreamSource(stream), an = ctx.createAnalyser();
      an.fftSize = 256; src.connect(an);
      const buf = new Uint8Array(an.frequencyBinCount);
      const loop = (t: number) => {
        raf = requestAnimationFrame(loop);
        if (t - last < 90) return; last = t;
        an.getByteFrequencyData(buf);
        let sum = 0; for (let k = 0; k < buf.length; k++) sum += buf[k];
        setLvl(Math.min(1, sum / buf.length / 70));
      };
      raf = requestAnimationFrame(loop);
    } catch { /* no waves then */ }
    return () => { cancelAnimationFrame(raf); try { ctx && ctx.close(); } catch { /* ignore */ } };
  }, [stream, on]);
  return lvl;
}
const WAVE = [0.3, 0.45, 0.6, 0.8, 1, 0.75, 0.55, 0.9, 0.65, 0.4, 0.7, 1, 0.8, 0.5, 0.35, 0.6, 0.85, 0.55, 0.4, 0.3];
function Waves({ level }: { level: number }) {
  return <div className="call-waves" aria-hidden="true">{WAVE.map((w, k) => <i key={k} style={{ height: `${Math.max(6, (0.15 + level * 0.85) * w * 44)}px` }} />)}</div>;
}

// Your own picture can be dragged to any corner.
function useDrag() {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const start = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  const handlers = {
    onPointerDown: (e: React.PointerEvent) => { const r = ref.current!.getBoundingClientRect(); start.current = { x: e.clientX, y: e.clientY, px: r.left, py: r.top }; (e.target as Element).setPointerCapture?.(e.pointerId); },
    onPointerMove: (e: React.PointerEvent) => {
      if (!start.current || !ref.current) return;
      const r = ref.current.getBoundingClientRect();
      const x = Math.min(Math.max(8, start.current.px + e.clientX - start.current.x), window.innerWidth - r.width - 8);
      const y = Math.min(Math.max(8, start.current.py + e.clientY - start.current.y), window.innerHeight - r.height - 8);
      setPos({ x, y });
    },
    onPointerUp: () => { start.current = null; },
  };
  return { ref, handlers, style: pos ? { left: pos.x, top: pos.y, right: 'auto' } as React.CSSProperties : undefined };
}

// ---- Chat header buttons ------------------------------------------------------------------------------
/** Phone and video buttons for a chat, shown only once the database says calls are available here. */
export function ChatCallActions({ conversationId, other, refreshKey }: { conversationId: string; other: string; refreshKey: number }) {
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (calls.callsHiddenHere() || ok) return;
    let alive = true;
    api.callAvailable(conversationId).then((v) => { if (alive) setOk(v); });
    return () => { alive = false; };
  }, [conversationId, refreshKey, ok]);
  if (!ok) return null;
  const go = async (kind: calls.CallKind) => {
    if (busy) return;
    setBusy(true);
    const err = await calls.startCall(conversationId, kind, other);
    setBusy(false);
    if (err) toast(err, 'x');
  };
  return (
    <span className="chat-calls">
      <button className="plain-btn" aria-label="Audio call" disabled={busy} onClick={() => go('audio')}><Icon name="phone" /></button>
      <button className="plain-btn" aria-label="Video call" disabled={busy} onClick={() => go('video')}><Icon name="video" /></button>
    </span>
  );
}

// ---- Call records in a chat ---------------------------------------------------------------------------
export function CallRecord({ c }: { c: any }) {
  const mins = c.answered_at && c.ended_at ? fmt(Date.parse(c.ended_at) - Date.parse(c.answered_at)) : null;
  const kind = c.kind === 'video' ? 'Video call' : 'Audio call';
  const missed = c.status === 'missed' || (c.status === 'cancelled' && !c.outgoing);
  const text = c.status === 'ended' && mins ? `${kind} · ${mins}`
    : missed ? `Missed ${c.kind === 'video' ? 'video' : 'audio'} call`
    : c.status === 'declined' ? 'Call declined'
    : c.status === 'busy' ? `${kind} · busy`
    : c.status === 'cancelled' ? `${kind} · cancelled`
    : c.status === 'failed' ? `${kind} · couldn’t connect`
    : c.status === 'active' ? `${kind} · in progress` : kind;
  return (
    <div className={`call-record ${missed ? 'missed' : ''}`}>
      <span><Icon name={missed ? 'phoneoff' : c.kind === 'video' ? 'video' : 'phone'} cls="sm" />{text}</span>
      <time dateTime={c.created_at}>{new Date(c.created_at).toLocaleTimeString('en-NG', { hour: 'numeric', minute: '2-digit', timeZone: 'Africa/Lagos' })}</time>
    </div>
  );
}
