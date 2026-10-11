import { leadOrg, leadTitle, statusOf, STATUS_OPTIONS, subjectName, type CardItem, type Kind } from './today';

// Tracker and History as a sheet: the same rows on screen, copied for
// Google Sheets / Excel (tab-separated), or downloaded as CSV.

export type SheetMode = 'tracker' | 'history';

export const rateOf = (item: CardItem) => {
  const l = item.lead;
  if (!l) return '';
  if (l.rate_min || l.rate_max) return `$${Math.round(Number(l.rate_min ?? l.rate_max))}${l.rate_max && l.rate_max !== l.rate_min ? `-${Math.round(Number(l.rate_max))}` : ''}/hr`;
  return l.pay ?? '';
};
export const dayOf = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
export const postUrl = (item: CardItem) => item.lead?.apply_url || item.lead?.post_url || (item.lead ? `${location.origin}/${item.lead.kind === 'job' ? 'job' : 'hotlist'}/${item.lead.id}` : '');
export const fitOf = (item: CardItem) => item.fit ?? Math.round(item.similarity * 100);

export function sheetRows(items: CardItem[], kind: Kind, mode: SheetMode, dateLabel: string, dateOf: (i: CardItem) => string | null): string[][] {
  const head = mode === 'tracker'
    ? ['Job', 'Company', kind === 'hotlist' ? 'Profile' : 'Your job', 'Location', 'Rate', dateLabel, 'Via', 'Status', 'Notes', 'Link']
    : ['Job', 'Company', kind === 'hotlist' ? 'Profile' : 'Your job', 'Fit', 'Location', 'Rate', dateLabel, 'Link'];
  const rows = items.filter((i) => i.lead).map((i) => {
    const status = STATUS_OPTIONS.find((o) => o.value === statusOf(i))?.label ?? '';
    const via = i.how === 'site' ? 'Their site' : kind === 'job' ? 'Asked resume' : 'Email';
    return mode === 'tracker'
      ? [leadTitle(i.lead!), leadOrg(i.lead!), subjectName(kind, i.subject), i.lead!.location ?? '', rateOf(i), dayOf(dateOf(i)), via, status, i.notes ?? '', postUrl(i)]
      : [leadTitle(i.lead!), leadOrg(i.lead!), subjectName(kind, i.subject), `${fitOf(i)}%`, i.lead!.location ?? '', rateOf(i), dayOf(dateOf(i)), postUrl(i)];
  });
  return [head, ...rows];
}

// Pasted into Google Sheets or Excel, each value lands in its own cell.
export async function copyRows(rows: string[][]) {
  const tsv = rows.map((r) => r.map((v) => String(v).replace(/[\t\n\r]+/g, ' ')).join('\t')).join('\n');
  await navigator.clipboard.writeText(tsv);
}

export function downloadCsv(rows: string[][], name: string) {
  const csv = rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: `${name}.csv` });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
