/** Capture the existing collection operations, including their errors and capacity boundaries. */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  createCollection,
  deleteCollection,
  EMPTY_ITEM_COLLECTIONS,
  type ItemCollectionsState,
  type ItemRefInput,
  renameCollection,
  setItemInCollection,
  toggleFavoriteItem,
} from '@localmed/app/state/item-collections';
import { REPOSITORY_ROOT } from '@localmed/benchmarks/real-corpus';

const at = '2026-09-30T10:00:00.000Z';
const tool: ItemRefInput = { kind: 'tool', id: 'calc.bmi' };
const document: ItemRefInput = {
  kind: 'document',
  id: 'drug.allmed.3324',
  title: 'Препарат',
  documentKind: 'medication',
};
const note: ItemRefInput = {
  kind: 'note',
  id: 'note.stable-identity',
  parentId: 'card.stable-identity',
  title: 'Заметка',
};
type Operation =
  | { kind: 'toggle'; item: ItemRefInput; at: string }
  | { kind: 'create'; id: string; name: string; at: string; items: readonly ItemRefInput[] }
  | { kind: 'rename'; id: string; name: string }
  | { kind: 'delete'; id: string }
  | { kind: 'set'; id: string; item: ItemRefInput; included: boolean; at: string };

function apply(state: ItemCollectionsState, operation: Operation): ItemCollectionsState {
  switch (operation.kind) {
    case 'toggle':
      return toggleFavoriteItem(state, operation.item, operation.at);
    case 'create':
      return createCollection(state, operation.name, {
        id: operation.id,
        createdAt: operation.at,
        items: operation.items,
      });
    case 'rename':
      return renameCollection(state, operation.id, operation.name);
    case 'delete':
      return deleteCollection(state, operation.id);
    case 'set':
      return setItemInCollection(
        state,
        operation.id,
        operation.item,
        operation.included,
        operation.at,
      );
  }
}

const rows: {
  name: string;
  before: ItemCollectionsState;
  operation: Operation;
  after: ItemCollectionsState;
  error: string | null;
}[] = [];
function capture(name: string, before: ItemCollectionsState, operation: Operation) {
  let after = before;
  let error: string | null = null;
  try {
    after = apply(before, operation);
  } catch (cause) {
    if (!(cause instanceof Error)) throw cause;
    error = cause.message;
  }
  rows.push({ name, before, operation, after, error });
  return after;
}
const create = (id: string, name: string, items: readonly ItemRefInput[] = []): Operation => ({
  kind: 'create',
  id,
  name,
  at,
  items,
});
const toggle = (item: ItemRefInput): Operation => ({ kind: 'toggle', item, at });
const set = (id: string, item: ItemRefInput, included: boolean): Operation => ({
  kind: 'set',
  id,
  item,
  included,
  at,
});

let state = capture('favorite-tool', EMPTY_ITEM_COLLECTIONS, toggle(tool));
state = capture('favorite-document', state, toggle(document));
state = capture('favorite-note-parent', state, toggle(note));
state = capture('same-id-different-kind', state, toggle({ kind: 'document', id: tool.id }));
state = capture('favorite-removal-keeps-order', state, toggle(document));
state = capture(
  'missing-catalog-item-keeps-title',
  state,
  toggle({ ...document, id: 'archived.stable' }),
);
state = capture(
  'create-normalized-name',
  state,
  create('collection.one', ' \tМои\n\u00a0источники\ufeff ', [tool, document, tool, note]),
);
state = capture('same-item-second-collection', state, create('collection.two', 'Вторая', [tool]));
state = capture('same-item-add-noop', state, set('collection.two', tool, true));
state = capture('remove-only-one-collection', state, set('collection.one', tool, false));
state = capture('add-document-keeps-metadata', state, set('collection.two', document, true));
state = capture('missing-collection-add-noop', state, set('missing', note, true));
state = capture('missing-item-remove-noop', state, set('collection.two', note, false));
state = capture('rename-normalizes-name', state, {
  kind: 'rename',
  id: 'collection.two',
  name: ' \u3000Два\t источника\u2029',
});
capture('empty-name', state, create('empty', ' \n\ufeff '));
capture('name-61', state, create('long', 'я'.repeat(61)));
capture('duplicate-name-russian-case', state, create('duplicate-name', 'МОИ ИСТОЧНИКИ'));
capture('duplicate-id', state, create('collection.one', 'Новое имя'));
capture('rename-duplicate-name', state, {
  kind: 'rename',
  id: 'collection.two',
  name: 'мои источники',
});
capture('missing-rename-still-validates', state, { kind: 'rename', id: 'missing', name: '' });
capture('missing-rename-noop', state, { kind: 'rename', id: 'missing', name: 'Свободное имя' });
state = capture('own-name-russian-case', state, {
  kind: 'rename',
  id: 'collection.one',
  name: 'МОИ ИСТОЧНИКИ',
});
state = capture('yo-stays-distinct', state, create('collection.yo', 'Ёж'));
state = capture('e-stays-distinct', state, create('collection.e', 'Еж'));
capture('duplicate-yo-case', state, create('duplicate-yo', 'ёж'));
capture('name-60', state, create('exact-limit', 'я'.repeat(60)));
capture(
  'ecma-title-trim-no-interior-collapse',
  state,
  create('titles', 'Названия', [
    { ...document, title: '\ufeff\u00a0  Один  два\u3000' },
    { ...note, title: '\u0085Название\u0085' },
    { ...tool, title: ' \t ' },
    { kind: 'document', id: 'long.title', title: 'я'.repeat(301) },
  ]),
);
capture('missing-delete-noop', state, { kind: 'delete', id: 'missing' });
capture('delete-keeps-favorites-and-other-memberships', state, {
  kind: 'delete',
  id: 'collection.one',
});

const fullItems = Array.from({ length: 500 }, (_, index) => ({
  kind: 'tool' as const,
  id: `tool.${index}`,
  addedAt: at,
}));
const firstFullItem = fullItems[0];
if (!firstFullItem) throw new Error('Capacity case has no items');
const fullFavorites: ItemCollectionsState = { ...EMPTY_ITEM_COLLECTIONS, favorites: fullItems };
capture('favorite-capacity-keeps-existing-500', fullFavorites, toggle(tool));
capture('favorite-removal-at-capacity', fullFavorites, toggle(firstFullItem));
const fullCollection = createCollection(EMPTY_ITEM_COLLECTIONS, 'Полная', {
  id: 'full',
  createdAt: at,
  items: fullItems,
});
capture('collection-item-capacity-keeps-existing-500', fullCollection, set('full', tool, true));
capture(
  'initial-items-capacity-and-deduplication',
  EMPTY_ITEM_COLLECTIONS,
  create('bounded', 'Ограниченная', [...fullItems, firstFullItem, tool]),
);
let fullCollections = EMPTY_ITEM_COLLECTIONS;
for (let index = 0; index < 100; index++)
  fullCollections = createCollection(fullCollections, `Коллекция ${index}`, {
    id: `c.${index}`,
    createdAt: at,
  });
capture('collection-capacity-100', fullCollections, create('overflow', 'Переполнение'));

const source = 'apps/app/src/state/item-collections.ts';
const output = resolve(
  REPOSITORY_ROOT,
  'native/shared/src/commonTest/resources/native-collections-golden.json',
);
mkdirSync(dirname(output), { recursive: true });
writeFileSync(
  output,
  `${JSON.stringify(
    {
      schemaVersion: 1,
      source,
      sourceSha256: createHash('sha256')
        .update(readFileSync(resolve(REPOSITORY_ROOT, source)))
        .digest('hex'),
      cases: rows,
    },
    null,
    2,
  )}\n`,
);
console.log(JSON.stringify({ cases: rows.length, errors: rows.filter((row) => row.error).length }));
