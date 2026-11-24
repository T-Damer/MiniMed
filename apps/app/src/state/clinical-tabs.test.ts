import { beforeEach, describe, expect, it } from 'vitest';

import {
  activateClinicalTab,
  adjacentClinicalTab,
  closeClinicalTab,
  closeOtherClinicalTabs,
  hotClinicalTabIds,
  loadClinicalTabsState,
  MAX_CLINICAL_TABS,
  openClinicalTabInBackground,
  resetClinicalTabsForTests,
  syncRouteToClinicalTabs,
  tabIdForDocument,
  togglePinClinicalTab,
  updateClinicalTabMeta,
} from '@/state/clinical-tabs';
import { buildOfficialDocumentHash } from '@/state/document-route';

describe('clinical-tabs state', () => {
  beforeEach(() => {
    resetClinicalTabsForTests();
  });

  it('starts with a pinned Search tab and syncs opened official documents without duplicating', () => {
    const initial = loadClinicalTabsState();
    expect(initial.tabs).toHaveLength(1);
    expect(initial.tabs[0]?.kind).toBe('search');

    const hashA = buildOfficialDocumentHash('esklp.mnn.biperiden');
    const afterA = syncRouteToClinicalTabs(hashA, { title: 'Акинетон', now: 100 });
    expect(afterA.tabs).toHaveLength(2);
    expect(afterA.activeTabId).toBe(tabIdForDocument('official', 'esklp.mnn.biperiden'));

    const afterReopen = syncRouteToClinicalTabs(hashA, { title: 'Акинетон (Бипериден)', now: 200 });
    expect(afterReopen.tabs).toHaveLength(2);
    expect(afterReopen.tabs[1]?.title).toBe('Акинетон (Бипериден)');
  });

  it('opens documents in background without stealing active focus', () => {
    const hashA = buildOfficialDocumentHash('esklp.mnn.biperiden');
    const hashB = buildOfficialDocumentHash('kr.rf.507_4');
    syncRouteToClinicalTabs(hashA, { title: 'Акинетон', now: 100 });

    const bg = openClinicalTabInBackground({
      kind: 'official',
      documentId: 'kr.rf.507_4',
      title: 'Болезнь Паркинсона',
      hash: hashB,
      now: 150,
    });
    expect(bg.created).toBe(true);
    expect(bg.state.activeTabId).toBe(tabIdForDocument('official', 'esklp.mnn.biperiden'));
    expect(bg.state.tabs).toHaveLength(3);
  });

  it('keeps at most 2 hot tab IDs (active + most recently used)', () => {
    syncRouteToClinicalTabs(buildOfficialDocumentHash('doc.1'), { title: 'Doc 1', now: 100 });
    syncRouteToClinicalTabs(buildOfficialDocumentHash('doc.2'), { title: 'Doc 2', now: 200 });
    const state = syncRouteToClinicalTabs(buildOfficialDocumentHash('doc.3'), {
      title: 'Doc 3',
      now: 300,
    });
    expect(hotClinicalTabIds(state)).toEqual([
      tabIdForDocument('official', 'doc.3'),
      tabIdForDocument('official', 'doc.2'),
    ]);
  });

  it('evicts oldest unpinned tabs past MAX_CLINICAL_TABS while preserving pinned tabs', () => {
    syncRouteToClinicalTabs(buildOfficialDocumentHash('doc.pin'), { title: 'Pinned', now: 1 });
    togglePinClinicalTab(tabIdForDocument('official', 'doc.pin'));
    for (let index = 0; index < MAX_CLINICAL_TABS + 3; index += 1) {
      syncRouteToClinicalTabs(buildOfficialDocumentHash(`doc.${index}`), {
        title: `Doc ${index}`,
        now: 100 + index,
      });
    }
    const state = loadClinicalTabsState();
    expect(state.tabs).toHaveLength(MAX_CLINICAL_TABS);
    expect(state.tabs.some((tab) => tab.documentId === 'doc.pin')).toBe(true);
  });

  it('supports adjacent swipe navigation, metadata updates, and closing tabs cleanly', () => {
    syncRouteToClinicalTabs(buildOfficialDocumentHash('doc.1'), { title: 'Doc 1', now: 10 });
    const state = syncRouteToClinicalTabs(buildOfficialDocumentHash('doc.2'), {
      title: 'Doc 2',
      now: 20,
    });
    expect(adjacentClinicalTab(state, -1)?.documentId).toBe('doc.1');
    expect(adjacentClinicalTab(state, 1)?.kind).toBe('search');

    const updated = updateClinicalTabMeta('official', 'doc.1', {
      title: 'Рисперидон',
      anchor: 'dosage',
      anchorOffset: 42,
    });
    expect(updated.tabs.find((tab) => tab.documentId === 'doc.1')).toMatchObject({
      title: 'Рисперидон',
      anchor: 'dosage',
      anchorOffset: 42,
    });

    activateClinicalTab(tabIdForDocument('official', 'doc.1'), 30);
    const closed = closeClinicalTab(tabIdForDocument('official', 'doc.1'), 40);
    expect(closed.state.tabs.some((tab) => tab.documentId === 'doc.1')).toBe(false);
    expect(closed.nextActive.documentId).toBe('doc.2');

    const onlyPinnedAndActive = closeOtherClinicalTabs(tabIdForDocument('official', 'doc.2'), 50);
    expect(onlyPinnedAndActive.tabs).toHaveLength(2);
  });

  it('tracks concrete diaries, patients, calculators, and assessments as tabs while skipping hub/list routes and settings', () => {
    syncRouteToClinicalTabs('#/modules', { now: 5 });
    syncRouteToClinicalTabs('#/notes', { now: 6 });
    syncRouteToClinicalTabs('#/notes/diaries', { now: 7 });
    syncRouteToClinicalTabs('#/calculators', { now: 8 });
    expect(loadClinicalTabsState().tabs).toHaveLength(1);

    syncRouteToClinicalTabs('#/notes/diaries/d-1', { title: 'Дневник Иванова', now: 10 });
    syncRouteToClinicalTabs('#/notes/patients/p-1', { title: 'Иванов И.И.', now: 15 });
    syncRouteToClinicalTabs('#/calculators/ckd-epi', { title: 'СКФ (CKD-EPI)', now: 20 });
    syncRouteToClinicalTabs('#/assessments/clinical/phq-9', { title: 'PHQ-9', now: 30 });
    const afterSettings = syncRouteToClinicalTabs('#/settings/appearance', { now: 40 });
    expect(afterSettings.tabs.map((tab) => tab.kind)).toEqual([
      'search',
      'diary',
      'patients',
      'calculator',
      'assessment',
    ]);
    expect(afterSettings.activeTabId).toBe('tab:assessment:clinical/phq-9');
  });
});
