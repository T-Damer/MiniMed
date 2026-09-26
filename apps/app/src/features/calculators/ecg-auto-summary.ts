import type { EcgDigitizationResult } from './ecg-model-contract';
import type { EcgEditorCalibration } from './ecgEditor';

export type EcgAutoSummaryStatus = 'found' | 'review' | 'missing';

export interface EcgAutoSummaryItem {
  readonly id: 'grid' | 'speed' | 'leads' | 'rhythm' | 'photo';
  readonly status: EcgAutoSummaryStatus;
  readonly title: string;
  readonly detail: string;
}

const MIN_LEAD_COVERAGE = 0.7;

/** What automatic markup found, phrased as review targets: nothing here is a confirmed value. */
export function summarizeEcgAutoMarkup(
  result: EcgDigitizationResult,
  calibration: Pick<EcgEditorCalibration, 'horizontal' | 'vertical'>,
): readonly EcgAutoSummaryItem[] {
  const axes = Number(Boolean(calibration.horizontal)) + Number(Boolean(calibration.vertical));
  const leads = result.leads.filter((lead) => lead.coverage >= MIN_LEAD_COVERAGE).length;
  const blocking = result.qualityIssues.filter((issue) => issue.severity === 'blocking');
  const warnings = result.qualityIssues.filter((issue) => issue.severity === 'warning');
  const layout = result.layout === '12x1' ? '12 строк' : '3 × 4 с ритм-строкой';
  return [
    {
      id: 'grid',
      status: axes === 2 ? 'found' : axes === 1 ? 'review' : 'missing',
      title: 'Сетка',
      detail:
        axes === 2
          ? 'Шаг найден по обеим осям. Сверьте линии с большими клетками.'
          : axes === 1
            ? 'Найдена одна ось. Вторую отметьте вручную.'
            : 'Шаг сетки не найден. Отметьте 25 мм и 10 мм вручную.',
    },
    {
      id: 'speed',
      status: 'review',
      title: 'Скорость и усиление',
      detail: 'По снимку не определяются. Выберите их по надписи на ленте.',
    },
    {
      id: 'leads',
      status:
        result.quality === 'failed' || leads === 0 ? 'missing' : leads === 12 ? 'found' : 'review',
      title: 'Отведения',
      detail:
        result.quality === 'failed' || leads === 0
          ? 'Кривые не выделены. Расставьте рамки вручную.'
          : `Раскладка ${layout}: выделено ${leads} из 12 отведений.`,
    },
    {
      id: 'rhythm',
      status: result.heartRate === undefined ? 'missing' : 'review',
      title: 'Ритм',
      detail:
        result.heartRate === undefined
          ? 'ЧСС не определена. Отметьте вершины R вручную.'
          : // The digitizer times the grid at 50 mm/s; the same distance at 25 mm/s is twice as long.
            `Черновик по отведению II: около ${result.heartRate} в минуту, если запись на 50 мм/с, и около ${Math.round(result.heartRate / 2)} — если на 25 мм/с.`,
    },
    {
      id: 'photo',
      status: blocking.length ? 'missing' : warnings.length ? 'review' : 'found',
      title: 'Качество снимка',
      detail:
        blocking.length || warnings.length
          ? [...blocking, ...warnings].map((issue) => issue.title).join('; ')
          : 'Размытия, бликов и обрезки не найдено.',
    },
  ];
}
