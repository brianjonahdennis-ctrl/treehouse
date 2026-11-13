'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */
// Report / block during a speed date (the sheet from reportSheet in anon-inbox/public/hy-speed.js).
import { useState } from 'react';
import * as api from '@/lib/api';
import { Icon } from './ui';
import { openSheet, toast } from './overlay';

const REASONS: [string, string][] = [['harassment', 'Harassment'], ['sexual', 'Sexual misconduct'], ['inappropriate', 'Inappropriate behaviour'],
  ['recording', 'Screenshotted or recorded me'], ['impersonation', 'Impersonation'], ['underage', 'Underage participant'], ['other', 'Other']];
// Labels the database doesn't have its own category for go in front of the details.
const label = (r: string | null) => (r === 'recording' ? 'Screenshotted or recorded without consent. ' : '');

export function speedReportSheet(s: any, onBlocked: () => void) {
  openSheet((close) => <Form s={s} close={close} onBlocked={onBlocked} />, { label: 'Report or block' });
}
function Form({ s, close, onBlocked }: { s: any; close: () => void; onBlocked: () => void }) {
  const [reason, setReason] = useState<string | null>(null);
  const [details, setDetails] = useState('');
  const send = async (block: boolean, withReason: boolean) => {
    try {
      if (!withReason) await api.speedReport(s.id, null, '', true);
      else await api.speedReport(s.id, reason === 'recording' ? 'other' : (reason || 'other'), label(reason) + details.trim(), block);
      close();
      if (block) { toast(withReason ? 'Reported and blocked' : 'Blocked', 'shield'); onBlocked(); }
      else toast('Thanks. We’ll review it.', 'flag');
    } catch (e) { toast(api.friendly(e), 'x'); }
  };
  return (
    <>
      <h2>{`Report ${s.other ? s.other.handle : 'this person'}`}</h2>
      <p className="small muted">Reports are private and reviewed within 24 hours. Blocking ends the call and you’ll never be paired again.</p>
      <div className="menu-list">{REASONS.map(([v, l]) => (
        <button key={v} className={`menu-item ${reason === v ? 'on' : ''}`} onClick={() => setReason(v)}>{l}{reason === v ? <Icon name="check" cls="sm" /> : null}</button>))}</div>
      <textarea className="textarea" maxLength={500} placeholder="What happened? (optional)" value={details} onChange={(e) => setDetails(e.target.value)} />
      <div className="sheet-actions">
        <button className="btn btn-danger btn-block" onClick={() => send(true, true)}>Report & block</button>
        <button className="btn btn-soft btn-block" onClick={() => { if (!reason) { toast('Choose a reason', 'info'); return; } send(false, true); }}>Report only</button>
        <button className="btn btn-soft btn-block" onClick={() => send(true, false)}>Block only</button>
        <button className="btn btn-soft btn-block" onClick={close}>Cancel</button>
      </div>
    </>
  );
}
