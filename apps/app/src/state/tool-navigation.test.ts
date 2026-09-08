import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { restoreReturnTo } from '@/state/return-navigation';
import { returnFromTool, toolWorkspace, trackToolNavigation } from './tool-navigation';

vi.mock('@/state/return-navigation', () => ({ restoreReturnTo: vi.fn(), clearReturnTo: vi.fn() }));
const origin = 'http://127.0.0.1/';
function move(from: string, to: string): void {
  trackToolNavigation(`${origin}${from}`, `${origin}${to}`);
  vi.stubGlobal('window', { location: { hash: new URL(`${origin}${to}`).hash } });
}

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal('sessionStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
  vi.mocked(restoreReturnTo).mockClear();
});
afterEach(() => vi.unstubAllGlobals());

describe('tool entry navigation', () => {
  it('returns through nested tools to the exact document URL, retaining results inside their tool', () => {
    const source = '?o=chapter#/modules/documents/d/source';
    const assessment = '#/assessments/obstetrics/postnatal-mood-epds';
    const result = `${assessment}/results/record-1`;
    const calculator = '#/calculators/unit-converter';
    move(source, assessment);
    move(assessment, result);
    move(result, calculator);
    expect(returnFromTool()).toBe(true);
    expect(restoreReturnTo).toHaveBeenLastCalledWith({ hash: result, search: '' });
    move(calculator, result);
    move(result, assessment);
    expect(returnFromTool()).toBe(true);
    expect(restoreReturnTo).toHaveBeenLastCalledWith({
      hash: '#/modules/documents/d/source',
      search: '?o=chapter',
    });
  });

  it('returns to the actual catalog entry and drops a trail abandoned through navigation', () => {
    move('#/calculators/section/obstetrics', '#/calculators/obstetric-pregnancy-dates');
    expect(returnFromTool()).toBe(true);
    expect(restoreReturnTo).toHaveBeenLastCalledWith({
      hash: '#/calculators/section/obstetrics',
      search: '',
    });
    move('#/calculators/obstetric-pregnancy-dates', '#/settings');
    move('#/settings', '#/calculators/unit-converter');
    expect(returnFromTool()).toBe(true);
    expect(restoreReturnTo).toHaveBeenLastCalledWith({ hash: '#/settings', search: '' });
  });

  it('keeps the original page across the questionnaire creation redirect', () => {
    move('#/search', '#/assessments/mine/new');
    move('#/assessments/mine/new', '#/assessments/mine/file-1/edit');
    expect(returnFromTool()).toBe(true);
    expect(restoreReturnTo).toHaveBeenLastCalledWith({ hash: '#/search', search: '' });
  });

  it('does not invent origins for deep links or malformed/external events', () => {
    vi.stubGlobal('window', { location: { hash: '#/calculators/unit-converter' } });
    trackToolNavigation('', 'bad URL');
    trackToolNavigation('https://example.org/#/search', `${origin}#/calculators/unit-converter`);
    expect(returnFromTool()).toBe(false);
    expect(toolWorkspace('#/calculators/section/obstetrics')).toBeUndefined();
    expect(toolWorkspace('#/assessments/obstetrics')).toBeUndefined();
    expect(toolWorkspace('#/assessments/mine/file-1/edit')).toBe('assessments/mine/file-1');
  });
});
