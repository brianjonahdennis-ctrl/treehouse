'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */
// Audio and video calls between two people in a private chat (Hydra, 16 Nov 2026).
// The database decides who may call and keeps the call record (migration 121). The call itself goes
// phone to phone (WebRTC), through Cloudflare's relay when needed (/api/call-ice), and is never recorded.
// Call setup follows Speed Dating (components/speed.js), which is proven on live phones:
//   the caller makes the offer; the person called says "hello" once they've answered and are ready;
//   setup messages travel twice (live channel + a mailbox read every second) and duplicates are ignored;
//   a call that drops tries a fresh route and ends after 20 s without coming back.
import * as api from './api';

export type CallKind = 'audio' | 'video';
export type CallPhase = 'calling' | 'ringing' | 'connecting' | 'active' | 'reconnecting' | 'ended';
export type CallView = {
  id: string; conversationId: string; kind: CallKind; outgoing: boolean; other: string;
  phase: CallPhase; endText: string | null; answeredAt: number | null; serverSkew: number;
  muted: boolean; camOn: boolean; theirCamOn: boolean; facing: 'user' | 'environment'; quality: 0 | 1 | 2 | 3;
  local: MediaStream | null; remote: MediaStream | null; relay: boolean;
};

type Listener = (v: CallView | null) => void;
const listeners = new Set<Listener>();
let view: CallView | null = null;
const emit = () => listeners.forEach((f) => f(view ? { ...view } : null));
export function onCall(f: Listener) { listeners.add(f); f(view ? { ...view } : null); return () => { listeners.delete(f); }; }
export const currentCall = () => view;

// Calls are hidden in the iPhone app for now (App Store review), as Speed Dating is.
const ua = () => (typeof navigator !== 'undefined' && navigator.userAgent) || '';
export const callsHiddenHere = () => {
  if (typeof window === 'undefined') return true;
  const inApp = /TreehouseApp\//.test(ua()) || !!((window as any).Capacitor && (window as any).Capacitor.isNativePlatform && (window as any).Capacitor.isNativePlatform());
  if (inApp && /iPhone|iPad|iPod/i.test(ua())) return true;
  return !(navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === 'function' && (window as any).RTCPeerConnection);
};

// ---- Internal state of the one call in progress -----------------------------------------------------
type Flow = {
  id: string; role: 'caller' | 'callee'; pc: RTCPeerConnection | null; channel: { leave(): void } | null;
  ready: boolean; connected: boolean; ended: boolean; early: any[]; pending: any[]; localCands: any[];
  seen: Set<number>; lastSig: number; timers: any[]; troubleSince: number | null; subscribed: boolean;
};
let flow: Flow | null = null;

const END_TEXT: Record<string, string> = {
  ended: 'Call ended', missed: 'No answer', declined: 'Call declined', cancelled: 'Call cancelled',
  busy: 'They’re on another call', failed: 'Call failed',
};

async function getMedia(kind: CallKind, facing: 'user' | 'environment' = 'user') {
  return navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    video: kind === 'video' ? { facingMode: facing, width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 24, max: 30 } } : false,
  });
}
function mediaError(e: any) {
  const n = e && e.name;
  if (n === 'NotAllowedError' || n === 'SecurityError') return 'Allow treehouse to use your microphone (and camera for video calls), then try again.';
  if (n === 'NotFoundError' || n === 'OverconstrainedError') return 'No microphone or camera was found on this device.';
  if (n === 'NotReadableError') return 'Your microphone or camera is being used by another app.';
  return 'Couldn’t start the microphone or camera.';
}

function setView(patch: Partial<CallView>) { if (view) { view = { ...view, ...patch }; emit(); } }
function applyServer(c: any) {
  if (!c || !view || c.id !== view.id) return;
  if (c.answered_at) {
    const skew = c.now ? Date.parse(c.now) - Date.now() : view.serverSkew;
    setView({ answeredAt: Date.parse(c.answered_at), serverSkew: skew });
  }
  if (c.status === 'active' && (view.phase === 'calling' || view.phase === 'ringing')) {
    setView({ phase: flow && flow.connected ? 'active' : 'connecting' });
  } else if (c.status && !['ringing', 'active'].includes(c.status)) {
    finish(END_TEXT[c.status] || 'Call ended');
  }
}

// ---- Starting and answering ---------------------------------------------------------------------------
export async function startCall(conversationId: string, kind: CallKind, other: string): Promise<string | null> {
  if (view) return 'You’re already in a call.';
  let local: MediaStream;
  try { local = await getMedia(kind); } catch (e) { return mediaError(e); }
  view = { id: '', conversationId, kind, outgoing: true, other, phase: 'calling', endText: null, answeredAt: null, serverSkew: 0,
    muted: false, camOn: kind === 'video', theirCamOn: kind === 'video', facing: 'user', quality: 3, local, remote: null, relay: false };
  api.holdLive(true);
  emit();
  let c: any;
  try { c = await api.callStart(conversationId, kind); }
  catch (e) { stopLocal(); view = null; api.holdLive(false); emit(); return api.friendly(e); }
  if (!view) return null;
  view.id = c.id;
  if (c.status === 'busy') { finish(END_TEXT.busy); return null; }
  setView({ phase: 'ringing' });
  begin(c.id, 'caller');
  return null;
}

export type Incoming = { id: string; conversationId: string; kind: CallKind; from: string };
export async function acceptCall(inc: Incoming): Promise<string | null> {
  if (view) return 'You’re already in a call.';
  let local: MediaStream;
  try { local = await getMedia(inc.kind); } catch (e) { api.callEnd(inc.id, 'permission').catch(() => {}); return mediaError(e); }
  view = { id: inc.id, conversationId: inc.conversationId, kind: inc.kind, outgoing: false, other: inc.from, phase: 'connecting', endText: null,
    answeredAt: null, serverSkew: 0, muted: false, camOn: inc.kind === 'video', theirCamOn: inc.kind === 'video', facing: 'user', quality: 3, local, remote: null, relay: false };
  api.holdLive(true);
  emit();
  try {
    const c: any = await api.callAnswer(inc.id, true);
    if (c.status !== 'active') { applyServer(c); if (view && view.phase !== 'ended') finish(END_TEXT[c.status] || 'Call ended'); return null; }
    applyServer(c);
  } catch (e) { finish('Call failed'); return api.friendly(e); }
  begin(inc.id, 'callee');
  return null;
}
export const declineCall = (id: string) => api.callAnswer(id, false).catch(() => {});

function begin(id: string, role: 'caller' | 'callee') {
  flow = { id, role, pc: null, channel: null, ready: false, connected: false, ended: false, early: [], pending: [], localCands: [],
    seen: new Set(), lastSig: 0, timers: [], troubleSince: null, subscribed: false };
  const f = flow;
  f.channel = api.callChannel(id, {
    onState: (s) => { if (flow === f) applyServer({ ...s, now: null }); },
    onSignal: (m) => { if (flow === f && m && m.from !== role) take({ ...m, live: true }); },
    onStatus: (st) => { if (flow !== f) return; if (st === 'SUBSCRIBED') { f.subscribed = true; if (f.ready && role === 'callee') send({ t: 'hello' }); } },
  });
  (async () => {
    try {
      const ice = await api.callIce(id);
      if (flow !== f || f.ended) return;
      setView({ relay: !!ice.relay });
      f.pc = makePeer(ice.iceServers || []);
      f.ready = true;
      f.early.splice(0).forEach((d) => onSignal(d));
      if (role === 'callee') send({ t: 'hello' });
    } catch { if (flow === f) { api.callEnd(id, 'failed').catch(() => {}); finish('Call failed'); } }
  })();
  pull();
  // The person called keeps saying "ready" until connected; the caller repeats its offer when it hears it.
  f.timers.push(setInterval(() => { if (flow === f && f.ready && !f.connected && role === 'callee' && view && view.phase !== 'ringing') send({ t: 'hello' }); }, 2500));
  // Check in every 10 s (ringing or live); the server ends silent calls. Also catches missed state changes.
  f.timers.push(setInterval(async () => { if (flow !== f) return; try { applyServer(await api.callBeat(id)); } catch { /* next time */ } }, 10000));
  // While ringing, ask for the call's state every 3 s too (answered / declined / missed).
  f.timers.push(setInterval(async () => {
    if (flow !== f || !view || view.phase !== 'ringing') return;
    try { applyServer(await api.callGet(id)); } catch { /* next time */ }
  }, 3000));
}

const send = (data: any) => { if (flow) api.callSignal(flow.id, data).catch(() => {}); };
function take(m: any) {
  if (!flow || !m) return;
  if (m.id != null) {
    if (flow.seen.has(m.id)) return;
    flow.seen.add(m.id);
    if (m.id > flow.lastSig && !m.live) flow.lastSig = m.id;
  }
  onSignal(m.data || {});
}
async function pull() {
  const f = flow; if (!f || f.ended) return;
  try { (await api.callSignalsSince(f.id, f.lastSig) || []).forEach((m: any) => take(m)); } catch { /* next time */ }
  if (flow !== f || f.ended) return;
  f.timers.push(setTimeout(pull, f.connected ? 5000 : 1000));
}

function makePeer(iceServers: RTCIceServer[]) {
  const pc = new RTCPeerConnection({ iceServers, bundlePolicy: 'max-bundle' });
  const local = view && view.local;
  if (local) local.getTracks().forEach((t) => pc.addTrack(t, local));
  pc.onicecandidate = (e) => { if (e.candidate && flow) { const c = e.candidate.toJSON(); flow.localCands.push(c); send({ t: 'ice', c }); } };
  pc.ontrack = (e) => { if (view && view.remote !== e.streams[0]) setView({ remote: e.streams[0] }); };
  pc.onconnectionstatechange = () => {
    const st = pc.connectionState;
    if (st === 'connected') onConnected();
    else if (st === 'disconnected' || st === 'failed') onTrouble(st);
  };
  return pc;
}
const desc = (d: RTCSessionDescription | null) => d && { type: d.type, sdp: d.sdp };
let makingOffer = false;
async function offer(restart = false) {
  const pc = flow && flow.pc; if (!pc || !flow) return;
  if (makingOffer) return;   // two "ready" messages at once: one offer is enough
  makingOffer = true;
  try { await makeOffer(pc, restart); } catch { /* the next "ready" or retry tries again */ } finally { makingOffer = false; }
}
async function makeOffer(pc: RTCPeerConnection, restart: boolean) {
  if (!flow) return;
  if (pc.signalingState === 'have-local-offer' && !restart) { send({ t: 'offer', sdp: desc(pc.localDescription) }); resendCands(); return; }
  if (restart && pc.signalingState === 'have-local-offer') { try { await pc.setLocalDescription({ type: 'rollback' }); } catch { /* ignore */ } }
  if (pc.signalingState !== 'stable') return;
  if (restart) flow.localCands = [];
  await pc.setLocalDescription(await pc.createOffer({ iceRestart: restart }));
  send({ t: 'offer', sdp: desc(pc.localDescription) });
}
function resendCands() { (flow ? flow.localCands : []).forEach((c) => send({ t: 'ice', c })); }
function flushIce() { const pc = flow && flow.pc; if (pc && flow) flow.pending.splice(0).forEach((c) => pc.addIceCandidate(c).catch(() => {})); }
async function onSignal(d: any) {
  const f = flow; if (!f || f.ended) return;
  const pc = f.pc;
  if (!pc) { if (f.early.length < 300) f.early.push(d); return; }
  try {
    if (d.t === 'hello') { if (f.role === 'caller' && !f.connected && !pc.remoteDescription) { if (view && view.phase === 'ringing') setView({ phase: 'connecting' }); offer(); } return; }
    if (d.t === 'offer' && f.role === 'callee') {
      if (pc.remoteDescription && pc.localDescription && pc.remoteDescription.sdp === d.sdp.sdp) { send({ t: 'answer', sdp: desc(pc.localDescription) }); resendCands(); return; }
      await pc.setRemoteDescription(d.sdp);
      await pc.setLocalDescription(await pc.createAnswer());
      send({ t: 'answer', sdp: desc(pc.localDescription) });
      resendCands(); flushIce();
    } else if (d.t === 'answer' && f.role === 'caller' && pc.signalingState === 'have-local-offer') {
      await pc.setRemoteDescription(d.sdp); flushIce();
    } else if (d.t === 'ice') {
      if (pc.remoteDescription) await pc.addIceCandidate(d.c).catch(() => {}); else f.pending.push(d.c);
    } else if (d.t === 'restart' && f.role === 'caller') offer(true);
    else if (d.t === 'cam') setView({ theirCamOn: !!d.on });
  } catch { /* a bad message never breaks the call */ }
}
function onConnected() {
  if (!flow || !view) return;
  flow.connected = true; flow.troubleSince = null;
  setView({ phase: 'active', quality: 3 });
  if (view.kind === 'video') send({ t: 'cam', on: view.camOn });
}
function onTrouble(st: string) {
  const f = flow; if (!f || f.ended || !view) return;
  f.connected = false;
  f.troubleSince = f.troubleSince || Date.now();
  setView({ phase: 'reconnecting', quality: st === 'failed' ? 0 : 1 });
  if (f.role === 'caller') offer(true); else send({ t: 'restart' });
  f.timers.push(setTimeout(() => {
    if (flow === f && !f.ended && !f.connected && f.troubleSince && Date.now() - f.troubleSince >= 19000) { api.callEnd(f.id, 'failed').catch(() => {}); finish('Call dropped'); }
  }, 20000));
}

// ---- Controls ----------------------------------------------------------------------------------------
export function toggleMute() {
  if (!view || !view.local) return;
  const muted = !view.muted;
  view.local.getAudioTracks().forEach((t) => { t.enabled = !muted; });
  setView({ muted });
}
export function toggleCamera() {
  if (!view || !view.local || view.kind !== 'video') return;
  const camOn = !view.camOn;
  view.local.getVideoTracks().forEach((t) => { t.enabled = camOn; });
  setView({ camOn });
  send({ t: 'cam', on: camOn });
}
export async function flipCamera() {
  if (!view || !view.local || view.kind !== 'video' || !flow) return;
  const facing = view.facing === 'user' ? 'environment' : 'user';
  try {
    const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { exact: facing }, width: { ideal: 640 }, height: { ideal: 480 } } });
    const track = s.getVideoTracks()[0];
    const sender = flow.pc && flow.pc.getSenders().find((x) => x.track && x.track.kind === 'video');
    if (sender) await sender.replaceTrack(track);
    view.local.getVideoTracks().forEach((t) => { t.stop(); view!.local!.removeTrack(t); });
    track.enabled = view.camOn;
    view.local.addTrack(track);
    setView({ facing, local: view.local });
  } catch { /* phone has one camera */ }
}
/** Hang up (or cancel while ringing). */
export function hangUp() {
  if (!view) return;
  const id = view.id;
  if (id) api.callEnd(id, 'hangup').catch(() => {});
  finish(view.phase === 'ringing' || view.phase === 'calling' ? 'Call cancelled' : 'Call ended');
}

function stopLocal() { if (view && view.local) view.local.getTracks().forEach((t) => t.stop()); }
function finish(text: string) {
  if (!view || view.phase === 'ended') return;
  const f = flow;
  if (f) { f.ended = true; f.timers.forEach((t) => { clearInterval(t); clearTimeout(t); }); f.channel && f.channel.leave(); try { f.pc && f.pc.close(); } catch { /* ignore */ } }
  flow = null;
  stopLocal();
  api.holdLive(false);
  setView({ phase: 'ended', endText: text, remote: null });
  const id = view.id, conv = view.conversationId;
  setTimeout(() => { if (view && view.id === id && view.phase === 'ended') { view = null; emit(); } }, 1800);
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('th-call-ended', { detail: { conversationId: conv } }));
}
