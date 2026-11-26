// Datenmodell Protokollwesen
// Jeder synchronisierte Datensatz ist ein "Record" mit id, type und (optional) projectId.
// Neue Felder dürfen jederzeit ergänzt werden; fehlende Felder in alten Datensätzen
// werden beim Lesen mit Standardwerten aufgefüllt (siehe defaults.ts). Dadurch bleiben
// alte Projekte bei Programmerweiterungen voll lesbar.

export const SCHEMA_VERSION = 1;

export type RecordType =
  | 'settings'
  | 'company'
  | 'contact'
  | 'project'
  | 'protocol'
  | 'item'
  | 'entry'
  | 'file'
  | 'plan';

export interface BaseRecord {
  id: string;
  type: RecordType;
  projectId?: string | null;
  createdAt?: string;
  createdBy?: string;
  updatedAt?: string;
  updatedBy?: string;
  deleted?: boolean;
  /** Serverrevision (nur lesend) */
  rev?: number;
}

/** ProseMirror/TipTap-JSON für formatierte Texte */
export type RichText = { type: 'doc'; content?: any[] } | null;

export type ProtocolMode = 'fortlaufend' | 'standard';

export interface ProtocolTypeDef {
  key: string; // z.B. "BBP"
  name: string; // z.B. "Baubesprechungsprotokoll"
  prefix: string; // Nummernpräfix, z.B. "BBP"
  mode: ProtocolMode;
  active: boolean;
  /** neue Punkte dieser Protokollart sind Mängel */
  defects?: boolean;
}

export interface PdfLayout {
  showCompanyHeader: boolean;
  showProjectNumber: boolean;
  showProtocolNumber: boolean;
  showProjectAddress: boolean;
  showAttendees: boolean;
  allProjectContacts: boolean;
  entriesOnSecondPage: boolean;
  keepEntryTogether: boolean;
  newPagePerEntry: boolean;
  imageSize: 'none' | 'small' | 'medium' | 'large';
  accentColor: string;
  fields: {
    company: boolean;
    responsible: boolean;
    observer: boolean;
    itemType: boolean;
    trade: boolean;
    category: boolean;
    location: boolean;
    priority: boolean;
    due: boolean;
    planMarkers: boolean;
  };
}

export interface Settings extends BaseRecord {
  type: 'settings';
  companyName: string;
  companyAddress: string;
  companyEmail: string;
  companyPhone: string;
  logoFileId?: string | null; // null = Standardlogo
  signature: string; // "Gez. Bmstr. Dipl.-Ing. Stefan Skop"
  entryLabel: string; // Bezeichnung der datierten Einträge im PDF, z.B. "Anm." oder "Eintrag"
  endText: string;
  protocolTypes: ProtocolTypeDef[];
  categories: string[]; // Zusatzfeld (00.Information …)
  itemTypes: string[]; // Typ
  defectTypes: string[]; // Mangelarten
  trades: string[]; // Gewerke
  pdf: PdfLayout;
  mailSubjectTemplate: string;
  mailBodyTemplate: string;
}

export interface Company extends BaseRecord {
  type: 'company';
  name: string;
  address?: string;
  uid?: string; // UID-Nr. (auch für die Kostenverfolgung)
  phone?: string;
  email?: string;
  note?: string;
}

export interface Contact extends BaseRecord {
  type: 'contact';
  companyId?: string | null;
  title?: string;
  firstName: string;
  lastName: string;
  function?: string; // Standard-Gewerk/Funktion
  phone?: string;
  email?: string;
}

export interface ProjectParticipant {
  contactId: string;
  role: string; // Gewerk/Funktion im Projekt, z.B. "Teil-GU BM+ZM+MB"
  defaultDistribution: boolean;
}

export interface Project extends BaseRecord {
  type: 'project';
  number: string; // z.B. "25031"
  name: string; // "S-PROM - Sparkasse Promenade"
  address: string;
  clientName: string; // Auftraggeber
  clientAddress: string;
  imageFileId?: string | null;
  archived: boolean;
  memberUserIds: string[];
  participants: ProjectParticipant[];
  /** projektspezifische Auswahl (null = Vorgabe aus Einstellungen) */
  categories?: string[] | null;
  itemTypes?: string[] | null;
  trades?: string[] | null;
  protocolTypeKeys?: string[] | null;
  locations?: string[];
  /** Ordner der Planverwaltung */
  planFolders?: string[];
}

export interface Attendee {
  contactId: string;
  distribution: boolean; // Vert.
  present: boolean; // Teil.
}

export type GroupBy = 'none' | 'category' | 'trade' | 'itemType';

export interface Protocol extends BaseRecord {
  type: 'protocol';
  projectId: string;
  typeKey: string;
  mode: ProtocolMode;
  seq: number; // laufende Nummer je Protokollart
  code: string; // "BBP01"
  title: string; // Bezeichnung
  date: string; // ISO yyyy-mm-dd
  timeFrom: string;
  timeTo: string;
  location: string;
  status: 'entwurf' | 'abgeschlossen';
  closedAt?: string | null;
  closedBy?: string | null;
  sentAt?: string | null;
  attendees: Attendee[];
  groupBy: GroupBy;
  startText?: string;
  endText?: string | null; // null = Standard aus Einstellungen
  nextMeeting?: {
    date: string;
    timeFrom: string;
    timeTo: string;
    location: string;
    note: string;
    inviteeIds: string[];
  } | null;
  /** Reihenfolge-/Auswahl der Punkte: Punkte, die in diesem Protokoll erscheinen */
  itemIds: string[];
  /** Beim Abschließen eingefrorener Stand der Punkt-Felder (Status, Fälligkeit …) */
  snapshot?: Record<string, Partial<Item>> | null;
  /** archivierte, versendete PDF-Dateien */
  sentFileIds?: string[];
  /** Original-PDF bei importierten Protokollen (z.B. aus Baumaster) */
  sourceFileId?: string | null;
}

/** 'behoben' = vom AN als behoben gemeldet, Prüfung durch ÖBA ausständig (v.a. bei Mängeln) */
export type ItemStatus = 'info' | 'offen' | 'behoben' | 'erledigt';

export interface Item extends BaseRecord {
  type: 'item';
  projectId: string;
  originProtocolId: string;
  code: string; // "BBP01.011" – bleibt bei Übernahme erhalten
  title: string;
  status: ItemStatus;
  priority: 'normal' | 'hoch';
  companyId?: string | null;
  responsibleId?: string | null; // Kontakt
  observerIds: string[]; // Kontakte oder Firmen-IDs
  itemType?: string;
  trade?: string;
  category?: string; // Zusatzfeld
  location?: string;
  dueFrom?: string | null;
  dueTo?: string | null;
  doneAt?: string | null;
  /** Verortung im Plan (relative Koordinaten 0..1) */
  planMarkers?: PlanMarker[];
  /** Mängelmanagement */
  defect?: boolean;
  defectType?: string; // z.B. Ausführungsmangel, Restarbeit, Gewährleistung
  cost?: number | null; // Abzug / Kosten (€)
  fixedReportedAt?: string | null; // vom AN als behoben gemeldet
  acceptedAt?: string | null; // von der ÖBA abgenommen
}

export interface PlanMarker {
  planId: string;
  page: number;
  x: number;
  y: number;
}

export interface PlanVersion {
  index: string;
  fileId: string;
  mime: string;
  planDate?: string | null;
  uploadedAt: string;
}

export interface Plan extends BaseRecord {
  type: 'plan';
  projectId: string;
  folder: string;
  name: string;
  index: string;
  scale: string;
  planDate?: string | null;
  keywords: string;
  location: string;
  active: boolean;
  fileId: string;
  mime: string;
  /** ältere Indexstände */
  versions: PlanVersion[];
}

export interface Entry extends BaseRecord {
  type: 'entry';
  projectId: string;
  itemId: string;
  protocolId: string; // in welchem Protokoll entstanden
  date: string; // Anm.-Datum
  text: RichText;
  addendum: boolean; // nachträgliche Ergänzung → kursiv
  fileIds: string[];
}

export interface FileMeta extends BaseRecord {
  type: 'file';
  name: string;
  mime: string;
  size: number;
  caption?: string;
  /** Skizzen-Overlay (Phase 2) */
  sketch?: any;
  uploaded?: boolean;
}

export type AnyRecord = Settings | Company | Contact | Project | Protocol | Item | Entry | FileMeta | Plan;

export interface UserInfo {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'mitarbeiter';
  active: boolean;
}

// ---- Synchronisation ----
export interface Mutation {
  mid: string; // eindeutige Mutations-ID (Idempotenz)
  id: string;
  type: RecordType;
  projectId?: string | null;
  baseRev: number; // Revision, auf der die Änderung beruht (0 = neu)
  set: Record<string, unknown>;
  ts: string;
}

export interface PushResult {
  applied: string[];
  rejected: { mid: string; reason: string }[];
  conflicts: { id: string; field: string; theirs: unknown; mine: unknown; by?: string }[];
}

export interface PullResult {
  records: AnyRecord[];
  rev: number; // höchste gelieferte Revision
  more: boolean;
  projectIds: string[]; // Projekte, auf die der Benutzer Zugriff hat
}
