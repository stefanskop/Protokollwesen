import type { Protocol, Item, Entry, Project, Settings, GroupBy, Contact, Company } from './model';

export const pad = (n: number, len: number) => String(n).padStart(len, '0');

export function protocolCode(prefix: string, seq: number) {
  return `${prefix}${pad(seq, 2)}`;
}

export function itemCode(protocolCode: string, seq: number) {
  return `${protocolCode}.${pad(seq, 3)}`;
}

/** nächste freie Punktnummer innerhalb eines Protokolls (nur Punkte, die dort entstanden sind) */
export function nextItemSeq(protocol: Protocol, items: Item[]) {
  let max = 0;
  for (const i of items) {
    if (i.originProtocolId !== protocol.id || i.deleted) continue;
    const m = /\.(\d+)$/.exec(i.code);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return max + 1;
}

export function nextProtocolSeq(projectId: string, typeKey: string, protocols: Protocol[]) {
  let max = 0;
  for (const p of protocols) if (p.projectId === projectId && p.typeKey === typeKey && !p.deleted) max = Math.max(max, p.seq);
  return max + 1;
}

/** Vorheriges Protokoll derselben Art (für Übernahme offener Punkte) */
export function previousProtocol(protocol: Pick<Protocol, 'projectId' | 'typeKey' | 'seq'>, protocols: Protocol[]) {
  return protocols
    .filter((p) => !p.deleted && p.projectId === protocol.projectId && p.typeKey === protocol.typeKey && p.seq < protocol.seq)
    .sort((a, b) => b.seq - a.seq)[0];
}

/** Punkte, die aus dem Vorprotokoll übernommen werden: alles außer "erledigt". */
export function carryOverItemIds(prev: Protocol | undefined, items: Map<string, Item>, includeInfo = true) {
  if (!prev) return [];
  return prev.itemIds.filter((id) => {
    const it = items.get(id);
    if (!it || it.deleted) return false;
    if (it.status === 'erledigt') return false;
    if (it.status === 'info' && !includeInfo) return false;
    return true;
  });
}

/** Einträge sind gesperrt, wenn ihr Protokoll fortlaufend und abgeschlossen ist. */
export function isEntryLocked(entry: Entry, protocols: Map<string, Protocol>) {
  const p = protocols.get(entry.protocolId);
  return !!p && p.mode === 'fortlaufend' && p.status === 'abgeschlossen';
}

export function isProtocolLocked(p: Protocol) {
  return p.mode === 'fortlaufend' && p.status === 'abgeschlossen';
}

/** Einträge eines Punktes, die in einem bestimmten Protokoll sichtbar sind (Historie bis inkl. dieses Protokolls). */
export function entriesForItemInProtocol(item: Item, protocol: Protocol, entries: Entry[], protocols: Map<string, Protocol>) {
  return entries
    .filter((e) => {
      if (e.deleted || e.itemId !== item.id) return false;
      if (e.protocolId === protocol.id) return true;
      const ep = protocols.get(e.protocolId);
      if (!ep) return false;
      // Historie aus früheren Protokollen (gleiche Art: niedrigere Nummer; andere Art: früheres Datum)
      if (ep.typeKey === protocol.typeKey) return ep.seq < protocol.seq;
      return ep.date < protocol.date || (ep.date === protocol.date && ep.id < protocol.id);
    })
    .sort((a, b) => (a.date === b.date ? (a.createdAt || '').localeCompare(b.createdAt || '') : a.date.localeCompare(b.date)));
}

export function groupKey(item: Item, groupBy: GroupBy) {
  switch (groupBy) {
    case 'category':
      return item.category || '';
    case 'trade':
      return item.trade || '';
    case 'itemType':
      return item.itemType || '';
    default:
      return '';
  }
}

export const SNAPSHOT_FIELDS: (keyof Item)[] = ['title', 'status', 'priority', 'companyId', 'responsibleId', 'observerIds', 'itemType', 'trade', 'category', 'location', 'dueFrom', 'dueTo', 'doneAt'];

export function makeSnapshot(protocol: Protocol, items: Map<string, Item>) {
  const snap: Record<string, Partial<Item>> = {};
  for (const id of protocol.itemIds) {
    const it = items.get(id);
    if (!it) continue;
    const s: any = {};
    for (const f of SNAPSHOT_FIELDS) s[f] = (it as any)[f] ?? null;
    snap[id] = s;
  }
  return snap;
}

/** Punkt so, wie er in diesem Protokoll erscheint (bei abgeschlossenen Protokollen eingefroren) */
export function itemInProtocol(item: Item, protocol: Protocol): Item {
  const s = protocol.snapshot?.[item.id];
  return s ? ({ ...item, ...s } as Item) : item;
}

/** Sortierte und gruppierte Punkte eines Protokolls */
export function groupedItems(protocol: Protocol, items: Map<string, Item>) {
  const list = protocol.itemIds
    .map((id) => items.get(id))
    .filter((i): i is Item => !!i && !i.deleted)
    .map((i) => itemInProtocol(i, protocol));
  list.sort((a, b) => {
    const ga = groupKey(a, protocol.groupBy);
    const gb = groupKey(b, protocol.groupBy);
    if (ga !== gb) {
      if (!ga) return 1;
      if (!gb) return -1;
      return ga.localeCompare(gb, 'de', { numeric: true });
    }
    return a.code.localeCompare(b.code, 'de', { numeric: true });
  });
  const groups: { key: string; items: Item[] }[] = [];
  for (const it of list) {
    const k = groupKey(it, protocol.groupBy);
    let g = groups[groups.length - 1];
    if (!g || g.key !== k) groups.push((g = { key: k, items: [] }));
    g.items.push(it);
  }
  return groups;
}

export function projectLists(project: Project, settings: Settings) {
  return {
    categories: project.categories ?? settings.categories,
    itemTypes: project.itemTypes ?? settings.itemTypes,
    trades: project.trades ?? settings.trades,
    protocolTypes: settings.protocolTypes.filter((t) => t.active && (!project.protocolTypeKeys || project.protocolTypeKeys.includes(t.key))),
  };
}

export function fmtDate(iso?: string | null) {
  if (!iso) return '';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}.${m}.${y}`;
}

export function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1, 2)}-${pad(d.getDate(), 2)}`;
}

export function contactName(c?: Contact | null) {
  if (!c) return '';
  return [c.firstName, c.lastName].filter(Boolean).join(' ');
}

export function fillTemplate(tpl: string, vars: Record<string, string>) {
  return tpl.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
}

export function companyOf(contact: Contact | undefined, companies: Map<string, Company>) {
  return contact?.companyId ? companies.get(contact.companyId) : undefined;
}

export function uuid() {
  const c: any = (globalThis as any).crypto;
  if (c?.randomUUID) return c.randomUUID() as string;
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    return (ch === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}
