// Überträgt ein gelesenes Baumaster-Protokoll in die Datenbank
import { ldb, save } from './db';
import { addFile } from './data';
import {
  normalize,
  bmBlocksToRichText,
  richTextToPlain,
  makeSnapshot,
  type BmProtocol,
  type AnyRecord,
  type Company,
  type Contact,
  type Project,
  type Protocol,
  type Item,
  type Entry,
  type Settings,
  type ProtocolTypeDef,
} from '../../shared/src/index';

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

export interface ImportResult {
  protocolId?: string;
  skipped?: string;
  createdItems: number;
  updatedItems: number;
  newContacts: number;
  newCompanies: number;
}

export async function ensureProtocolType(bm: BmProtocol): Promise<ProtocolTypeDef> {
  const settings = normalize(((await ldb.records.get('settings')) || { id: 'settings', type: 'settings' }) as Settings);
  const found = settings.protocolTypes.find((t) => t.prefix.toUpperCase() === bm.prefix.toUpperCase());
  if (found) return found;
  const t: ProtocolTypeDef = { key: bm.prefix + '_' + Date.now().toString(36), name: bm.typeName || bm.prefix, prefix: bm.prefix, mode: 'fortlaufend', active: true };
  await save<Settings>('settings', 'settings', { protocolTypes: [...settings.protocolTypes, t] });
  return t;
}

export async function importProtocol(bm: BmProtocol, projectId: string, typeKey: string, original?: File): Promise<ImportResult> {
  const res: ImportResult = { createdItems: 0, updatedItems: 0, newContacts: 0, newCompanies: 0 };
  const all = (await ldb.records.toArray()).filter((r) => !r.deleted).map((r) => normalize(r as AnyRecord));
  const settings = normalize((all.find((r) => r.type === 'settings') || { id: 'settings', type: 'settings' }) as Settings);
  const type = settings.protocolTypes.find((t) => t.key === typeKey)!;
  const project = all.find((r) => r.id === projectId) as Project;
  const companies = all.filter((r) => r.type === 'company') as Company[];
  const contacts = all.filter((r) => r.type === 'contact') as Contact[];
  const protocols = all.filter((r) => r.type === 'protocol' && r.projectId === projectId) as Protocol[];
  const items = all.filter((r) => r.type === 'item' && r.projectId === projectId) as Item[];
  const entries = all.filter((r) => r.type === 'entry' && r.projectId === projectId) as Entry[];

  if (protocols.some((p) => p.code === bm.code)) {
    res.skipped = `${bm.code} ist in diesem Projekt bereits vorhanden`;
    return res;
  }

  // ---- Firmen & Kontakte ----
  const companyId = async (name: string): Promise<string | null> => {
    if (!name || /^projektteam$/i.test(name.trim())) return null;
    let c = companies.find((x) => norm(x.name) === norm(name));
    if (!c) {
      const id = await save<Company>('company', null, { name: name.trim() });
      c = { id, type: 'company', name: name.trim() } as Company;
      companies.push(c);
      res.newCompanies++;
    }
    return c.id;
  };
  const contactName = (c: Contact) => norm([c.firstName, c.lastName].filter(Boolean).join(' '));
  const contactId = async (name: string, compId: string | null, extra: Partial<Contact> = {}): Promise<string | null> => {
    if (!name) return null;
    const email = extra.email ? norm(extra.email) : '';
    let c =
      (email && contacts.find((x) => x.email && norm(x.email) === email && contactName(x) === norm(name))) ||
      contacts.find((x) => contactName(x) === norm(name) && (x.companyId || null) === compId) ||
      (!compId ? contacts.find((x) => contactName(x) === norm(name)) : undefined);
    if (!c) {
      const parts = name.trim().split(/\s+/);
      const lastName = parts.length > 1 ? parts.pop()! : parts[0];
      const firstName = parts.length ? parts.join(' ') : '';
      const id = await save<Contact>('contact', null, { firstName, lastName, companyId: compId, ...extra });
      c = { id, type: 'contact', firstName, lastName, companyId: compId, ...extra } as Contact;
      contacts.push(c);
      res.newContacts++;
    } else {
      // fehlende Angaben ergänzen
      const patch: Partial<Contact> = {};
      if (extra.phone && !c.phone) patch.phone = extra.phone;
      if (extra.email && !c.email) patch.email = extra.email;
      if (extra.function && !c.function) patch.function = extra.function;
      if (Object.keys(patch).length) {
        await save<Contact>('contact', c.id, patch);
        Object.assign(c, patch);
      }
    }
    return c.id;
  };

  const participants = [...project.participants];
  const attendees: Protocol['attendees'] = [];
  for (const p of bm.participants) {
    const cid = await companyId(p.company);
    const id = await contactId(p.name, cid, { phone: p.phone || undefined, email: p.email || undefined, function: p.role || undefined });
    if (!id) continue;
    if (!participants.some((x) => x.contactId === id)) participants.push({ contactId: id, role: p.role, defaultDistribution: true });
    if (!attendees.some((a) => a.contactId === id)) attendees.push({ contactId: id, distribution: true, present: false });
  }
  const projectPatch: Partial<Project> = { participants };
  if (!project.clientName && bm.clientName) projectPatch.clientName = bm.clientName;
  if (!project.clientAddress && bm.clientAddress) projectPatch.clientAddress = bm.clientAddress;
  if (!project.address && bm.projectAddress) projectPatch.address = bm.projectAddress;
  await save<Project>('project', projectId, projectPatch);

  // ---- Protokoll ----
  const protocolId = await save<Protocol>(
    'protocol',
    null,
    {
      typeKey,
      mode: type.mode,
      seq: bm.seq,
      code: bm.code,
      title: bm.title || type.name,
      date: bm.date,
      timeFrom: bm.timeFrom,
      timeTo: bm.timeTo,
      location: bm.location,
      status: 'entwurf',
      sentAt: bm.sentAt || null,
      attendees,
      groupBy: bm.items.some((i) => i.group) ? 'category' : 'none',
      itemIds: [],
      nextMeeting: bm.nextMeeting ? { ...bm.nextMeeting, location: bm.location, note: '', inviteeIds: [] } : null,
      endText: null,
      snapshot: null,
    },
    projectId,
  );
  res.protocolId = protocolId;

  // ---- Punkte ----
  const sameType = new Set(protocols.filter((p) => p.typeKey === typeKey).flatMap((p) => p.itemIds));
  const itemIds: string[] = [];
  const itemMap = new Map(items.map((i) => [i.id, i]));
  for (const bi of bm.items) {
    const f = bi.fields;
    const compId = await companyId(f['Firma'] || '');
    const respId = f['Zuständig'] ? await contactId(f['Zuständig'], compId) : null;
    const observerIds: string[] = [];
    for (const o of (f['Beobachter'] || '').split(/\s*,\s*/).filter(Boolean)) {
      const oc = await companyId(o);
      if (oc) observerIds.push(oc);
    }
    const data: Partial<Item> = {
      title: bi.title,
      status: bi.status,
      priority: 'normal',
      companyId: compId,
      responsibleId: respId,
      observerIds,
      itemType: f['Typ'] || undefined,
      trade: f['Gewerk'] || undefined,
      category: f['Zusatzfeld'] || bi.group || undefined,
      location: f['Lage'] || undefined,
      dueFrom: bi.dueFrom || null,
      dueTo: bi.dueTo || null,
    };
    // vorhandenen Punkt wiederverwenden (gleiche Nummer oder gleicher Titel derselben Protokollart)
    let existing = items.find((i) => i.code === bi.code) || items.find((i) => sameType.has(i.id) && norm(i.title) === norm(bi.title) && i.status !== 'erledigt');
    let itemId: string;
    if (existing) {
      itemId = existing.id;
      await save<Item>('item', itemId, data);
      Object.assign(existing, data);
      res.updatedItems++;
    } else {
      itemId = await save<Item>('item', null, { ...data, code: bi.code, originProtocolId: protocolId, createdAt: bi.created ? bi.created + 'T08:00:00.000Z' : undefined }, projectId);
      existing = { id: itemId, type: 'item', projectId, code: bi.code, originProtocolId: protocolId, ...data } as Item;
      items.push(existing);
      res.createdItems++;
    }
    itemMap.set(itemId, existing);
    itemIds.push(itemId);
    // Einträge (ohne Dubletten)
    const have = new Set(entries.filter((e) => e.itemId === itemId).map((e) => e.date + '|' + norm(richTextToPlain(e.text))));
    for (const be of bi.entries) {
      const text = bmBlocksToRichText(be.blocks);
      const key = be.date + '|' + norm(richTextToPlain(text));
      if (have.has(key)) continue;
      have.add(key);
      await save<Entry>('entry', null, { itemId, protocolId, date: be.date || bm.date, text, addendum: be.italic, fileIds: [] }, projectId);
    }
  }

  const patch: Partial<Protocol> = { itemIds };
  if (original) {
    const fid = await addFile(original, projectId, original.name);
    patch.sourceFileId = fid;
  }
  if (bm.closed) {
    const proto = { id: protocolId, itemIds } as Protocol;
    Object.assign(patch, { status: 'abgeschlossen', closedAt: new Date().toISOString(), snapshot: type.mode === 'fortlaufend' ? makeSnapshot(proto, itemMap) : null });
  }
  await save<Protocol>('protocol', protocolId, patch);
  return res;
}

/** "25031 - Esplanade 9" → Nummer + Name */
export function splitProjectTitle(t: string) {
  const m = /^(\d{3,})\s*-\s*(.+)$/.exec(t.trim());
  return m ? { number: m[1], name: m[2] } : { number: '', name: t.trim() };
}
