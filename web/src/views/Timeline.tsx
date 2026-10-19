// Deadline board, built on Bryntum Scheduler: one row per dispute, bars for
// each phase of the case, a band on the day the seller's response is due,
// and a live "now" line.
import '@bryntum/scheduler/fontawesome/css/fontawesome.css';
import '@bryntum/scheduler/fontawesome/css/solid.css';
import '@bryntum/scheduler/scheduler.css';
import '@bryntum/scheduler/svalbard-light.css';
import './timeline.css';

import { StringHelper } from '@bryntum/scheduler';
import { BryntumScheduler, type BryntumSchedulerProps } from '@bryntum/scheduler-react';
import { useMemo } from 'react';
import { REASON_LABEL } from '../../../shared/playbook';
import { fmtMoney, type Overview } from '../api';
import { go } from '../App';

const DAY = 86_400_000;

function startOfDay(t: number) {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d;
}

export default function TimelineView({ overview }: { overview?: Overview }) {
  const data = useMemo(() => {
    const now = Date.now();
    const rows = (overview?.rows ?? []).filter((r) => r.dispute.status !== 'RESOLVED' || now - Date.parse(r.dispute.updatedAt) < 7 * DAY);
    const resources = rows.map((r) => ({
      id: r.dispute.id,
      name: `${r.dispute.id}`,
      reason: REASON_LABEL[r.dispute.reason],
      amount: fmtMoney(r.dispute.amount.value, r.dispute.amount.currency_code),
      buyer: r.dispute.buyerName ?? r.dispute.buyerEmail ?? '',
    }));
    const events: Record<string, unknown>[] = [];
    const ranges: Record<string, unknown>[] = [];
    for (const r of rows) {
      const d = r.dispute;
      const opened = Date.parse(d.createdAt);
      const due = d.sellerResponseDueDate ? Date.parse(d.sellerResponseDueDate) : opened + 10 * DAY;
      const decidedAt = r.decision ? Date.parse(r.decision.at) : undefined;
      const closed = d.status === 'RESOLVED';
      const endOfWork = decidedAt ?? (closed ? Date.parse(d.updatedAt) : Math.max(now, opened + DAY / 4));
      events.push({
        id: `${d.id}-open`, resourceId: d.id, name: decidedAt ? 'Agent drafted, you approved' : 'Agent assessed, waiting for you',
        startDate: new Date(opened), endDate: new Date(Math.max(endOfWork, opened + DAY / 3)),
        eventColor: decidedAt ? '#1f7a5a' : r.caseStatus === 'needs_edit' ? '#a8660d' : '#17324d', phase: decidedAt ? 'done' : 'open',
      });
      if (!decidedAt && !closed) {
        events.push({
          id: `${d.id}-window`, resourceId: d.id, name: `${Math.max(0, Math.round((due - now) / DAY))} days left to respond`,
          startDate: new Date(Math.max(now, opened + DAY / 3)), endDate: new Date(Math.max(due, now + DAY / 3)),
          eventColor: due - now < 3 * DAY ? '#b23b31' : '#c9a227', eventStyle: 'hollow', phase: 'window',
        });
      }
      if (decidedAt) {
        events.push({
          id: `${d.id}-review`, resourceId: d.id, name: closed ? (d.outcome === 'RESOLVED_SELLER_FAVOUR' ? 'Won' : d.outcome === 'RESOLVED_BUYER_FAVOUR' ? 'Lost' : 'Closed') : 'PayPal reviewing',
          startDate: new Date(decidedAt), endDate: new Date(closed ? Math.max(Date.parse(d.updatedAt), decidedAt + DAY / 3) : now + 5 * DAY),
          eventColor: closed ? (d.outcome === 'RESOLVED_SELLER_FAVOUR' ? '#1f7a5a' : '#b23b31') : '#2c5f9e', eventStyle: closed ? 'plain' : 'hollow', phase: 'review',
        });
      }
      if (!closed && !decidedAt) {
        ranges.push({ id: `due-${d.id}`, resourceId: d.id, name: 'Due', startDate: startOfDay(due), endDate: new Date(startOfDay(due).getTime() + DAY), cls: 'due-band' });
      }
    }
    return { resources, events, ranges };
  }, [overview]);

  if (!overview) return <div className="empty"><span className="spin" /> Loading…</div>;

  const props: BryntumSchedulerProps = {
    startDate: startOfDay(Date.now() - 10 * DAY),
    endDate: startOfDay(Date.now() + 15 * DAY),
    viewPreset: 'dayAndWeek',
    rowHeight: 58,
    barMargin: 9,
    readOnly: true,
    resources: data.resources,
    events: data.events,
    resourceTimeRanges: data.ranges,
    resourceTimeRangesFeature: true,
    timeRangesFeature: { showCurrentTimeLine: { name: 'Now' } as never },
    columns: [
      {
        text: 'Dispute', field: 'name', width: 250,
        htmlEncode: false,
        renderer: ({ record }: { record: { get: (k: string) => string } }) =>
          `<div class="tl-res"><b>${StringHelper.encodeHtml(record.get('reason'))}</b> · ${StringHelper.encodeHtml(record.get('amount'))}<div class="tl-sub">${StringHelper.encodeHtml(record.get('name'))} · ${StringHelper.encodeHtml(record.get('buyer'))}</div></div>`,
      },
    ] as never,
    eventTooltipFeature: {
      template: ({ eventRecord, startClockHtml, endClockHtml }) =>
        `<div class="b-sch-event-title">${StringHelper.encodeHtml(eventRecord.name ?? '')}</div><div>${startClockHtml} – ${endClockHtml}</div><div class="tl-sub">Click to open the case</div>`,
    },
    onEventClick: ({ resourceRecord }) => go(`/cases/${resourceRecord.id}`),
    onCellClick: ({ record }: { record: { id: string } }) => go(`/cases/${record.id}`),
  } as BryntumSchedulerProps;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Deadlines</h1>
          <p>Every case on one timeline. PayPal closes a dispute in the buyer's favour if the seller misses the response date, so the agent works the reddest bars first.</p>
        </div>
      </div>
      <div className="row small muted" style={{ marginBottom: 10, gap: 14 }}>
        <span><i className="legend" style={{ background: '#17324d' }} /> Waiting for your approval</span>
        <span><i className="legend hollow" style={{ borderColor: '#c9a227' }} /> Response window</span>
        <span><i className="legend" style={{ background: 'rgba(178,59,49,.18)' }} /> Due date</span>
        <span><i className="legend hollow" style={{ borderColor: '#2c5f9e' }} /> PayPal reviewing</span>
        <span><i className="legend" style={{ background: '#1f7a5a' }} /> Approved or won</span>
      </div>
      {data.resources.length === 0 ? (
        <div className="card empty">No open disputes to plot.</div>
      ) : (
        <div className="card tl-host" style={{ height: Math.min(620, 90 + data.resources.length * 58) }}>
          <BryntumScheduler {...props} />
        </div>
      )}
    </>
  );
}
