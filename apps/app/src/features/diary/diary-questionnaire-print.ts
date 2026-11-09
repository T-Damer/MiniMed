/**
 * A diary questionnaire on paper (CBT1: every diary and test prints, blank and filled). The
 * patient prints a blank or their own answers without a score (owner 2026-10-28: the patient sees
 * no score); the doctor prints the answers with the result.
 */

export interface DiaryQuestionnairePrint {
  readonly title: string;
  /** The question with its choices; `answer` is the chosen wording when filled. */
  readonly questions: readonly {
    readonly prompt: string;
    readonly options: readonly string[];
    readonly answer?: string | undefined;
  }[];
  /** When it was answered (ISO); absent on a blank. */
  readonly at?: string | undefined;
  /** «10 из 27 · Умеренная»: the doctor's copy only. */
  readonly result?: string | undefined;
  readonly patient?: string | undefined;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

export function diaryQuestionnairePrintHtml(input: DiaryQuestionnairePrint): string {
  const filled = input.questions.some((question) => question.answer !== undefined);
  const date = input.at ? new Date(input.at).toLocaleDateString('ru-RU') : '____________';
  const items = input.questions
    .map((question, index) => {
      const options = question.options
        .map((option) => {
          const on = question.answer === option;
          return `<li class="option${on ? ' option--on' : ''}"><span class="box">${on ? '✕' : ''}</span>${escapeHtml(option)}</li>`;
        })
        .join('');
      const answerOnly =
        question.options.length === 0 && question.answer !== undefined
          ? `<p class="answer">${escapeHtml(question.answer)}</p>`
          : '';
      return `<li class="question"><p class="prompt">${index + 1}. ${escapeHtml(question.prompt)}</p>${
        options ? `<ul class="options">${options}</ul>` : answerOnly
      }</li>`;
    })
    .join('');
  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(input.title)}</title>
  <style>
    @page { size: A4 portrait; margin: 14mm; }
    body { margin: 0; font-family: system-ui, -apple-system, sans-serif; color: #17201c; font-size: 10.5pt; line-height: 1.4; }
    h1 { margin: 0 0 1mm; font-size: 15pt; }
    .meta { margin: 0 0 4mm; color: #405b4e; }
    .result { margin: 0 0 4mm; font-weight: 700; }
    ol.questions { margin: 0; padding: 0; list-style: none; }
    .question { margin: 0 0 3mm; break-inside: avoid; }
    .prompt { margin: 0 0 1mm; font-weight: 600; }
    .options { display: flex; flex-wrap: wrap; gap: 1mm 5mm; margin: 0; padding: 0; list-style: none; }
    .option { display: flex; align-items: center; gap: 1.5mm; }
    .option--on { font-weight: 700; }
    .box { display: inline-grid; width: 3.6mm; height: 3.6mm; place-items: center; border: 0.3mm solid #405b4e; font-size: 8pt; }
    .answer { margin: 0; }
  </style>
</head>
<body>
  <h1>${escapeHtml(input.title)}</h1>
  <p class="meta">${input.patient ? `${escapeHtml(input.patient)} · ` : ''}Дата: ${date}</p>
  ${filled && input.result ? `<p class="result">${escapeHtml(input.result)}</p>` : ''}
  <ol class="questions">${items}</ol>
</body>
</html>`;
}
