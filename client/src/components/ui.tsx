import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Contact, Company } from '../../../shared/src/index';
import { contactName, fmtDate, parseDeDate } from '../../../shared/src/index';
import { useFileUrl } from '../data';

export function Modal({ title, children, onClose, wide, actions }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean; actions?: ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={'modal' + (wide ? ' wide' : '')}>
        <h2>{title}</h2>
        {children}
        {actions && <div className="actions">{actions}</div>}
      </div>
    </div>
  );
}

/** Eingabefeld, das erst beim Verlassen (bzw. nach kurzer Pause) speichert */
export function LazyInput({ value, onSave, ...rest }: { value: string; onSave: (v: string) => void } & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  const [v, setV] = useState(value ?? '');
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setV(value ?? '');
  }, [value]);
  const commit = () => {
    if ((value ?? '') !== v) onSave(v);
  };
  return (
    <input
      {...rest}
      value={v}
      onChange={(e) => setV(e.target.value)}
      onFocus={() => (focused.current = true)}
      onBlur={() => {
        focused.current = false;
        commit();
      }}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
  );
}

export function LazyTextarea({ value, onSave, ...rest }: { value: string; onSave: (v: string) => void } & Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange'>) {
  const [v, setV] = useState(value ?? '');
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setV(value ?? '');
  }, [value]);
  return (
    <textarea
      {...rest}
      value={v}
      onChange={(e) => setV(e.target.value)}
      onFocus={() => (focused.current = true)}
      onBlur={() => {
        focused.current = false;
        if ((value ?? '') !== v) onSave(v);
      }}
    />
  );
}

export { RichEditor, RichView } from './editor';

/** Datumsfeld, immer im Format tt.mm.jjjj, mit Kalender-Auswahl */
export function DateInput({ value, onChange, disabled, placeholder = 'tt.mm.jjjj', style }: { value?: string | null; onChange: (iso: string | null) => void; disabled?: boolean; placeholder?: string; style?: React.CSSProperties }) {
  const [txt, setTxt] = useState(fmtDate(value));
  const [bad, setBad] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  useEffect(() => {
    setTxt(fmtDate(value));
    setBad(false);
  }, [value]);
  const commit = () => {
    if (!txt.trim()) {
      setBad(false);
      if (value) onChange(null);
      return;
    }
    const iso = parseDeDate(txt);
    if (!iso) return setBad(true);
    setBad(false);
    setTxt(fmtDate(iso));
    if (iso !== value) onChange(iso);
  };
  return (
    <span className={'date-input' + (bad ? ' bad' : '')} style={style}>
      <input
        value={txt}
        disabled={disabled}
        placeholder={placeholder}
        inputMode="numeric"
        onChange={(e) => setTxt(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
      {!disabled && (
        <button
          type="button"
          title="Kalender"
          onClick={() => {
            const el = picker.current as any;
            if (el?.showPicker) el.showPicker();
            else el?.click();
          }}
        >
          📅
        </button>
      )}
      <input ref={picker} type="date" tabIndex={-1} className="hidden-picker" value={value || ''} onChange={(e) => onChange(e.target.value || null)} />
    </span>
  );
}

export function ContactSelect({
  value,
  onChange,
  contacts,
  companies,
  placeholder = '– keine Auswahl –',
  onlyIds,
}: {
  value?: string | null;
  onChange: (id: string | null) => void;
  contacts: Contact[];
  companies: Map<string, Company>;
  placeholder?: string;
  onlyIds?: string[];
}) {
  const list = (onlyIds ? contacts.filter((c) => onlyIds.includes(c.id)) : contacts).slice().sort((a, b) => a.lastName.localeCompare(b.lastName, 'de'));
  return (
    <select value={value || ''} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">{placeholder}</option>
      {list.map((c) => (
        <option key={c.id} value={c.id}>
          {contactName(c)}
          {c.companyId && companies.get(c.companyId) ? ` (${companies.get(c.companyId)!.name})` : ''}
        </option>
      ))}
    </select>
  );
}

export function ListSelect({ value, options, onChange, empty = '–' }: { value?: string | null; options: string[]; onChange: (v: string) => void; empty?: string }) {
  const opts = value && !options.includes(value) ? [value, ...options] : options;
  return (
    <select value={value || ''} onChange={(e) => onChange(e.target.value)}>
      <option value="">{empty}</option>
      {opts.map((o) => (
        <option key={o}>{o}</option>
      ))}
    </select>
  );
}

export function Thumb({ id, caption, onCaption, onRemove, readOnly }: { id: string; caption?: string; onCaption?: (v: string) => void; onRemove?: () => void; readOnly?: boolean }) {
  const url = useFileUrl(id);
  const [big, setBig] = useState(false);
  return (
    <div className="photo">
      {url ? <img src={url} onClick={() => setBig(true)} alt="" /> : <div style={{ height: 90 }} className="empty small">lädt…</div>}
      {!readOnly && onRemove && (
        <button className="x" onClick={onRemove} title="Entfernen">
          ×
        </button>
      )}
      {readOnly ? caption ? <div className="small" style={{ padding: '3px 5px' }}>{caption}</div> : null : <LazyInput value={caption || ''} placeholder="Anmerkung" onSave={(v) => onCaption?.(v)} />}
      {big && url && (
        <div className="lightbox" onClick={() => setBig(false)}>
          <img src={url} alt="" />
        </div>
      )}
    </div>
  );
}

export function StringListEditor({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const [txt, setTxt] = useState(value.join('\n'));
  useEffect(() => setTxt(value.join('\n')), [value.join('\n')]);
  return (
    <textarea
      rows={Math.min(14, Math.max(4, value.length + 1))}
      value={txt}
      onChange={(e) => setTxt(e.target.value)}
      onBlur={() => onChange(txt.split('\n').map((s) => s.trim()).filter(Boolean))}
    />
  );
}
