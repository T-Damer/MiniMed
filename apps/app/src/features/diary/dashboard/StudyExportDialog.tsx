/**
 * «Выгрузка для исследования» (RESEARCH1): every diary of the doctor in one workbook under study
 * codes (`diary-cohort-export.ts`), only the patients who agreed to the plan's study.
 */
import { createSignal, type JSX } from 'solid-js';
import { toast } from 'solid-sonner';

import { ConfirmationDialog } from '@/components/ConfirmationDialog';
import { TextField } from '@/components/TextField';
import { pluralize } from '@/diary/diary-format';
import { replicaResults } from '@/features/diary/connected/diary-replica';
import type { DoctorPatient } from '@/features/diary/connected/doctor-workspace';
import { sortedVisitEntries } from '@/features/diary/diary-visit-scales';
import { type CohortDiary, cohortSheets, cohortXlsx, studyDiaries } from './diary-cohort-export';
import { questionnaireSeries } from './diary-insights';
import { visitScaleSeries } from './visit-scale-series';

const STUDY_KEY = 'minimed.diary.study-name';

function savedStudy(): string {
  try {
    return localStorage.getItem(STUDY_KEY) ?? '';
  } catch {
    return '';
  }
}

export function StudyExportDialog(props: {
  readonly open: boolean;
  readonly patients: readonly DoctorPatient[];
  readonly onOpenChange: (open: boolean) => void;
}): JSX.Element {
  const [study, setStudy] = createSignal(savedStudy());
  const count = () => studyDiaries(props.patients).length;

  const run = async (): Promise<void> => {
    const name = study().trim() || 'Исследование';
    try {
      localStorage.setItem(STUDY_KEY, name);
    } catch {
      // Private mode: the name is asked again next time.
    }
    const diaries: CohortDiary[] = [];
    for (const patient of studyDiaries(props.patients)) {
      const results = replicaResults(patient.replica);
      if (!results) continue;
      diaries.push({
        id: patient.summary.id,
        results,
        planHistory: patient.replica.planHistory,
        quizzes: [
          ...(await questionnaireSeries(results.invitation, results.entries)),
          ...(await visitScaleSeries(sortedVisitEntries(patient.replica.visitScales))),
        ],
      });
    }
    const blob = await cohortXlsx(await cohortSheets(name, diaries));
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `исследование-${name}.xlsx`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  return (
    <ConfirmationDialog
      open={props.open}
      title="Выгрузка для исследования"
      icon="file-xls"
      confirmLabel="Скачать таблицу"
      description={
        <>
          <p>
            {count()} {pluralize(count(), 'участник', 'участника', 'участников')} в одной таблице:
            назначения с кодами АТХ и мишенями, приём по дням, измерения, опросники и оценки врача.
            Вместо имён — коды, вместо дат — дни наблюдения, комментарии и свободный текст не
            попадают.
          </p>
          <p>Берутся только дневники, где пациент дал согласие на исследование и не отозвал его.</p>
          <TextField
            label="Название исследования"
            placeholder="например, Полипрагмазия-2027"
            value={study()}
            onInput={(event) => setStudy(event.currentTarget.value)}
          />
          <p>Коды зависят от названия: при том же названии у пациента тот же код.</p>
        </>
      }
      onConfirm={() => {
        props.onOpenChange(false);
        void run().catch(() => toast.error('Не удалось собрать таблицу.'));
      }}
      onOpenChange={props.onOpenChange}
    />
  );
}
