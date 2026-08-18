export type GraphTone = 'clinical' | 'drug' | 'legal' | 'notes' | 'other';

export function graphToneForSourceType(sourceType: string): GraphTone {
  if (sourceType.startsWith('clinical_recommendation')) return 'clinical';
  if (sourceType.startsWith('official_drug') || sourceType.startsWith('official_registry')) {
    return 'drug';
  }
  if (sourceType === 'regulatory_act') return 'legal';
  if (sourceType.startsWith('personal_') || sourceType.includes('note')) return 'notes';
  return 'other';
}

function readCssVar(element: Element, name: string, fallback: string): string {
  const value = getComputedStyle(element).getPropertyValue(name).trim();
  return value || fallback;
}

export function isDarkGraphTheme(root: Element = document.documentElement): boolean {
  return root.classList.contains('theme-dark') || root.getAttribute('data-theme') === 'dark';
}

export function readGraphCanvasFill(element: Element): string {
  return readCssVar(
    element,
    '--paper',
    readCssVar(element, '--theme-surface', readCssVar(element, '--theme-background', '#fbf7ea')),
  );
}

export interface GraphToneFill {
  readonly fill: string;
}

export const LIGHT_GRAPH_TONES: Readonly<Record<GraphTone, GraphToneFill>> = {
  clinical: { fill: '#d9e6d2' },
  drug: { fill: '#d9e8ed' },
  legal: { fill: '#f1dfc4' },
  notes: { fill: '#ead9e5' },
  other: { fill: '#fbf7ea' },
};

export const DARK_GRAPH_TONES: Readonly<Record<GraphTone, GraphToneFill>> = {
  clinical: { fill: '#3a4f3a' },
  drug: { fill: '#334a52' },
  legal: { fill: '#4f4335' },
  notes: { fill: '#4a3d47' },
  other: { fill: '#3a3834' },
};

export const LIGHT_DOMAIN_PALETTE: readonly string[] = [
  '#e3c6d2',
  '#c4d9e4',
  '#cfe0c2',
  '#e8d8b0',
  '#d5cde6',
  '#c2ded6',
  '#e6cbbd',
  '#dee3b8',
];

export const DARK_DOMAIN_PALETTE: readonly string[] = [
  '#5a3f49',
  '#3f5560',
  '#465a42',
  '#5a5138',
  '#4f4860',
  '#3f5650',
  '#5a4a40',
  '#565a3f',
];

export function graphTonesForTheme(dark: boolean): Readonly<Record<GraphTone, GraphToneFill>> {
  return dark ? DARK_GRAPH_TONES : LIGHT_GRAPH_TONES;
}

export function graphDomainPalette(dark: boolean): readonly string[] {
  return dark ? DARK_DOMAIN_PALETTE : LIGHT_DOMAIN_PALETTE;
}

export function graphDomainColor(specialty: string, dark: boolean): string {
  const palette = graphDomainPalette(dark);
  let hash = 0;
  for (let index = 0; index < specialty.length; index += 1) {
    hash = (hash * 31 + specialty.charCodeAt(index)) >>> 0;
  }
  return palette[hash % palette.length] ?? (dark ? '#3a3834' : '#fbf7ea');
}

export function readGraphThemeColors(element: Element): {
  readonly text: string;
  readonly graphStroke: string;
  readonly danger: string;
  readonly canvasFill: string;
  readonly dark: boolean;
} {
  const dark = isDarkGraphTheme(element.ownerDocument?.documentElement ?? document.documentElement);
  return {
    text: readCssVar(element, '--theme-text', '#292720'),
    graphStroke: readCssVar(element, '--theme-graph-stroke', '#817a6d'),
    danger: readCssVar(element, '--theme-danger', '#87453c'),
    canvasFill: readGraphCanvasFill(element),
    dark,
  };
}
