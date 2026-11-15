import type { DefinitionReferenceReply, DefinitionReferenceRequest } from '@localmed/contracts';
import type { StorageHealth } from '@localmed/storage';
import type { SqliteIntegrityReport } from '@localmed/storage-sqlite';
import { describe, expect, it, vi } from 'vitest';

import { inspectModuleStore } from '@/features/modules/module-inspection';

const health = { schemaVersion: 2 } as unknown as StorageHealth;
const integrity = { integrity: 'ok' } as unknown as SqliteIntegrityReport;
const status = { op: 'status', entries: 3 } as unknown as DefinitionReferenceReply;

function fakeStore() {
  return {
    initialize: vi.fn(async () => health),
    inspectIntegrity: vi.fn(async () => integrity),
    reference: vi.fn(async () => status),
  };
}

describe('inspectModuleStore', () => {
  it('initializes, then checks integrity with the requested scan', async () => {
    const store = fakeStore();
    await expect(inspectModuleStore(store, 'sampled', undefined)).resolves.toEqual({
      health,
      integrity,
    });
    expect(store.inspectIntegrity).toHaveBeenCalledWith('sampled');
    expect(store.reference).not.toHaveBeenCalled();
  });

  it('reads the reference status only when the module declares one, and times both phases', async () => {
    const store = fakeStore();
    const phases: string[] = [];
    const request = { op: 'status', moduleId: 'm', editionId: 'e' } as DefinitionReferenceRequest;
    const result = await inspectModuleStore(store, 'full', request, (phase, run) => {
      phases.push(phase);
      return run();
    });
    expect(result.reference).toBe(status);
    expect(store.reference).toHaveBeenCalledWith(request);
    expect(phases).toEqual(['validate-initialize', 'validate-integrity']);
  });
});
