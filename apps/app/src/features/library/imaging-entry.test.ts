import { describe, expect, it } from 'vitest';
import type { UserLibraryDocument } from '@/state/user-library';
import { findExampleStudy, imagingFileProblem, selectImagingStudies } from './imaging-entry';

function doc(overrides: Partial<UserLibraryDocument>): UserLibraryDocument {
  return {
    id: 'a',
    title: 'a',
    fileName: 'a.pdf',
    mimeType: 'application/pdf',
    byteLength: 1,
    pageCount: 1,
    nativeTextPages: 0,
    ocrDonePages: 0,
    ocrNeededPages: 0,
    status: 'ready',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('imaging entry', () => {
  it('keeps only DICOM and NIfTI studies, most recently opened first', () => {
    const studies = selectImagingStudies([
      doc({ id: 'pdf' }),
      doc({ id: 'ct', fileName: 'ct.dcm', mimeType: 'application/dicom' }),
      doc({
        id: 'mri',
        fileName: 'mri.nii',
        mimeType: 'application/x-nifti',
        lastOpenedAt: '2026-05-01T00:00:00.000Z',
      }),
    ]);
    expect(studies.map((study) => study.id)).toEqual(['mri', 'ct']);
  });

  it('finds the example by slot or file name', () => {
    const docs = [doc({ id: 'x', fileName: 'Пример МРТ.nii' }), doc({ id: 'y', exampleId: 'ct' })];
    expect(findExampleStudy(docs, 'mri', 'Пример МРТ.nii')?.id).toBe('x');
    expect(findExampleStudy(docs, 'ct', 'Пример КТ.dcm')?.id).toBe('y');
    expect(findExampleStudy([], 'mri', 'Пример МРТ.nii')).toBeUndefined();
  });

  it('accepts DICOM and NIfTI files and explains why other files are refused', () => {
    expect(imagingFileProblem({ name: 'head.nii.gz', type: '' })).toBeUndefined();
    expect(imagingFileProblem({ name: 'slice.dcm', type: 'application/dicom' })).toBeUndefined();
    expect(imagingFileProblem({ name: 'notes.pdf', type: 'application/pdf' })).toContain('DICOM');
  });
});
