import type { MedicalDocument } from '@localmed/contracts';

/**
 * Pure parser for Allmed reference recipe sections (`# Пример рецепта ...` and
 * `# Расшифровка примера рецепта ...`). Extracts deduplicated `Rp.:` blocks (preferring Russian
 * `S.` instructions when `recipe` has English `S.`), dispensing notes, and official blank numbers
 * (e.g. `107-1/у`, `148-1/у-88`).
 */

export interface AllmedRecipeExample {
  readonly id: string;
  readonly label: string;
  readonly text: string;
}

export interface AllmedRecipesSummary {
  readonly recipes: readonly AllmedRecipeExample[];
  readonly formNumbers: readonly string[];
  readonly dispensingNotes: readonly string[];
}

const RECIPE_SECTION_RE = /^пример\s+рецепта/iu;
const RECIPE_RU_SECTION_RE = /^расшифровка\s+примера\s+рецепта/iu;
const FORM_NUMBER_RE =
  /(?<![\p{L}\p{N}])(107-1\/у|148-1\/у-88|148-1\/у-04|107\/у-НП|148-1\/у)(?![\p{L}\p{N}])/giu;
const CYRILLIC_RE = /[а-яё]/iu;

function cleanBlockText(raw: string): string {
  return raw
    .replace(/<!--[\s\S]*?-->/gu, '')
    .replace(/\r\n?/gu, '\n')
    .replace(/[ \t]+\n/gu, '\n')
    .replace(/\n{3,}/gu, '\n\n')
    .trim();
}

function normalizeForDedup(text: string): string {
  return text.toLocaleLowerCase('ru-RU').replaceAll('ё', 'е').replace(/\s+/gu, ' ').trim();
}

function splitSectionText(text: string): {
  readonly rpBlocks: readonly string[];
  readonly notes: readonly string[];
} {
  const cleaned = cleanBlockText(text);
  if (!cleaned) return { rpBlocks: [], notes: [] };

  const lines = cleaned.split('\n');
  const rpBlocks: string[] = [];
  const notes: string[] = [];
  let currentRp: string[] | null = null;

  const flushRp = (): void => {
    if (!currentRp) return;
    const joined = currentRp.join('\n').trim();
    if (joined) rpBlocks.push(joined);
    currentRp = null;
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      flushRp();
      continue;
    }
    if (/^Rp\.?\s*:/iu.test(line) || /^Rp\./iu.test(line)) {
      flushRp();
      currentRp = [line];
      continue;
    }
    if (
      /^(?:рецептурный\s+бланк|отпускается|таблетки\s+(?:по|без)\s+рецепта|ампулы\s+(?:по|без)\s+рецепта|раствор\s+(?:по|без)\s+рецепта|капсулы\s+(?:по|без)\s+рецепта|по\s+рецепту|без\s+рецепта)/iu.test(
        line,
      )
    ) {
      flushRp();
      notes.push(line);
      continue;
    }
    if (currentRp) {
      currentRp.push(line);
    } else {
      notes.push(line);
    }
  }
  flushRp();
  return { rpBlocks, notes };
}

function recipeLabel(block: string, index: number): string {
  const firstLine =
    block
      .split('\n')[0]
      ?.replace(/^Rp\.?\s*:?\s*/iu, '')
      .trim() ?? '';
  if (!firstLine) return `Рецепт ${index + 1}`;
  return firstLine.length > 46 ? `${firstLine.slice(0, 45)}…` : firstLine;
}

function hasRussianSignatura(block: string): boolean {
  const signatura = block.split('\n').find((line) => /^\s*(?:D\.\s*)?S\.?\s*[:.]/iu.test(line));
  return signatura ? CYRILLIC_RE.test(signatura) : CYRILLIC_RE.test(block);
}

export function extractAllmedRecipes(
  documents: readonly (MedicalDocument | null | undefined)[],
): AllmedRecipesSummary {
  const primaryBlocks: string[] = [];
  const ruBlocks: string[] = [];
  const rawNotes: string[] = [];
  const formSet = new Set<string>();

  for (const document of documents) {
    if (document?.sourceType !== 'allmed_reference') continue;
    for (const section of document.sections) {
      const title = section.title.trim();
      const isPrimary = RECIPE_SECTION_RE.test(title);
      const isRu = RECIPE_RU_SECTION_RE.test(title);
      if (!isPrimary && !isRu) continue;
      for (const chunk of section.chunks) {
        const { rpBlocks, notes } = splitSectionText(chunk.originalText);
        if (isRu) ruBlocks.push(...rpBlocks);
        else primaryBlocks.push(...rpBlocks);
        rawNotes.push(...notes);
      }
    }
  }

  // Prefer Russian-signatura blocks from `recipe_ru` when `recipe` has English `S.` lines.
  const ruHasRussian = ruBlocks.some(hasRussianSignatura);
  const primaryHasEnglishOnly =
    primaryBlocks.length > 0 && primaryBlocks.every((block) => !hasRussianSignatura(block));
  const orderedRaw =
    ruBlocks.length > 0 && (ruHasRussian || primaryHasEnglishOnly)
      ? [...ruBlocks, ...primaryBlocks]
      : [...primaryBlocks, ...ruBlocks];

  const seen = new Set<string>();
  const recipes: AllmedRecipeExample[] = [];
  for (const block of orderedRaw) {
    const key = normalizeForDedup(block);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    recipes.push({
      id: `allmed-rp-${recipes.length + 1}`,
      label: recipeLabel(block, recipes.length),
      text: block,
    });
  }

  const noteSeen = new Set<string>();
  const dispensingNotes: string[] = [];
  for (const note of rawNotes) {
    for (const match of note.matchAll(FORM_NUMBER_RE)) {
      if (match[1]) formSet.add(match[1]);
    }
    const cleanNote = note.replace(/^рецептурный\s+бланк\s*[-—:]\s*/iu, 'Бланк № ').trim();
    const key = normalizeForDedup(cleanNote);
    if (!key || noteSeen.has(key)) continue;
    noteSeen.add(key);
    dispensingNotes.push(cleanNote);
  }

  return {
    recipes,
    formNumbers: [...formSet],
    dispensingNotes,
  };
}
