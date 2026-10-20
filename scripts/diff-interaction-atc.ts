/**
 * The input of the ATC4 medical review: what changed between two builds of the interaction index.
 *
 *   MINIMED_DATA_ROOT=<main checkout> bun scripts/diff-interaction-atc.ts \
 *     --old <index.json> --new <index.json> --esklp-dir <decoded ЕСКЛП databases> --out <file.json>
 *
 * Two kinds of change reach a doctor and both are listed with the code that caused them:
 * - a class membership: a card gained (or lost) a class target, so a sentence that names the class
 *   («противовирусные препараты») now is (or is not) shown for that drug; per membership the
 *   readers are the instructions that name the class;
 * - an own-class suppression: a class target that left a sentence of the drug's own instruction
 *   because the drug now belongs to the class itself.
 * For each it carries the evidence a reviewer needs: the ЕСКЛП node (code, form, provenance,
 * pharmacotherapeutic group), the class phrase and its НСИ name, and sample sentences read from
 * the published instruction modules. The instruction texts stay in the output file only; the file
 * is a review input in the scratch directory, never committed.
 */
import { Database } from 'bun:sqlite';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import {
  parseAtcCodeExceptions,
  selectAtcCodesOfMetadata,
} from '../apps/app/src/features/drug-interactions/atc-codes';
import {
  CLASS_ALIASES,
  deriveClassPhrases,
} from '../apps/app/src/features/drug-interactions/class-phrases';
import {
  createInteractionIndex,
  drugTargetSet,
  type InteractionIndexAsset,
  SECTION_ID_PREFIX,
} from '../apps/app/src/features/drug-interactions/interaction-index';
import {
  canonicalSectionText,
  spanDisplayText,
} from '../apps/app/src/features/drug-interactions/interaction-text';
import { nameStems } from '../apps/app/src/features/drug-interactions/mention-matcher';
import { readEsklpCardMetadata } from './lib/published-esklp';

const ROOT = resolve(import.meta.dirname, '..');
const DATA_ROOT = process.env['MINIMED_DATA_ROOT'] ?? ROOT;
const EXCEPTIONS = join(
  ROOT,
  'apps/app/src/features/drug-interactions/data/atc-code-exceptions.json',
);
const ATC_NAMES = join(ROOT, 'apps/app/src/features/medications/atc-names.json');
const MODULE_DIRECTORIES = [
  'output/module-zstd-grls-h2-2026-10-20/grls-instructions-2026.10.20-4b6befe857de-kd1',
  'output/module-zstd-manufacturer-h2-2026-10-20/manufacturer-instructions-2026.10.20-cb9d2ece8ef5',
].map((directory) => join(DATA_ROOT, directory));

function argument(name: string): string {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function optionalArgument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

/**
 * What the code selection ignored: every candidate code of a node flagged `conflict` or
 * `unconfirmed` that is not among the card's selected codes, and the consensus codes taken. The
 * data test asserts that none of the ignored candidates is in the committed index.
 */
function writeSelectionAudit(esklpDirectory: string, path: string): void {
  const exceptions = parseAtcCodeExceptions(JSON.parse(readFileSync(EXCEPTIONS, 'utf8')));
  const ignored: [string, string, string][] = [];
  const consensus: [string, string][] = [];
  const flagged = { conflict: 0, unconfirmed: 0 };
  let nodeCount = 0;
  for (const { id, metadata } of readEsklpCardMetadata(esklpDirectory)) {
    const selection = selectAtcCodesOfMetadata(id, metadata, exceptions);
    const nodes = (
      Array.isArray(metadata['smnnNodes']) ? metadata['smnnNodes'] : []
    ) as readonly Record<string, unknown>[];
    for (const node of nodes) {
      nodeCount += 1;
      const flag = node['atcFlag'];
      if (flag !== 'conflict' && flag !== 'unconfirmed') continue;
      flagged[flag] += 1;
      const candidates = Array.isArray(node['atcCandidates']) ? node['atcCandidates'] : [];
      for (const candidate of candidates as readonly Record<string, unknown>[]) {
        const code = candidate['code'];
        if (typeof code === 'string' && !selection.codes.includes(code)) {
          ignored.push([id.replace(/^esklp\.mnn\./u, ''), code, flag]);
        }
      }
    }
    for (const [code, origins] of Object.entries(selection.origins)) {
      if (origins.includes('consensus')) consensus.push([id.replace(/^esklp\.mnn\./u, ''), code]);
    }
  }
  const unique = [...new Map(ignored.map((row) => [row.join('|'), row])).values()].toSorted(
    (a, b) => a.join('|').localeCompare(b.join('|')),
  );
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(
    path,
    `${JSON.stringify({ nodes: nodeCount, flaggedNodes: flagged, consensusCodesUsed: consensus, ignoredCandidates: unique }, null, 1)}\n`,
  );
}

function loadAsset(path: string): InteractionIndexAsset {
  return JSON.parse(readFileSync(path, 'utf8')) as InteractionIndexAsset;
}

const SENTENCE_SAMPLE = 10;
const EVIDENCE_LENGTH = 700;

/** Opens the decoded module of a document, decoding it once into the scratch directory. */
function createModuleReader(asset: InteractionIndexAsset) {
  const scratch = join(tmpdir(), `atc4-diff-${process.pid}`);
  mkdirSync(scratch, { recursive: true });
  const open = new Map<number, Database>();
  function database(moduleIndex: number): Database {
    const cached = open.get(moduleIndex);
    if (cached) return cached;
    const moduleId = asset.modules[moduleIndex];
    const module = asset.basis.modules.find((item) => item.id === moduleId);
    if (!module) throw new Error(`module ${moduleIndex} is not in the asset`);
    const source = MODULE_DIRECTORIES.map((directory) =>
      join(directory, `${module.id}.db.zst`),
    ).find(existsSync);
    if (!source) throw new Error(`The published file of ${module.id} is missing`);
    const digest = `sha256:${createHash('sha256').update(readFileSync(source)).digest('hex')}`;
    if (digest !== module.sha256)
      throw new Error(`${module.id}: ${digest} is not the indexed file`);
    const decoded = join(scratch, `${module.id}.db`);
    const result = Bun.spawnSync(['zstd', '-d', '-q', '-f', source, '-o', decoded]);
    if (result.exitCode !== 0) throw new Error(`zstd failed on ${module.id}`);
    const opened = new Database(decoded, { readonly: true });
    open.set(moduleIndex, opened);
    return opened;
  }
  function chunks(moduleIndex: number, sectionId: string): readonly string[] {
    return database(moduleIndex)
      .query<{ original_text: string }, [string]>(
        'select original_text from chunks where section_id = ? order by order_index',
      )
      .all(sectionId)
      .map((row) => row.original_text);
  }
  return {
    sentence(moduleIndex: number, sectionKey: string, start: number, end: number): string {
      const text = canonicalSectionText(chunks(moduleIndex, `${SECTION_ID_PREFIX}${sectionKey}`));
      return spanDisplayText(text.text, { start, end });
    },
    /** The first words of the sections that say what the drug is and what it is for. */
    profile(moduleIndex: number, documentId: string): Record<string, string> {
      const db = database(moduleIndex);
      const version = db
        .query<{ current_version_id: string; title: string }, [string]>(
          'select current_version_id, title from documents where id = ?',
        )
        .get(documentId);
      if (!version) return {};
      const sections = db
        .query<{ id: string; title: string; section_type: string | null }, [string]>(
          'select id, title, section_type from sections where document_version_id = ? order by order_index',
        )
        .all(version.current_version_id);
      const profile: Record<string, string> = { title: version.title };
      for (const wanted of ['pharmacology', 'indications']) {
        const section = sections.find((item) => item.section_type === wanted);
        if (!section) continue;
        const text = canonicalSectionText(
          db
            .query<{ original_text: string }, [string]>(
              'select original_text from chunks where section_id = ? order by order_index',
            )
            .all(section.id)
            .map((row) => row.original_text),
        ).text.replace(/\s+/gu, ' ');
        profile[wanted] = text.slice(0, EVIDENCE_LENGTH);
      }
      return profile;
    },
    close(): void {
      for (const opened of open.values()) opened.close();
      rmSync(scratch, { recursive: true, force: true });
    },
  };
}

interface Membership {
  readonly change: 'gained' | 'lost';
  readonly card: string;
  readonly cardName: string;
  readonly class: {
    readonly code: string;
    readonly name: string | null;
    readonly rule: readonly Record<string, string>[];
  };
  readonly oldCodes: readonly string[];
  readonly newCodes: readonly string[];
  readonly triggerNodes: readonly Record<string, unknown>[];
  readonly pharmacotherapeuticGroups: readonly string[];
  readonly readers: {
    readonly documents: number;
    readonly cards: number;
    readonly inInteractionSection: number;
    readonly inWarnings: number;
    readonly samples: readonly Record<string, unknown>[];
  };
  readonly ownInstruction: Record<string, string> | null;
}

function main(): void {
  const oldAsset = loadAsset(argument('--old'));
  const newAsset = loadAsset(argument('--new'));
  if (JSON.stringify(oldAsset.targets) !== JSON.stringify(newAsset.targets)) {
    throw new Error('the two indexes name different targets; the diff reads class targets only');
  }
  const oldIndex = createInteractionIndex(oldAsset);
  const newIndex = createInteractionIndex(newAsset);
  const atcNames = (
    JSON.parse(readFileSync(ATC_NAMES, 'utf8')) as { names: Record<string, string> }
  ).names;
  const phrases = deriveClassPhrases(atcNames).phrases;
  const metadataOfCard = new Map(
    readEsklpCardMetadata(argument('--esklp-dir')).map((row) => [row.id, row.metadata]),
  );
  const reader = createModuleReader(newAsset);
  const classTargets = newAsset.targets.flatMap((target, index) =>
    target.startsWith('c:') ? [{ index, code: target.slice(2) }] : [],
  );

  // Readers of every class target: the documents with a sentence that names it.
  const readersOf = new Map<number, { document: string; span: readonly number[] }[]>();
  for (const [documentId, document] of Object.entries(newAsset.documents)) {
    for (const span of document.sp) {
      for (const target of span.slice(4)) {
        if (!newAsset.targets[target]?.startsWith('c:')) continue;
        const list = readersOf.get(target);
        if (list) list.push({ document: documentId, span });
        else readersOf.set(target, [{ document: documentId, span }]);
      }
    }
  }

  const memberships: Membership[] = [];
  newAsset.cards.forEach((card, cardIndex) => {
    const before = drugTargetSet(oldIndex, cardIndex);
    const after = drugTargetSet(newIndex, cardIndex);
    for (const { index, code } of classTargets) {
      if (before.has(index) === after.has(index)) continue;
      const id = `esklp.mnn.${card[0]}`;
      const metadata = metadataOfCard.get(id) ?? {};
      const nodes = (
        Array.isArray(metadata['smnnNodes']) ? metadata['smnnNodes'] : []
      ) as readonly Record<string, unknown>[];
      const reading = readersOf.get(index) ?? [];
      const readerDocuments = new Set(reading.map((item) => item.document));
      const readerCards = new Set(
        [...readerDocuments].flatMap((documentId) => newAsset.documents[documentId]?.c ?? []),
      );
      const samples = reading
        .toSorted((left, right) => left.document.localeCompare(right.document))
        .filter(
          (_, position, all) =>
            position % Math.max(1, Math.floor(all.length / SENTENCE_SAMPLE)) === 0,
        )
        .slice(0, SENTENCE_SAMPLE)
        .map((item) => {
          const document = newAsset.documents[item.document];
          const [section, start, end, flags] = item.span as readonly number[];
          const sectionEntry = document?.sec[section ?? 0];
          return {
            document: item.document,
            trade: document?.t ?? null,
            flags,
            text:
              document && sectionEntry && start !== undefined && end !== undefined
                ? reader.sentence(document.m, sectionEntry[0], start, end)
                : null,
          };
        });
      const ownDocument = newIndex.documentsOfCard.get(cardIndex)?.[0];
      const own = ownDocument ? newAsset.documents[ownDocument] : undefined;
      memberships.push({
        change: after.has(index) ? 'gained' : 'lost',
        card: id,
        cardName: String(metadata['standardizedInn'] ?? card[0]),
        class: {
          code,
          name: atcNames[code] ?? null,
          rule: phrases
            .filter((phrase) => phrase.codes.includes(code))
            .map((phrase) => ({
              words: phrase.stems.join(' '),
              origin: phrase.origin,
              basis:
                CLASS_ALIASES.find(
                  (alias) => nameStems(alias.text).join(' ') === phrase.stems.join(' '),
                )?.basis ?? `НСИ «АТХ» v3.8: название группы ${code}`,
            })),
        },
        oldCodes: oldAsset.cards[cardIndex]?.[1] ?? [],
        newCodes: card[1],
        triggerNodes: nodes
          .filter((node) => {
            const consensus = node['atcConsensus'] as { code?: string } | undefined;
            return [node['atcCode'], consensus?.code].some(
              (item) => typeof item === 'string' && item.startsWith(code),
            );
          })
          .slice(0, 4)
          .map((node) => ({
            atcCode: node['atcCode'],
            atcOriginal: node['atcOriginal'] ?? null,
            atcFlag: node['atcFlag'] ?? null,
            atcSources: node['atcSources'] ?? null,
            atcConsensus: node['atcConsensus'] ?? null,
            dosageForm: node['dosageForm'],
            pharmacotherapeuticGroup: node['pharmacotherapeuticGroup'] ?? null,
          })),
        pharmacotherapeuticGroups: [
          ...new Set(
            nodes.flatMap((node) =>
              typeof node['pharmacotherapeuticGroup'] === 'string'
                ? [node['pharmacotherapeuticGroup']]
                : [],
            ),
          ),
        ],
        readers: {
          documents: readerDocuments.size,
          cards: readerCards.size,
          inInteractionSection: reading.filter((item) => ((item.span[3] ?? 0) & 1) !== 0).length,
          inWarnings: reading.filter((item) => ((item.span[3] ?? 0) & 1) === 0).length,
          samples,
        },
        ownInstruction: ownDocument && own ? reader.profile(own.m, ownDocument) : null,
      });
    }
  });

  // Own-class suppression: class targets that left a sentence of the drug's own instruction.
  const suppressions: Record<string, unknown>[] = [];
  for (const [documentId, before] of Object.entries(oldAsset.documents)) {
    const after = newAsset.documents[documentId];
    if (!after || JSON.stringify(before.sp) === JSON.stringify(after.sp)) continue;
    const key = (span: readonly number[]): string => span.slice(0, 4).join(',');
    const afterByKey = new Map(after.sp.map((span) => [key(span), span]));
    for (const span of before.sp) {
      const kept = afterByKey.get(key(span));
      const lost = span.slice(4).filter((target) => !(kept?.slice(4) ?? []).includes(target));
      const gained = (kept?.slice(4) ?? []).filter((target) => !span.slice(4).includes(target));
      if (lost.length === 0 && gained.length === 0 && kept) continue;
      const [section, start, end, flags] = span as readonly number[];
      const sectionEntry = before.sec[section ?? 0];
      suppressions.push({
        document: documentId,
        trade: before.t,
        cards: before.c.map((card) => newAsset.cards[card]?.[0]),
        span: [section, start, end],
        flags,
        lostTargets: lost.map((target) => newAsset.targets[target]),
        lostClassNames: lost.map(
          (target) => atcNames[(newAsset.targets[target] ?? '').slice(2)] ?? null,
        ),
        gainedTargets: gained.map((target) => newAsset.targets[target]),
        sentenceKept: kept !== undefined,
        text:
          sectionEntry && start !== undefined && end !== undefined
            ? reader.sentence(before.m, sectionEntry[0], start, end)
            : null,
      });
    }
  }
  reader.close();
  const auditOutput = optionalArgument('--audit-out');
  if (auditOutput) writeSelectionAudit(argument('--esklp-dir'), resolve(auditOutput));
  const output = resolve(argument('--out'));
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(
    output,
    `${JSON.stringify(
      {
        summary: {
          membershipsGained: memberships.filter((item) => item.change === 'gained').length,
          membershipsLost: memberships.filter((item) => item.change === 'lost').length,
          cards: new Set(memberships.map((item) => item.card)).size,
          suppressedSentenceTargets: suppressions.length,
        },
        memberships,
        suppressions,
      },
      null,
      2,
    )}\n`,
  );
  console.log(
    `memberships ${memberships.length} (cards ${new Set(memberships.map((item) => item.card)).size}), own-class suppressions ${suppressions.length}`,
  );
}

main();
