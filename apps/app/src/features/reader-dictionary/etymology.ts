import type { CoreIdentityHit, MedicalCore } from '@localmed/contracts';

/** One verbatim origin statement of a dictionary entry, as the edition's annotations hold it. */
export interface EtymologyNote {
  readonly id: string;
  readonly statement: string;
}

const MAX_PAGES = 3;
const MAX_NOTES = 4;

/**
 * The origin (etymology) statements the installed dictionary edition holds for an entry. Nothing is
 * generated: an entry whose edition carries no annotation of kind «etymology», an edition that is
 * not installed, or a hit that is not a dictionary entry gives an empty list. A failing read
 * rejects with the core's message.
 */
export async function loadEtymology(
  core: MedicalCore,
  hit: CoreIdentityHit,
): Promise<readonly EtymologyNote[]> {
  const target = hit.target;
  if (target.type !== 'definition' || !core.reference) return [];
  const notes: EtymologyNote[] = [];
  let after: string | undefined;
  for (let page = 0; page < MAX_PAGES && notes.length < MAX_NOTES; page += 1) {
    const result = await core.reference({
      moduleId: target.moduleId,
      editionId: target.editionId,
      op: 'annotations',
      id: target.entityId,
      ...(after ? { after } : {}),
    });
    if (!result.ok) throw new Error(result.error.message);
    if (result.value.op !== 'annotations') return notes;
    for (const item of result.value.page.items) {
      const statement = item.statement.replace(/\s+/gu, ' ').trim();
      if (item.kind === 'etymology' && statement && notes.length < MAX_NOTES) {
        notes.push({ id: item.id, statement });
      }
    }
    if (!result.value.page.next) break;
    after = result.value.page.next;
  }
  return notes;
}
