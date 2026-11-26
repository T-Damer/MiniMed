import type { ListItem, PhrasingContent, RootContent } from 'mdast';
import remarkParse from 'remark-parse';
import { unified } from 'unified';

type Node = RootContent | PhrasingContent | ListItem;
const parser = unified().use(remarkParse);
const paragraphKinds = {
  paragraph: 'paragraph',
  strong: 'bold',
  emphasis: 'italic',
  listItem: 'item',
} as const;

export type ChatText =
  | { readonly kind: 'text'; readonly text: string }
  | {
      readonly kind: 'paragraph' | 'bold' | 'italic' | 'list' | 'numbered' | 'item';
      readonly children: readonly ChatText[];
    };

function readNode(node: Node, source: string): ChatText {
  switch (node.type) {
    case 'text':
      return { kind: 'text', text: node.value };
    case 'paragraph':
    case 'strong':
    case 'emphasis':
    case 'listItem':
      return {
        kind: paragraphKinds[node.type],
        children: node.children.map((child) => readNode(child, source)),
      };
    case 'list':
      return {
        kind: node.ordered ? 'numbered' : 'list',
        children: node.children.map((child) => readNode(child, source)),
      };
    default: {
      const position = node.position;
      return { kind: 'text', text: source.slice(position?.start.offset, position?.end.offset) };
    }
  }
}

function plainNode(node: ChatText): string {
  if (node.kind === 'text') return node.text;
  const lineGroup = node.kind === 'item' || node.kind === 'list' || node.kind === 'numbered';
  return node.children.map(plainNode).join(lineGroup ? '\n' : '');
}

/** The supported formatting becomes text nodes and ordinary elements. HTML and links stay literal. */
export function parseCompanionText(source: string): { text: string; blocks?: readonly ChatText[] } {
  if (!/[*_]|^(?:[-+] |\d+\. )/mu.test(source)) return { text: source };
  const blocks = parser.parse(source).children.map((node) => readNode(node, source));
  return { text: blocks.map(plainNode).join('\n\n'), blocks };
}

export type ChatFormat = 'bold' | 'italic' | 'list';

export function editCompanionFormat(
  text: string,
  start: number,
  end: number,
  format: ChatFormat,
): { text: string; start: number; end: number } {
  if (format === 'list') {
    const lineStart = text.lastIndexOf('\n', start - 1) + 1;
    const selection = text.slice(lineStart, end);
    const enabled = selection.split('\n').every((line) => line.startsWith('- '));
    const replacement = selection
      .split('\n')
      .map((line) => (enabled ? line.slice(2) : `- ${line}`))
      .join('\n');
    const nextEnd = lineStart + replacement.length;
    return {
      text: text.slice(0, lineStart) + replacement + text.slice(end),
      start: start === end ? nextEnd : lineStart,
      end: nextEnd,
    };
  }
  const marker = format === 'bold' ? '**' : '_';
  const selected = text.slice(start, end);
  const enabled =
    start >= marker.length &&
    text.slice(start - marker.length, start) === marker &&
    text.startsWith(marker, end);
  const from = enabled ? start - marker.length : start;
  const to = enabled ? end + marker.length : end;
  const replacement = enabled ? selected : marker + selected + marker;
  const nextStart = enabled ? from : start + marker.length;
  return {
    text: text.slice(0, from) + replacement + text.slice(to),
    start: nextStart,
    end: nextStart + selected.length,
  };
}
