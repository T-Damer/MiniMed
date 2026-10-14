import { describe, expect, it } from 'vitest';

import { FIXTURE_CATALOG, FIXTURE_MANIFEST } from './section-fixtures';
import { buildSections } from './section-model';
import { sectionRemovalPlan } from './section-removal';

const sections = buildSections(
  FIXTURE_CATALOG,
  FIXTURE_MANIFEST,
  (module) => module.releaseState === 'published',
);
const psychiatry = sections.find((section) => section.id.includes('psychiatry'));
const cardiology = sections.find((section) => section.id.includes('cardiology'));
if (!psychiatry || !cardiology) throw new Error('fixture sections missing');

const everything = () => true;

describe('sectionRemovalPlan', () => {
  it('removes the recommendations and keeps a drug group another downloaded section names', () => {
    // Psychiatry and cardiology both name the nervous-system group; both are fully downloaded.
    const plan = sectionRemovalPlan(psychiatry, sections, everything);
    const ids = plan.modules.map((module) => module.id);
    expect(ids).toEqual(expect.arrayContaining(['kr.1', 'kr.2']));
    expect(ids).not.toContain('minimed.medications.nervous-system.ru');
    expect(ids).not.toContain('minimed.medications.instructions.nervous-system.ru');
    expect(plan.keptShared).toBe(2);
    expect(plan.bytes).toBeGreaterThan(0);
  });

  it('removes a shared drug group once no other downloaded section needs it', () => {
    // Cardiology has nothing installed any more: its groups are not a reason to keep anything.
    const plan = sectionRemovalPlan(psychiatry, sections, (module) => module.id !== 'kr.3');
    expect(plan.modules.map((module) => module.id)).toContain(
      'minimed.medications.nervous-system.ru',
    );
    expect(plan.keptShared).toBe(0);
  });

  it('lists only what is installed', () => {
    const plan = sectionRemovalPlan(psychiatry, sections, (module) => module.id === 'kr.1');
    expect(plan.modules.map((module) => module.id)).toEqual(['kr.1']);
  });

  it('has nothing to remove for a section that is not on the device', () => {
    expect(sectionRemovalPlan(psychiatry, sections, () => false).modules).toEqual([]);
  });
});
