import { remarkPluginsCtx } from '@milkdown/kit/core';
import { $command, $inputRule, $markSchema } from '@milkdown/kit/utils';
import type { Processor } from 'unified';
import 'katex/dist/katex.css';
import { lift, toggleMark } from '@milkdown/kit/prose/commands';
import { redoDepth, undoDepth } from '@milkdown/kit/prose/history';
import { InputRule } from '@milkdown/kit/prose/inputrules';
import { TextSelection } from '@milkdown/kit/prose/state';
import { pandocMarkFromMarkdown, pandocMarkToMarkdown } from 'mdast-util-mark';
import { pandocMark } from 'micromark-extension-mark';

export interface NoteWysiwygOptions {
  readonly root: HTMLElement;
  readonly initialValue: string;
  readonly editable: () => boolean;
  readonly onChange: (markdown: string) => void;
}

export interface NoteWysiwygActiveState {
  readonly heading: boolean;
  readonly strong: boolean;
  readonly em: boolean;
  readonly strike: boolean;
  readonly highlight: boolean;
}

export interface NoteWysiwygMarks {
  readonly strong: boolean;
  readonly em: boolean;
  readonly strike: boolean;
  readonly highlight: boolean;
}

export const EMPTY_NOTE_MARKS: NoteWysiwygMarks = {
  strong: false,
  em: false,
  strike: false,
  highlight: false,
};

export interface NoteWysiwyg {
  getMarkdown(): string;
  setMarkdown(markdown: string): void;
  insert(markdown: string): void;
  toggleHeading(level: number): void;
  toggleBold(): void;
  toggleItalic(): void;
  toggleStrikethrough(): void;
  toggleBulletList(): void;
  toggleOrderedList(): void;
  toggleHighlight(): void;
  undo(): void;
  redo(): void;
  canUndo(): boolean;
  canRedo(): boolean;
  /** Marks/heading under the caret — drives toolbar active styles. */
  activeState(): NoteWysiwygActiveState;
  /** Whether the current selection is fully covered by each mark. */
  marksForRange(): NoteWysiwygMarks;
  /** Deletes the single character before the caret when it is '@'. */
  deleteBeforeCursor(): void;
  /** Escape a blockquote with Enter in an empty paragraph. */
  escapeQuoteOnEnter(): boolean;
  focus(): void;
  destroy(): void;
}

/** Unified remark plugin enabling ==highlight== parsing + serialization. */
function remarkMarkExtension(this: Processor) {
  const data = this.data() as {
    micromarkExtensions?: unknown[];
    fromMarkdownExtensions?: unknown[];
    toMarkdownExtensions?: unknown[];
  };
  data.micromarkExtensions = [...(data.micromarkExtensions ?? []), pandocMark()];
  data.fromMarkdownExtensions = [...(data.fromMarkdownExtensions ?? []), pandocMarkFromMarkdown];
  data.toMarkdownExtensions = [...(data.toMarkdownExtensions ?? []), pandocMarkToMarkdown];
}

const highlightSchema = $markSchema('highlight', () => ({
  parseDOM: [{ tag: 'mark' }],
  toDOM: () => ['mark', { class: 'note-highlight' }],
  parseMarkdown: {
    match: (node) => node.type === 'mark',
    runner: (state, node, markType) => {
      state.openMark(markType);
      state.next(node.children);
      state.closeMark(markType);
    },
  },
  toMarkdown: {
    match: (mark) => mark.type.name === 'highlight',
    runner: (state, mark) => {
      state.withMark(mark, 'mark');
    },
  },
}));

const highlightCommand = $command('WrapInHighlight', () => () => (state, dispatch) => {
  // biome-ignore lint/complexity/useLiteralKeys: ProseMirror mark registries are runtime maps.
  const markType = state.schema.marks['highlight'];
  if (!markType) return false;
  return toggleMark(markType)(state, dispatch);
});

const highlightInputRule = $inputRule(() => {
  const pattern = /(?:^|\s)==([^=\n]+)==$/u;
  return new InputRule(pattern, (state, match, start, end) => {
    // biome-ignore lint/complexity/useLiteralKeys: ProseMirror mark registries are runtime maps.
    const markType = state.schema.marks['highlight'];
    if (!markType) return null;
    const text = match[2] ?? '';
    const from = start + match[0].length - text.length;
    const tr = state.tr.delete(from, end);
    tr.addMark(from, from + text.length, markType.create());
    return tr;
  });
});

export async function createNoteWysiwyg(options: NoteWysiwygOptions): Promise<NoteWysiwyg> {
  const [
    { Editor, rootCtx, defaultValueCtx, editorViewOptionsCtx, editorViewCtx },
    {
      commonmark,
      wrapInHeadingCommand,
      toggleStrongCommand,
      toggleEmphasisCommand,
      wrapInBulletListCommand,
      wrapInOrderedListCommand,
      turnIntoTextCommand,
    },
    { gfm, toggleStrikethroughCommand },
    { listener, listenerCtx },
    { history, redoCommand, undoCommand },
    { math },
    { callCommand, getMarkdown, insert, replaceAll },
  ] = await Promise.all([
    import('@milkdown/kit/core'),
    import('@milkdown/kit/preset/commonmark'),
    import('@milkdown/kit/preset/gfm'),
    import('@milkdown/kit/plugin/listener'),
    import('@milkdown/kit/plugin/history'),
    import('@milkdown/plugin-math'),
    import('@milkdown/kit/utils'),
  ]);

  let changeTimer: ReturnType<typeof setTimeout> | undefined;
  const scheduleChange = (markdown: string): void => {
    if (changeTimer !== undefined) clearTimeout(changeTimer);
    changeTimer = setTimeout(() => {
      changeTimer = undefined;
      options.onChange(markdown);
    }, 250);
  };

  const editor = await Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, options.root);
      ctx.set(defaultValueCtx, options.initialValue);
      ctx.update(editorViewOptionsCtx, (previous) => ({
        ...previous,
        editable: () => options.editable(),
        attributes: { class: 'note-markdown-wysiwyg__surface' },
      }));
      ctx.get(listenerCtx).markdownUpdated((_ctx, markdown) => scheduleChange(markdown));
      ctx.update(remarkPluginsCtx, (plugins) => [
        ...plugins,
        {
          plugin: remarkMarkExtension,
          options: {},
        } as unknown as (typeof plugins)[number],
      ]);
    })
    .use(listener)
    .use(commonmark)
    .use(gfm)
    .use(history)
    .use(math)
    .use(highlightSchema)
    .use(highlightCommand)
    .use(highlightInputRule)
    .create();

  let destroyed = false;
  const result: NoteWysiwyg = {
    getMarkdown: () => editor.action(getMarkdown()),
    setMarkdown: (markdown) => editor.action(replaceAll(markdown)),
    insert: (markdown) => editor.action(insert(markdown)),
    toggleHeading: (level) =>
      editor.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        const state = view.state;
        for (let depth = state.selection.$from.depth; depth > 0; depth -= 1) {
          const node = state.selection.$from.node(depth);
          if (node.type.name === 'heading') {
            // biome-ignore lint/complexity/useLiteralKeys: ProseMirror node attributes are runtime maps.
            if (Number(node.attrs['level']) === level) {
              callCommand(turnIntoTextCommand.key)(ctx);
            } else {
              callCommand(wrapInHeadingCommand.key, level)(ctx);
            }
            return;
          }
        }
        callCommand(wrapInHeadingCommand.key, level)(ctx);
      }),
    toggleBold: () => editor.action((ctx) => void callCommand(toggleStrongCommand.key)(ctx)),
    toggleItalic: () => editor.action((ctx) => void callCommand(toggleEmphasisCommand.key)(ctx)),
    toggleStrikethrough: () =>
      editor.action((ctx) => void callCommand(toggleStrikethroughCommand.key)(ctx)),
    toggleBulletList: () =>
      editor.action((ctx) => void callCommand(wrapInBulletListCommand.key)(ctx)),
    toggleOrderedList: () =>
      editor.action((ctx) => void callCommand(wrapInOrderedListCommand.key)(ctx)),
    toggleHighlight: () => editor.action((ctx) => void callCommand(highlightCommand.key)(ctx)),
    undo: () => editor.action((ctx) => void callCommand(undoCommand.key)(ctx)),
    redo: () => editor.action((ctx) => void callCommand(redoCommand.key)(ctx)),
    canUndo: () =>
      editor.action((ctx) => {
        try {
          return undoDepth(ctx.get(editorViewCtx).state) > 0;
        } catch {
          return false;
        }
      }),
    canRedo: () =>
      editor.action((ctx) => {
        try {
          return redoDepth(ctx.get(editorViewCtx).state) > 0;
        } catch {
          return false;
        }
      }),
    activeState: () => {
      try {
        return editor.action((ctx) => {
          const view = ctx.get(editorViewCtx);
          const { state } = view;
          const node = state.selection.$from.node(1) ?? state.selection.$from.parent;
          const marks = state.selection.$from.marks();
          const has = (name: string): boolean => marks.some((mark) => mark.type.name === name);
          return {
            heading: node?.type.name === 'heading',
            strong: has('strong'),
            em: has('emphasis'),
            strike: has('strike_through'),
            highlight: has('highlight'),
          };
        });
      } catch {
        return { heading: false, strong: false, em: false, strike: false, highlight: false };
      }
    },
    marksForRange: () => {
      try {
        return editor.action((ctx) => {
          const view = ctx.get(editorViewCtx);
          const { state } = view;
          const { from, to, empty, $from } = state.selection;
          const has = (name: string): boolean => {
            const type = state.schema.marks[name];
            if (!type) return false;
            if (empty) return $from.marks().some((mark) => mark.type === type);
            return state.doc.rangeHasMark(from, to, type);
          };
          return {
            strong: has('strong'),
            em: has('emphasis'),
            strike: has('strike_through'),
            highlight: has('highlight'),
          };
        });
      } catch {
        return { ...EMPTY_NOTE_MARKS };
      }
    },
    deleteBeforeCursor: () =>
      editor.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        const { state } = view;
        if (!state.selection.empty) return;
        const caret = state.selection.from;
        const window = 80;
        const text = state.doc.textBetween(Math.max(0, caret - window), caret, '\uFFFC', '\uFFFC');
        const match = /@([\p{L}\p{N}_-]*)$/u.exec(text);
        if (!match) return;
        view.dispatch(state.tr.delete(caret - match[0].length, caret));
      }),
    escapeQuoteOnEnter: () =>
      editor.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        const { state } = view;
        if (!state.selection.empty) return false;
        const $from = state.selection.$from;
        if ($from.parent.type.name !== 'paragraph') return false;
        if ($from.parent.textContent.trim().length > 0) return false;
        let inQuote = false;
        for (let depth = $from.depth; depth > 0; depth -= 1) {
          if ($from.node(depth).type.name === 'blockquote') {
            inQuote = true;
            break;
          }
        }
        if (!inQuote) return false;
        const start = $from.before($from.depth);
        const end = $from.after($from.depth);
        view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, start, end)));
        return lift(view.state, view.dispatch);
      }),
    focus: () => editor.action((ctx) => ctx.get(editorViewCtx).focus()),
    destroy: () => {
      if (destroyed) return;
      destroyed = true;
      if (changeTimer !== undefined) {
        clearTimeout(changeTimer);
        changeTimer = undefined;
        options.onChange(editor.action(getMarkdown()));
      }
      void editor.destroy();
    },
  };
  return result;
}
