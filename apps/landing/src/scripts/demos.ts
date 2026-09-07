import { calculateDemo, calculator, matchesDemoQuery, questionnaire, scoreDemo } from './demoMath';

const query = document.querySelector<HTMLInputElement>('[data-demo-query]');
const records = document.querySelectorAll<HTMLElement>('[data-demo-record]');
const empty = document.querySelector<HTMLElement>('[data-demo-empty]');
const updateSearch = () => {
  let found = false;
  for (const record of records) {
    record.hidden = !matchesDemoQuery(record.dataset.demoRecord ?? '', query?.value ?? '');
    found ||= !record.hidden;
  }
  if (empty) empty.hidden = found;
};
query?.addEventListener('input', updateSearch);
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-demo-query-value]')) {
  button.addEventListener('click', () => {
    if (query) query.value = button.dataset.demoQueryValue ?? '';
    updateSearch();
  });
}

const fields = document.querySelectorAll<HTMLInputElement>('[data-demo-calculator-input]');
const calculation = document.querySelector<HTMLOutputElement>('[data-demo-calculator-result]');
const stepOutputs = document.querySelectorAll<HTMLOutputElement>('[data-demo-calculator-step]');
const updateCalculation = () => {
  const values = Object.fromEntries(
    Array.from(fields, (field) => [field.dataset.demoCalculatorInput ?? '', field.valueAsNumber]),
  );
  const results = calculateDemo(values);
  for (const [index, step] of calculator.steps.entries()) {
    const value = results?.[index];
    const formatted =
      value === undefined
        ? '—'
        : value.toLocaleString('ru', { maximumFractionDigits: step.displayPrecision });
    const output = stepOutputs[index];
    if (output) output.textContent = formatted;
    if (calculation && step.isOutput)
      calculation.textContent = results ? `${formatted} ${step.unit}` : 'Проверьте рост и массу';
  }
};
for (const field of fields) field.addEventListener('input', updateCalculation);
updateCalculation();

for (const button of document.querySelectorAll<HTMLButtonElement>('[data-demo-open]')) {
  button.addEventListener('click', () => {
    const dialog = document.getElementById(button.dataset.demoOpen ?? '');
    if (dialog instanceof HTMLDialogElement) dialog.showModal();
  });
}

const slice = document.querySelector<HTMLInputElement>('[data-demo-slice]');
const sliceLabel = document.querySelector<HTMLOutputElement>('[data-demo-slice-label]');
const image = document.querySelector<HTMLImageElement>('[data-demo-image]');
const modalities = document.querySelectorAll<HTMLButtonElement>('[data-demo-modality]');
let modality: 'mri' | 'ct' = 'mri';
const updateImage = () => {
  if (!image || !slice || !sliceLabel) return;
  const index = Math.max(1, Math.min(5, Math.round(slice.valueAsNumber)));
  if (!Number.isFinite(index)) return;
  image.src = `./examples/${modality}-${index}.png`;
  image.alt = `Демонстрационный срез ${modality === 'mri' ? 'МРТ головы' : 'КТ грудной клетки'}, ${index} из 5`;
  sliceLabel.textContent = `${index} / 5`;
};
slice?.addEventListener('input', updateImage);
for (const button of modalities) {
  button.addEventListener('click', () => {
    modality = button.dataset.demoModality === 'ct' ? 'ct' : 'mri';
    for (const control of modalities) {
      const selected = control === button;
      control.setAttribute('aria-pressed', String(selected));
      control.classList.toggle('demo__chip--selected', selected);
    }
    updateImage();
  });
}

const survey = document.querySelector<HTMLFormElement>('[data-demo-survey]');
const questions = document.querySelectorAll<HTMLFieldSetElement>('[data-demo-question]');
const previous = document.querySelector<HTMLButtonElement>('[data-demo-survey-back]');
const next = document.querySelector<HTMLButtonElement>('[data-demo-survey-next]');
const progress = document.querySelector<HTMLElement>('[data-demo-survey-progress]');
const completion = document.querySelector<HTMLElement>('[data-demo-survey-complete]');
let questionIndex = 0;
let complete = false;
const updateSurvey = () => {
  for (const [index, question] of questions.entries()) question.hidden = index !== questionIndex;
  const answered = Boolean(questions[questionIndex]?.querySelector('input:checked'));
  if (previous) previous.disabled = questionIndex === 0;
  if (next) {
    next.disabled = !answered || complete;
    next.textContent = questionIndex === questions.length - 1 ? 'Готово' : 'Далее';
  }
  if (progress) progress.textContent = `Вопрос ${questionIndex + 1} из ${questions.length}`;
  if (completion) {
    const answers: Record<string, number> = {};
    for (const question of questionnaire.questions) {
      const selected = survey?.elements.namedItem(question.id);
      if (selected instanceof RadioNodeList && selected.value !== '')
        answers[question.id] = Number(selected.value);
    }
    const result = complete ? scoreDemo(answers) : null;
    completion.hidden = !result;
    const headline = document.querySelector<HTMLElement>('[data-demo-survey-headline]');
    const message = document.querySelector<HTMLElement>('[data-demo-survey-message]');
    if (headline) headline.textContent = result?.headline ?? '';
    if (message) message.textContent = result?.message ?? '';
  }
};
survey?.addEventListener('submit', (event) => event.preventDefault());
survey?.addEventListener('change', () => {
  complete = false;
  updateSurvey();
});
previous?.addEventListener('click', () => {
  questionIndex = Math.max(0, questionIndex - 1);
  complete = false;
  updateSurvey();
  questions[questionIndex]?.focus({ preventScroll: true });
});
next?.addEventListener('click', () => {
  if (!questions[questionIndex]?.querySelector('input:checked')) return;
  if (questionIndex < questions.length - 1) questionIndex += 1;
  else complete = true;
  updateSurvey();
  questions[questionIndex]?.focus({ preventScroll: true });
});
