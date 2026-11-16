'use client';
// Calls (audio and video in private chats): how many, how they went, when people call. Numbers only:
// calls are never recorded, so there is nothing to listen to or watch. Database: staff_calls().
import { useState } from 'react';
import { rpc } from '@/lib/sb';
import { n, pct, dayLabel } from '@/lib/fmt';
import { Bars, Donut } from './charts';
import { useGo } from './Shell';
import { Card, Empty, ErrorBox, PageHead, Pill, Spinner, useAsync } from './ui';

type Data = {
  live_now: number; ringing_now: number; today: number; calls: number; audio: number; video: number; answered: number; missed: number;
  declined: number; cancelled: number; busy: number; failed: number; talk_minutes: number; avg_seconds: number; callers: number; chats: number;
  daily: { day: string; calls: number; answered: number; minutes: number }[]; by_hour: { hour: number; calls: number }[];
  top_callers: { handle: string; calls: number; answered: number; unanswered: number; people: number }[];
};
const dur = (s: number) => (s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`);

export default function Calls() {
  const go = useGo();
  const [days, setDays] = useState(30);
  const d = useAsync(() => rpc<Data>('staff_calls', { p_days: days }), [days]);
  const x = d.data;
  const hours = Array.from({ length: 24 }, (_, h) => (x?.by_hour.find((r) => r.hour === h)?.calls) || 0);
  return (
    <>
      <PageHead title="Calls" sub="Audio and video calls in private chats. Calls go phone to phone and are never recorded: these are counts only."
        actions={<select className="select" value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Period"><option value={7}>7 days</option><option value={30}>30 days</option><option value={90}>90 days</option></select>} />
      {d.error && <ErrorBox text={d.error} retry={d.reload} />}
      {d.loading && !x && <Spinner />}
      {x && <>
        <div className="kpis small">
          <div className="kpi"><span className="kpi-l">On a call now</span><div className="kpi-v"><b>{n(x.live_now)}</b></div><p className="kpi-hint">{n(x.ringing_now)} ringing · {n(x.today)} calls today</p></div>
          <div className="kpi"><span className="kpi-l">Calls ({days} days)</span><div className="kpi-v"><b>{n(x.calls)}</b></div><p className="kpi-hint">{n(x.audio)} audio · {n(x.video)} video</p></div>
          <div className="kpi"><span className="kpi-l">Answered</span><div className="kpi-v"><b>{pct(x.answered, x.calls)}</b></div><p className="kpi-hint">{n(x.answered)} calls</p></div>
          <div className="kpi"><span className="kpi-l">Talk time</span><div className="kpi-v"><b>{n(x.talk_minutes)} min</b></div><p className="kpi-hint">average call {dur(Number(x.avg_seconds))}</p></div>
          <div className="kpi"><span className="kpi-l">People calling</span><div className="kpi-v"><b>{n(x.callers)}</b></div><p className="kpi-hint">in {n(x.chats)} chats</p></div>
          <div className="kpi"><span className="kpi-l">Couldn’t connect / dropped</span><div className="kpi-v"><b>{pct(x.failed, x.answered + x.failed)}</b></div><p className="kpi-hint">{n(x.failed)} calls{x.failed > (x.answered + x.failed) * 0.15 ? ' · worth checking the relay' : ''}</p></div>
        </div>
        {x.calls === 0 ? <Card title="No calls yet"><Empty text="Calls appear here once members start calling each other." icon="phone" /></Card> : <>
          <Card title="Calls per day" sub={`Last ${days} days, Lagos time`}>
            <Bars height={220} labels={x.daily.map((r) => dayLabel(r.day))} series={[
              { name: 'Calls', color: '#12b9f5', values: x.daily.map((r) => r.calls) },
              { name: 'Answered', color: '#ff3f9b', values: x.daily.map((r) => r.answered) }]} />
          </Card>
          <div className="row-2 even">
            <Card title="How calls ended">
              <Donut size={170} center={pct(x.answered, x.calls)} sub="answered" parts={[
                { name: 'Answered', value: x.answered, color: '#22c55e' },
                { name: 'Missed', value: x.missed, color: '#f59e0b' },
                { name: 'Declined', value: x.declined, color: '#ef4444' },
                { name: 'Cancelled', value: x.cancelled, color: '#8b7bff' },
                { name: 'Busy', value: x.busy, color: '#94a3b8' }]} />
            </Card>
            <Card title="When people call" sub="Calls by hour, Lagos time">
              <Bars height={200} labels={hours.map((_, h) => `${h}`)} series={[{ name: 'Calls', color: '#b46cff', values: hours }]} />
            </Card>
          </div>
          <Card title="Most active callers" sub="Many unanswered calls to many people can mean unwanted calling." pad={false}>
            <table className="tbl"><thead><tr><th>Member</th><th>Calls</th><th>Answered</th><th>Not answered</th><th>People called</th></tr></thead>
              <tbody>{x.top_callers.map((r) => (
                <tr key={r.handle} className="click" onClick={() => go(`/members/${encodeURIComponent(r.handle)}`)}>
                  <td><b>{r.handle}</b></td><td>{n(r.calls)}</td><td>{pct(r.answered, r.calls)}</td>
                  <td>{r.unanswered >= 10 && r.unanswered > r.calls * 0.7 ? <Pill tone="amber">{n(r.unanswered)}</Pill> : n(r.unanswered)}</td>
                  <td>{n(r.people)}</td>
                </tr>))}</tbody></table>
          </Card>
        </>}
      </>}
    </>
  );
}
