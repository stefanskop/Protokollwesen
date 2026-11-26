import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useEditor, EditorContent, useEditorState, type Editor } from '@tiptap/react';
import { generateHTML } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { TextStyle, Color } from '@tiptap/extension-text-style';
import Highlight from '@tiptap/extension-highlight';
import TextAlign from '@tiptap/extension-text-align';
import type { RichText } from '../../../shared/src/index';

const extensions = [
  StarterKit.configure({
    heading: { levels: [1, 2, 3] },
    codeBlock: false,
    code: false,
    blockquote: false,
    horizontalRule: false,
    link: { openOnClick: false, autolink: true, defaultProtocol: 'https' },
  }),
  TextStyle,
  Color,
  Highlight.configure({ multicolor: true }),
  TextAlign.configure({ types: ['heading', 'paragraph'] }),
];

const TEXT_COLORS = ['#000000', '#b00045', '#d32f2f', '#e67e00', '#2e8b57', '#1f5d99', '#002e5e', '#7b1fa2', '#6b7484'];
const MARK_COLORS = ['#fff59d', '#ffe0b2', '#c8e6c9', '#bbdefb', '#f8bbd0', '#e0e0e0'];

/** Formatierter Text mit Werkzeugleiste (wie in gängigen Textverarbeitungen) */
export function RichEditor({ value, onSave, autoFocus, placeholder }: { value: RichText; onSave: (v: RichText) => void; autoFocus?: boolean; placeholder?: string }) {
  const timer = useRef<any>(null);
  const last = useRef(JSON.stringify(value));
  const flush = (j: RichText) => {
    const s = JSON.stringify(j);
    if (s !== last.current) {
      last.current = s;
      onSave(j);
    }
  };
  const editor = useEditor({
    extensions,
    content: value || '',
    autofocus: autoFocus ? 'end' : false,
    editorProps: { attributes: { 'data-placeholder': placeholder || '' } },
    onUpdate: ({ editor }) => {
      clearTimeout(timer.current);
      timer.current = setTimeout(() => flush(editor.getJSON() as RichText), 1200);
    },
    onBlur: ({ editor }) => {
      clearTimeout(timer.current);
      flush(editor.getJSON() as RichText);
    },
  });
  useEffect(() => {
    // Änderungen anderer Geräte übernehmen, solange nicht gerade bearbeitet wird
    if (!editor || editor.isFocused) return;
    const s = JSON.stringify(value);
    if (s !== last.current) {
      last.current = s;
      editor.commands.setContent(value || '', { emitUpdate: false });
    }
  }, [value, editor]);
  useEffect(() => () => clearTimeout(timer.current), []);
  if (!editor) return null;
  return (
    <div className="editor">
      <Toolbar editor={editor} />
      <EditorContent editor={editor} />
    </div>
  );
}

function Toolbar({ editor }: { editor: Editor }) {
  const st = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive('bold'),
      italic: e.isActive('italic'),
      underline: e.isActive('underline'),
      strike: e.isActive('strike'),
      bullet: e.isActive('bulletList'),
      ordered: e.isActive('orderedList'),
      link: e.isActive('link'),
      h: [1, 2, 3].find((l) => e.isActive('heading', { level: l })) || 0,
      align: (['center', 'right', 'justify'] as const).find((a) => e.isActive({ textAlign: a })) || 'left',
      canUndo: e.can().undo(),
      canRedo: e.can().redo(),
      color: (e.getAttributes('textStyle').color as string) || '',
    }),
  });
  const [menu, setMenu] = useState<'' | 'color' | 'mark'>('');
  const c = () => editor.chain().focus();
  const B = ({ cmd, on, label, title, disabled }: { cmd: () => void; on?: boolean; label: ReactNode; title: string; disabled?: boolean }) => (
    <button type="button" title={title} disabled={disabled} className={on ? 'on' : ''} onMouseDown={(e) => e.preventDefault()} onClick={cmd}>
      {label}
    </button>
  );
  const link = () => {
    const prev = editor.getAttributes('link').href as string | undefined;
    const url = window.prompt('Link-Adresse (leer = Link entfernen)', prev || 'https://');
    if (url === null) return;
    if (!url || url === 'https://') c().extendMarkRange('link').unsetLink().run();
    else c().extendMarkRange('link').setLink({ href: url }).run();
  };
  return (
    <div className="tb">
      <B title="Rückgängig" label="↶" disabled={!st.canUndo} cmd={() => c().undo().run()} />
      <B title="Wiederholen" label="↷" disabled={!st.canRedo} cmd={() => c().redo().run()} />
      <span className="sep" />
      <B title="Fett" label={<b>F</b>} on={st.bold} cmd={() => c().toggleBold().run()} />
      <B title="Kursiv" label={<i>K</i>} on={st.italic} cmd={() => c().toggleItalic().run()} />
      <B title="Unterstrichen" label={<u>U</u>} on={st.underline} cmd={() => c().toggleUnderline().run()} />
      <B title="Durchgestrichen" label={<s>S</s>} on={st.strike} cmd={() => c().toggleStrike().run()} />
      <span className="drop">
        <B title="Schriftfarbe" label={<span style={{ borderBottom: `3px solid ${st.color || '#000'}`, fontWeight: 600 }}>A</span>} cmd={() => setMenu(menu === 'color' ? '' : 'color')} />
        {menu === 'color' && (
          <span className="palette" onMouseLeave={() => setMenu('')}>
            {TEXT_COLORS.map((col) => (
              <button key={col} type="button" style={{ background: col }} title={col} onMouseDown={(e) => e.preventDefault()} onClick={() => (c().setColor(col).run(), setMenu(''))} />
            ))}
            <button type="button" className="none" title="Standard" onMouseDown={(e) => e.preventDefault()} onClick={() => (c().unsetColor().run(), setMenu(''))}>
              ✕
            </button>
          </span>
        )}
      </span>
      <span className="drop">
        <B title="Markieren" label={<span style={{ background: '#fff59d', padding: '0 3px' }}>▍</span>} cmd={() => setMenu(menu === 'mark' ? '' : 'mark')} />
        {menu === 'mark' && (
          <span className="palette" onMouseLeave={() => setMenu('')}>
            {MARK_COLORS.map((col) => (
              <button key={col} type="button" style={{ background: col }} onMouseDown={(e) => e.preventDefault()} onClick={() => (c().toggleHighlight({ color: col }).run(), setMenu(''))} />
            ))}
            <button type="button" className="none" title="Keine Markierung" onMouseDown={(e) => e.preventDefault()} onClick={() => (c().unsetHighlight().run(), setMenu(''))}>
              ✕
            </button>
          </span>
        )}
      </span>
      <select
        title="Absatzformat"
        value={st.h}
        onMouseDown={(e) => e.stopPropagation()}
        onChange={(e) => {
          const l = Number(e.target.value);
          if (l) c().setHeading({ level: l as 1 | 2 | 3 }).run();
          else c().setParagraph().run();
        }}
      >
        <option value={0}>Absatz</option>
        <option value={1}>Überschrift 1</option>
        <option value={2}>Überschrift 2</option>
        <option value={3}>Überschrift 3</option>
      </select>
      <span className="sep" />
      <B title="Aufzählung" label="•≡" on={st.bullet} cmd={() => c().toggleBulletList().run()} />
      <B title="Nummerierung" label="1≡" on={st.ordered} cmd={() => c().toggleOrderedList().run()} />
      <B title="Einzug verkleinern" label="⇤" cmd={() => c().liftListItem('listItem').run()} />
      <B title="Einzug vergrößern" label="⇥" cmd={() => c().sinkListItem('listItem').run()} />
      <span className="sep" />
      <B title="Linksbündig" label={<AlignIcon a="left" />} on={st.align === 'left'} cmd={() => c().setTextAlign('left').run()} />
      <B title="Zentriert" label={<AlignIcon a="center" />} on={st.align === 'center'} cmd={() => c().setTextAlign('center').run()} />
      <B title="Rechtsbündig" label={<AlignIcon a="right" />} on={st.align === 'right'} cmd={() => c().setTextAlign('right').run()} />
      <B title="Blocksatz" label={<AlignIcon a="justify" />} on={st.align === 'justify'} cmd={() => c().setTextAlign('justify').run()} />
      <span className="sep" />
      <B title="Link" label="🔗" on={st.link} cmd={link} />
      <B title="Formatierung entfernen" label={<span style={{ textDecoration: 'line-through' }}>T</span>} cmd={() => c().unsetAllMarks().clearNodes().run()} />
    </div>
  );
}

function AlignIcon({ a }: { a: 'left' | 'center' | 'right' | 'justify' }) {
  const w = [14, a === 'justify' ? 14 : 9, 14, a === 'justify' ? 14 : 9];
  const x = (len: number) => (a === 'center' ? (16 - len) / 2 : a === 'right' ? 15 - len : 1);
  return (
    <svg width="16" height="14" viewBox="0 0 16 14" aria-hidden>
      {w.map((len, i) => (
        <rect key={i} x={x(len)} y={1 + i * 3.4} width={len} height="1.6" fill="currentColor" />
      ))}
    </svg>
  );
}

/** Nur-Lese-Darstellung */
export function RichView({ value }: { value: RichText }) {
  const html = useMemo(() => {
    try {
      return value ? generateHTML(value as any, extensions) : '';
    } catch {
      return '';
    }
  }, [JSON.stringify(value)]);
  return <div className="rt" dangerouslySetInnerHTML={{ __html: html }} />;
}
