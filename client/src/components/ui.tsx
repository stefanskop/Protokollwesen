import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import type { RichText, Contact, Company } from '../../../shared/src/index';
import { contactName } from '../../../shared/src/index';
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

/** Formatierter Text (fett, kursiv, Aufzählungen) */
export function RichEditor({ value, onSave, autoFocus }: { value: RichText; onSave: (v: RichText) => void; autoFocus?: boolean }) {
  const timer = useRef<any>(null);
  const last = useRef(JSON.stringify(value));
  const editor = useEditor({
    extensions: [StarterKit.configure({ heading: false, codeBlock: false, code: false, blockquote: false, horizontalRule: false, link: false })],
    content: value || '',
    autofocus: autoFocus ? 'end' : false,
    onUpdate: ({ editor }) => {
      clearTimeout(timer.current);
      timer.current = setTimeout(() => flush(editor.getJSON() as RichText), 1200);
    },
    onBlur: ({ editor }) => {
      clearTimeout(timer.current);
      flush(editor.getJSON() as RichText);
    },
  });
  const flush = (j: RichText) => {
    const s = JSON.stringify(j);
    if (s !== last.current) {
      last.current = s;
      onSave(j);
    }
  };
  useEffect(() => {
    // Änderungen von anderen Geräten übernehmen, wenn nicht gerade bearbeitet wird
    if (!editor || editor.isFocused) return;
    const s = JSON.stringify(value);
    if (s !== last.current) {
      last.current = s;
      editor.commands.setContent(value || '', { emitUpdate: false });
    }
  }, [value, editor]);
  useEffect(() => () => clearTimeout(timer.current), []);
  if (!editor) return null;
  const B = ({ cmd, on, label, title }: { cmd: () => void; on?: boolean; label: ReactNode; title: string }) => (
    <button type="button" title={title} className={on ? 'on' : ''} onMouseDown={(e) => e.preventDefault()} onClick={cmd}>
      {label}
    </button>
  );
  const c = () => editor.chain().focus();
  return (
    <div className="editor">
      <div className="tb">
        <B title="Fett" label={<b>F</b>} on={editor.isActive('bold')} cmd={() => c().toggleBold().run()} />
        <B title="Kursiv" label={<i>K</i>} on={editor.isActive('italic')} cmd={() => c().toggleItalic().run()} />
        <B title="Unterstrichen" label={<u>U</u>} on={editor.isActive('underline')} cmd={() => c().toggleUnderline().run()} />
        <B title="Aufzählung" label="•" on={editor.isActive('bulletList')} cmd={() => c().toggleBulletList().run()} />
        <B title="Nummerierung" label="1." on={editor.isActive('orderedList')} cmd={() => c().toggleOrderedList().run()} />
        <B title="Einrücken" label="→" cmd={() => c().sinkListItem('listItem').run()} />
        <B title="Ausrücken" label="←" cmd={() => c().liftListItem('listItem').run()} />
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}

/** Nur-Lese-Darstellung eines formatierten Textes */
export function RichView({ value }: { value: RichText }) {
  const render = (n: any, k: number): ReactNode => {
    switch (n.type) {
      case 'paragraph':
        return <p key={k}>{(n.content || []).map(render)}</p>;
      case 'bulletList':
        return <ul key={k}>{(n.content || []).map(render)}</ul>;
      case 'orderedList':
        return <ol key={k}>{(n.content || []).map(render)}</ol>;
      case 'listItem':
        return <li key={k}>{(n.content || []).map(render)}</li>;
      case 'hardBreak':
        return <br key={k} />;
      case 'text': {
        let el: ReactNode = n.text;
        for (const m of n.marks || []) {
          if (m.type === 'bold') el = <b>{el}</b>;
          if (m.type === 'italic') el = <i>{el}</i>;
          if (m.type === 'underline') el = <u>{el}</u>;
        }
        return <span key={k}>{el}</span>;
      }
      default:
        return <span key={k}>{(n.content || []).map(render)}</span>;
    }
  };
  return <div className="rt">{(value?.content || []).map(render)}</div>;
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
