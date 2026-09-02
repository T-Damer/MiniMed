import { describe, expect, it } from 'vitest';

import {
  buildMedicalImagePrintHtml,
  type MedicalImagePrintFrame,
  medicalImagePrintOverlay,
  medicalImagePrintSlices,
} from '@/features/library/medical-image-print';

function frame(sliceLabel: string): MedicalImagePrintFrame {
  return {
    dataUrl: 'data:image/png;base64,frame',
    aspectRatio: 1,
    directionLabel: 'Аксиальные срезы',
    sliceLabel,
    patient: 'Иванов И. И.',
    series: 'Грудная клетка',
    details: [
      { label: 'Пациент', value: 'Иванов И. И.' },
      { label: 'Серия', value: 'Грудная клетка' },
      { label: 'Режим', value: 'Аксиальные срезы' },
      { label: 'Срез', value: sliceLabel },
      { label: 'Файл', value: 'scan.nii' },
    ],
    annotationSvg:
      '<svg class="medical-image-print__annotation"><path class="medical-image-viewer__annotation-stroke" /></svg>',
  };
}

describe('medical image print layout', () => {
  it('selects bounded slices and keeps one-frame pages readable', () => {
    expect(medicalImagePrintSlices(0, 20, 4, 9)).toEqual([1, 5, 9]);
    expect(medicalImagePrintSlices(8, 1, 3, 8)).toEqual([8, 5, 2]);

    const html = buildMedicalImagePrintHtml('МРТ грудной клетки', [frame('Срез 4 из 9')], {
      imagesPerPage: 1,
      includeAnnotations: true,
    });

    expect(html).toContain('medical-image-print__page--single');
    expect(html).toContain('grid-template-rows: minmax(0, 1fr)');
    expect(html).toContain('Пациент: Иванов И. И.');
    expect(html).toContain('Серия: Грудная клетка');
    expect(html.match(/Пациент:/g)).toHaveLength(1);
    expect(html.match(/Серия:/g)).toHaveLength(1);
    expect(html).not.toContain('medical-image-print__detail-label">Пациент');
    expect(html).not.toContain('medical-image-print__detail-label">Серия');
    expect(html).not.toContain('medical-image-print__detail-label">Режим');
    expect(html).not.toContain('medical-image-print__detail-label">Срез');
    expect(html).toContain('AX · 4/9');
    expect(html).toContain('medical-image-print__annotation');
    expect(html).toContain('Срез 4 из 9');
    expect(html).not.toContain('text-shadow');
    expect(medicalImagePrintOverlay(frame('Срез 4 из 9'))).toEqual({
      top: 'Пациент: Иванов И. И. · Серия: Грудная клетка',
      bottom: 'AX · 4/9',
    });
  });
});
