// CodeMirror 6 wrapper. Lazy-loaded (CodePanel / CodeTile) so CodeMirror stays out of the initial chunk.
import { useEffect, useRef } from "react";
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { bracketMatching, foldGutter, indentOnInput, syntaxHighlighting, HighlightStyle } from "@codemirror/language";
import { javascript } from "@codemirror/lang-javascript";
import { rust } from "@codemirror/lang-rust";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { python } from "@codemirror/lang-python";
import { tags as t } from "@lezer/highlight";
import type { LangId } from "./logic";

const highlight = HighlightStyle.define([
  { tag: [t.keyword, t.modifier, t.operatorKeyword, t.controlKeyword], color: "#c792ea" },
  { tag: [t.string, t.special(t.string), t.regexp], color: "#7bd389" },
  { tag: [t.number, t.bool, t.null, t.atom], color: "#ffb547" },
  { tag: [t.comment, t.lineComment, t.blockComment], color: "#6c6d7a", fontStyle: "italic" },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.labelName], color: "#8ea2ff" },
  { tag: [t.typeName, t.className, t.namespace], color: "#56d8c9" },
  { tag: [t.propertyName, t.attributeName], color: "#e8c88a" },
  { tag: [t.tagName], color: "#ff8a5c" },
  { tag: [t.heading], color: "#8ea2ff", fontWeight: "700" },
  { tag: [t.link, t.url], color: "#6aa8ff", textDecoration: "underline" },
  { tag: [t.operator, t.punctuation, t.bracket], color: "#a9aab6" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.strong, fontWeight: "700" },
  { tag: t.invalid, color: "#ff6b6b" },
]);

const theme = EditorView.theme(
  {
    "&": { height: "100%", backgroundColor: "transparent", color: "var(--color-ink)", fontSize: "12.5px" },
    ".cm-scroller": { fontFamily: "var(--font-mono)", lineHeight: "1.6", overflow: "auto" },
    ".cm-content": { caretColor: "var(--color-accent)", padding: "8px 0" },
    ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--color-accent)", borderLeftWidth: "2px" },
    "&.cm-focused": { outline: "none" },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": { backgroundColor: "rgb(142 162 255 / 0.28)" },
    ".cm-gutters": { backgroundColor: "transparent", color: "var(--color-ink-3)", border: "none" },
    ".cm-activeLine": { backgroundColor: "rgb(255 255 255 / 0.035)" },
    ".cm-activeLineGutter": { backgroundColor: "transparent", color: "var(--color-ink-2)" },
    ".cm-matchingBracket": { backgroundColor: "rgb(142 162 255 / 0.25)", outline: "none" },
    ".cm-foldPlaceholder": { backgroundColor: "var(--color-surface-3)", border: "none", color: "var(--color-ink-2)" },
  },
  { dark: true },
);

function langExt(l: LangId): Extension {
  switch (l) {
    case "ts": return javascript({ typescript: true });
    case "tsx": return javascript({ typescript: true, jsx: true });
    case "js": return javascript();
    case "jsx": return javascript({ jsx: true });
    case "rust": return rust();
    case "json": return json();
    case "markdown": return markdown();
    case "css": return css();
    case "html": return html();
    case "python": return python();
    default: return [];
  }
}

export interface CodeEditorProps {
  /** identity of the document (tab key); switching it swaps state, keeping undo history per tab */
  docKey: string;
  value: string;
  lang: LangId;
  readOnly?: boolean;
  onChange?: (text: string) => void;
  onSave?: () => void;
  onCursor?: (line: number, col: number) => void;
}

export function CodeEditor({ docKey, value, lang, readOnly, onChange, onSave, onCursor }: CodeEditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const states = useRef(new Map<string, EditorState>());
  const cur = useRef<string | null>(null);
  // callbacks via refs so state objects built once keep calling the latest handlers
  const cb = useRef({ onChange, onSave, onCursor });
  cb.current = { onChange, onSave, onCursor };

  useEffect(() => {
    const v = new EditorView({ parent: host.current! });
    view.current = v;
    const map = states.current;
    return () => {
      v.destroy();
      view.current = null;
      map.clear();
      cur.current = null;
    };
  }, []);

  useEffect(() => {
    const v = view.current;
    if (!v) return;
    if (cur.current !== null) states.current.set(cur.current, v.state);
    cur.current = docKey;
    let st = states.current.get(docKey);
    // external reload of the same doc (e.g. after save elsewhere) → rebuild
    if (st && st.doc.toString() !== value && readOnly) st = undefined;
    if (!st) {
      st = EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(),
          foldGutter(),
          highlightActiveLine(),
          highlightActiveLineGutter(),
          drawSelection(),
          history(),
          indentOnInput(),
          bracketMatching(),
          syntaxHighlighting(highlight),
          theme,
          langExt(lang),
          EditorState.readOnly.of(!!readOnly),
          EditorView.editable.of(!readOnly),
          keymap.of([
            { key: "Mod-s", preventDefault: true, run: () => (cb.current.onSave?.(), true) },
            indentWithTab,
            ...defaultKeymap,
            ...historyKeymap,
          ]),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) cb.current.onChange?.(u.state.doc.toString());
            if (u.selectionSet || u.docChanged) {
              const head = u.state.selection.main.head;
              const line = u.state.doc.lineAt(head);
              cb.current.onCursor?.(line.number, head - line.from + 1);
            }
          }),
        ],
      });
    }
    v.setState(st);
    const head = st.selection.main.head;
    const line = st.doc.lineAt(head);
    cb.current.onCursor?.(line.number, head - line.from + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `value` only seeds a new state for a key
  }, [docKey, readOnly, lang, readOnly ? value : null]);

  return <div ref={host} className="h-full min-h-0" data-testid="code-editor" />;
}

export default CodeEditor;
