'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */
// Voice notes in private chats. Same unlock rule as photos (the database decides). Up to 60 seconds.
// Played once: when the recipient taps play, the note is downloaded, marked played and deleted from
// storage straight away, then plays from this phone's memory and is gone.
import { useEffect, useRef, useState } from 'react';
import * as api from '@/lib/api';
import { openSheet, toast } from './overlay';
import { Icon } from './ui';

const MAX_MS = 60000;
const fmt = (ms: number) => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
function pickType() {
  const R: any = typeof window !== 'undefined' && (window as any).MediaRecorder;
  if (!R) return null;
  for (const [t, ext] of [['audio/webm;codecs=opus', 'webm'], ['audio/webm', 'webm'], ['audio/mp4', 'm4a'], ['audio/ogg;codecs=opus', 'ogg']] as const) {
    if (R.isTypeSupported && R.isTypeSupported(t)) return { type: t, ext };
  }
  return null;
}

/** Record a voice note, then send it with `send(blob, ext, ms)`. */
export function openRecorder(send: (blob: Blob, ext: string, ms: number) => Promise<void>) {
  const kind = pickType();
  if (!kind || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    toast('Voice notes need a newer browser or app on this phone', 'x');
    return;
  }
  openSheet((close) => <Recorder kind={kind} close={close} send={send} />, { label: 'Voice note' });
}
function Recorder({ kind, close, send }: { kind: { type: string; ext: string }; close: () => void; send: (b: Blob, ext: string, ms: number) => Promise<void> }) {
  const [ms, setMs] = useState(0);
  const [phase, setPhase] = useState<'starting' | 'recording' | 'sending' | 'error'>('starting');
  const rec = useRef<any>(null), stream = useRef<MediaStream | null>(null), chunks = useRef<Blob[]>([]), started = useRef(0), cancelled = useRef(false);
  useEffect(() => {
    let tick: any = null, alive = true;
    cancelled.current = false; chunks.current = [];
    (async () => {
      try {
        const st = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (!alive) { st.getTracks().forEach((t) => t.stop()); return; }
        stream.current = st;
        const R: any = (window as any).MediaRecorder;
        rec.current = new R(stream.current, { mimeType: kind.type, audioBitsPerSecond: 32000 });
        rec.current.ondataavailable = (e: any) => { if (e.data && e.data.size) chunks.current.push(e.data); };
        rec.current.onstop = async () => {
          clearInterval(tick);
          stream.current?.getTracks().forEach((t) => t.stop());
          if (cancelled.current) return;
          const dur = Math.min(Date.now() - started.current, MAX_MS);
          if (dur < 700) { toast('Hold on a little longer to record', 'x'); close(); return; }
          setPhase('sending');
          try { await send(new Blob(chunks.current, { type: kind.type.split(';')[0] }), kind.ext, dur); close(); }
          catch (e) { toast(api.friendly(e), 'x'); close(); }
        };
        rec.current.start(250);
        started.current = Date.now();
        setPhase('recording');
        tick = setInterval(() => {
          const d = Date.now() - started.current;
          setMs(d);
          if (d >= MAX_MS && rec.current && rec.current.state === 'recording') rec.current.stop();   // 60 s: send it
        }, 200);
      } catch { setPhase('error'); }
    })();
    // Closing the sheet while recording = cancel (a note already being sent is left alone).
    return () => { alive = false; clearInterval(tick); if (rec.current && rec.current.state === 'recording') { cancelled.current = true; try { rec.current.stop(); } catch {} } };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (phase === 'error') return (
    <>
      <h2>Microphone needed</h2>
      <p className="small muted">Allow treehouse to use your microphone to record voice notes, then try again.</p>
      <div className="sheet-actions"><button className="btn btn-soft btn-block" onClick={close}>Close</button></div>
    </>
  );
  return (
    <>
      <h2>Voice note</h2>
      <div className="vn-rec">
        <span className={`vn-dot ${phase === 'recording' ? 'on' : ''}`} aria-hidden="true" />
        <b className="vn-time">{fmt(ms)}</b><span className="tiny muted">{` / ${fmt(MAX_MS)}`}</span>
      </div>
      <p className="tiny muted center">{phase === 'starting' ? 'Starting the microphone…' : phase === 'sending' ? 'Sending…' : 'Recording. They can play it once, then it’s deleted.'}</p>
      <div className="sheet-actions">
        <button className="btn btn-primary btn-block" disabled={phase !== 'recording'} onClick={() => { if (rec.current && rec.current.state === 'recording') rec.current.stop(); }}><Icon name="send" cls="sm" />Send</button>
        <button className="btn btn-soft btn-block" disabled={phase === 'sending'} onClick={() => { cancelled.current = true; try { rec.current && rec.current.state === 'recording' && rec.current.stop(); } catch {} close(); }}>Cancel</button>
      </div>
    </>
  );
}

/** A voice note in the chat. Sender: length + played/not played. Recipient: play once. */
export function VoiceBubble({ m, mine, onPlayed }: { m: any; mine: boolean; onPlayed: (at: string) => void }) {
  const [state, setState] = useState<'idle' | 'loading' | 'playing'>('idle');
  const [pos, setPos] = useState(0);
  const len = m.voice_ms || 0;
  if (mine) {
    return (
      <span className="vn-bubble">
        <span className="vn-ico" aria-hidden="true">🎤</span>
        <span className="grow"><b>Voice note</b><span className="tiny">{`${fmt(len)} · ${m.voice_played_at ? 'Played' : m.pending ? 'Sending…' : 'Not played yet'}`}</span></span>
      </span>
    );
  }
  if (m.voice_played_at && state === 'idle') {
    return <span className="vn-bubble played"><span className="vn-ico" aria-hidden="true">🎤</span><span className="grow"><b>Voice note</b><span className="tiny">{`${fmt(len)} · Played`}</span></span></span>;
  }
  const play = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (state !== 'idle') return;
    setState('loading');
    try {
      const blob = await api.voiceBlob(m.voice);            // fetch it first...
      const at = new Date().toISOString();
      await api.voicePlayed(m.id);                           // ...then it's played: no second listen
      api.removeVoice(m.voice);                              // and the file is deleted now
      onPlayed(at);
      const url = URL.createObjectURL(blob);
      const a = new Audio(url);
      a.ontimeupdate = () => setPos(a.currentTime * 1000);
      a.onended = () => { URL.revokeObjectURL(url); setState('idle'); };
      a.onerror = () => { URL.revokeObjectURL(url); setState('idle'); toast('This voice note couldn’t play on this phone', 'x'); };
      setState('playing');
      await a.play();
    } catch (err) { setState('idle'); toast(api.friendly(err), 'x'); }
  };
  return (
    <span className="vn-bubble">
      <button type="button" className="vn-play" aria-label="Play voice note (once)" onClick={play} disabled={state !== 'idle'}>
        {state === 'loading' ? '…' : state === 'playing' ? '▶︎' : '▶'}
      </button>
      <span className="grow"><b>Voice note</b>
        <span className="vn-bar"><i style={{ width: `${len ? Math.min(100, (pos / len) * 100) : 0}%` }} /></span>
        <span className="tiny">{state === 'playing' ? `${fmt(pos)} / ${fmt(len)}` : `${fmt(len)} · plays once`}</span></span>
    </span>
  );
}
