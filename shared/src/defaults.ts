import type { AnyRecord, PdfLayout, Settings, Project, Protocol, Item, Entry, Contact, Company, FileMeta } from './model';

export const DEFAULT_PDF: PdfLayout = {
  showCompanyHeader: true,
  showProjectNumber: true,
  showProtocolNumber: true,
  showProjectAddress: true,
  showAttendees: true,
  allProjectContacts: true,
  entriesOnSecondPage: true,
  keepEntryTogether: true,
  newPagePerEntry: false,
  imageSize: 'small',
  accentColor: '#002E5E',
  fields: {
    company: true,
    responsible: true,
    observer: true,
    itemType: true,
    trade: true,
    category: true,
    location: false,
    priority: true,
    due: true,
  },
};

export const DEFAULT_SETTINGS: Omit<Settings, 'id' | 'type'> = {
  companyName: 'Skop Bauconsulting GmbH',
  companyAddress: 'Pergkirchen 87, 4320 Perg',
  companyEmail: 'office@skop-bauconsulting.at',
  companyPhone: '',
  logoFileId: null,
  signature: 'Gez. Bmstr. Dipl.-Ing. Stefan Skop',
  endText:
    'Bei Einsprüchen bzw. notwendigen Anmerkungen zu den Inhalten dieses Protokolls, bitten wir Sie diese uns innerhalb von 4 Tagen mitzuteilen, andernfalls gehen wir von Ihrem Einverständnis zu den protokollierten Punkten aus. Kursive Einträge sind Ergänzungen zum Protokoll.',
  protocolTypes: [
    { key: 'BBP', name: 'Baubesprechungsprotokoll', prefix: 'BBP', mode: 'fortlaufend', active: true },
    { key: 'JF', name: 'AG Jour fixe', prefix: 'JF', mode: 'fortlaufend', active: true },
    { key: 'PBP', name: 'Planungsbesprechung', prefix: 'PBP', mode: 'fortlaufend', active: true },
    { key: 'MB', name: 'Mängelbegehung', prefix: 'MB', mode: 'fortlaufend', active: true },
    { key: 'BAUKG', name: 'BauKG-Begehung', prefix: 'BKG', mode: 'standard', active: true },
    { key: 'AK', name: 'Aktennotiz', prefix: 'AK', mode: 'standard', active: true },
    { key: 'ABN', name: 'Abnahme / Übergabe', prefix: 'ABN', mode: 'standard', active: true },
  ],
  categories: [
    '00.Information',
    '01.Organisation',
    '02.Planung',
    '03.Behörde',
    '04.Ausschreibung',
    '05.Ausführung',
    '06.Kosten',
    '07.Termine',
    '08.Qualität',
    '09.Sicherheit',
  ],
  itemTypes: [
    '00.Information',
    '01.Organisation',
    '02.Planung',
    '03.Behörde',
    '04.Ausschreibung',
    '05.Ausführung',
    '06.Kosten',
    '07.Termine',
    '08.Qualität',
    '09.Sicherheit',
  ],
  trades: ['Baumeister', 'Zimmermann', 'Dachdecker', 'Spengler', 'Elektro', 'HKLS', 'Trockenbau', 'Estrich', 'Bodenbeläge', 'Maler', 'Fenster', 'Tischler', 'Schlosser', 'Fliesen'],
  pdf: DEFAULT_PDF,
  mailSubjectTemplate: '{projekt} – {protokoll} vom {datum}',
  mailBodyTemplate:
    'Sehr geehrte Damen und Herren,\n\nanbei übermitteln wir Ihnen das {protokoll} vom {datum} zum Projekt {projekt}.\n\nMit freundlichen Grüßen\n{firma}',
};

function fill<T extends object>(r: T, defaults: Record<string, unknown>): T {
  const out: any = { ...r };
  for (const [k, v] of Object.entries(defaults)) if (out[k] === undefined) out[k] = Array.isArray(v) ? [...v] : v;
  return out;
}

/** Füllt fehlende Felder alter Datensätze mit Standardwerten auf (Vorwärtskompatibilität). */
export function normalize<T extends AnyRecord>(r: T): T {
  switch (r.type) {
    case 'settings': {
      const s = r as Settings;
      return { ...DEFAULT_SETTINGS, ...s, pdf: { ...DEFAULT_PDF, ...(s.pdf || {}), fields: { ...DEFAULT_PDF.fields, ...(s.pdf?.fields || {}) } } } as T;
    }
    case 'project': {
      const p = r as Project;
      return fill(r, { number: '', name: '', address: '', clientName: '', clientAddress: '', archived: false, memberUserIds: [], participants: [], locations: [] }) as T;
    }
    case 'protocol': {
      const p = r as Protocol;
      return fill(r, { title: '', timeFrom: '', timeTo: '', location: '', status: 'entwurf', attendees: [], groupBy: 'category', itemIds: [], mode: 'fortlaufend' }) as T;
    }
    case 'item': {
      const i = r as Item;
      return fill(r, { title: '', status: 'info', priority: 'normal', observerIds: [] }) as T;
    }
    case 'entry': {
      const e = r as Entry;
      return fill(r, { text: null, addendum: false, fileIds: [] }) as T;
    }
    case 'contact':
      return fill(r, { firstName: '', lastName: '' }) as T;
    case 'company':
      return fill(r, { name: '' }) as T;
    case 'file':
      return fill(r, { name: '', mime: '', size: 0 }) as T;
  }
  return r;
}
