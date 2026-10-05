import type { ToolAgeScope } from '@localmed/contracts';
import { anyAgeScope } from '@localmed/contracts';
import type {
  AssessmentDefinition,
  AssessmentImage,
} from '@/features/assessments/assessment-types';
import {
  parseUserToolPopulation,
  type UserToolPopulation,
  userToolPopulationToAgeScope,
} from '@/features/tools/user-tool-population';
import {
  addUserLibraryFile,
  getUserLibraryDocument,
  getUserLibraryFile,
  isUserLibraryQuestionnaire,
  listUserLibraryDocuments,
  listUserLibraryFolders,
  normalizeUserLibraryName,
  removeUserLibraryDocument,
  replaceUserLibraryFile,
  USER_LIBRARY_QUESTIONNAIRE_MIME_TYPE,
  USER_LIBRARY_QUESTIONNAIRES_FOLDER_ID,
  type UserLibraryDocument,
  userLibraryQuestionnaireFileName,
} from '@/state/user-library';
import {
  orderedQuestions,
  questionnaireIsScored,
  questionnaireScoresBySection,
  questionnaireSectionLabel,
} from '@/state/user-questionnaire-rules';

export const USER_QUESTIONNAIRE_FORMAT = 'minimed-questionnaire';
const DEFAULT_DISCLAIMER = 'Локальный авторский опросник. Его результат не является диагнозом.';
/** Written files are version 2; version 1 files (no sections, bands or population) still open. */
export const USER_QUESTIONNAIRE_VERSION = 2;

export const MAX_USER_QUESTIONS = 120;
export const MAX_USER_SECTIONS = 20;
export const MAX_USER_BANDS_PER_SCOPE = 12;
const MAX_OPTIONS_PER_QUESTION = 12;
const MAX_IMAGES = 24;
const MAX_IMAGE_DATA_URL_LENGTH = 7 * 1024 * 1024;
const MAX_TOTAL_IMAGE_DATA_URL_LENGTH = 24 * 1024 * 1024;
const MAX_TEXT_LENGTH = 20_000;
const MAX_IMAGE_FILE_BYTES = 5 * 1024 * 1024;
const SAMPLE_SEEDED_KEY = 'minimed.userQuestionnaires.sampleSeeded.v1';
const IMAGE_DATA_URL = /^data:image\/(?:gif|jpeg|png|webp);base64,[a-z0-9+/]+={0,2}$/iu;

export interface UserQuestionnaireImage {
  readonly id: string;
  readonly name: string;
  readonly dataUrl: string;
}

export interface UserQuestionnaireOption {
  readonly id: string;
  readonly label: string;
  readonly weight?: number;
}

export interface UserQuestionnaireQuestion {
  readonly id: string;
  readonly prompt: string;
  readonly text: string;
  readonly images: readonly UserQuestionnaireImage[];
  readonly options: readonly UserQuestionnaireOption[];
  /** The section the question sits in; absent for a question outside every section. */
  readonly sectionId?: string;
}

/** A titled group of questions, shown as a heading and optionally scored on its own. */
export interface UserQuestionnaireSection {
  readonly id: string;
  readonly title: string;
  readonly description: string;
}

/**
 * One interpretation range: a score from `min` to `max` (both included) gets this headline and
 * explanation. `scope` is `total` or the id of a section when scores are kept per section.
 */
export interface UserQuestionnaireBand {
  readonly id: string;
  readonly scope: string;
  readonly min: number;
  readonly max: number;
  readonly headline: string;
  readonly message: string;
}

export interface UserQuestionnaireReference {
  readonly notice: string;
  readonly sourceUrl?: string;
}

export interface UserQuestionnaire {
  readonly format: typeof USER_QUESTIONNAIRE_FORMAT;
  readonly version: typeof USER_QUESTIONNAIRE_VERSION;
  readonly title: string;
  readonly description: string;
  readonly disclaimer: string;
  readonly images: readonly UserQuestionnaireImage[];
  /** Whom the questionnaire is for; unset until the author chooses, and it cannot run without it. */
  readonly population?: UserToolPopulation;
  readonly sections: readonly UserQuestionnaireSection[];
  readonly questions: readonly UserQuestionnaireQuestion[];
  /** Add scores up per section instead of one total. */
  readonly scoreBySection: boolean;
  readonly bands: readonly UserQuestionnaireBand[];
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly sample?: 'whooley';
  readonly reference?: UserQuestionnaireReference;
}

export interface StoredUserQuestionnaire {
  readonly file: UserLibraryDocument;
  readonly questionnaire: UserQuestionnaire;
}

interface UntrustedQuestionnaireRecord {
  readonly createdAt?: unknown;
  readonly dataUrl?: unknown;
  readonly description?: unknown;
  readonly disclaimer?: unknown;
  readonly format?: unknown;
  readonly id?: unknown;
  readonly images?: unknown;
  readonly bands?: unknown;
  readonly headline?: unknown;
  readonly max?: unknown;
  readonly message?: unknown;
  readonly min?: unknown;
  readonly population?: unknown;
  readonly scope?: unknown;
  readonly scoreBySection?: unknown;
  readonly sectionId?: unknown;
  readonly sections?: unknown;
  readonly label?: unknown;
  readonly name?: unknown;
  readonly notice?: unknown;
  readonly options?: unknown;
  readonly prompt?: unknown;
  readonly questions?: unknown;
  readonly reference?: unknown;
  readonly sample?: unknown;
  readonly sourceUrl?: unknown;
  readonly text?: unknown;
  readonly title?: unknown;
  readonly updatedAt?: unknown;
  readonly version?: unknown;
  readonly weight?: unknown;
}

function createId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

function isRecord(value: unknown): value is UntrustedQuestionnaireRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function boundedText(value: unknown, label: string, allowEmpty = true): string {
  if (typeof value !== 'string') throw new Error(`${label}: нужен текст.`);
  const text = value.trim();
  if (!allowEmpty && !text) throw new Error(`${label}: заполните это поле.`);
  if ([...text].length > MAX_TEXT_LENGTH) throw new Error(`${label}: текст слишком длинный.`);
  return text;
}

function boundedId(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value || value.length > 128) {
    throw new Error(`Некорректный идентификатор: ${label}.`);
  }
  return value;
}

function parseImage(value: unknown): UserQuestionnaireImage {
  if (!isRecord(value)) throw new Error('Некорректное изображение опросника.');
  const dataUrl = boundedText(value.dataUrl, 'Данные изображения', false);
  if (dataUrl.length > MAX_IMAGE_DATA_URL_LENGTH || !IMAGE_DATA_URL.test(dataUrl)) {
    throw new Error('Изображение должно быть PNG, JPEG, GIF или WebP и не превышать 5 МБ.');
  }
  return {
    id: boundedId(value.id, 'изображение'),
    name: boundedText(value.name, 'Название изображения', false),
    dataUrl,
  };
}

function parseImages(value: unknown): readonly UserQuestionnaireImage[] {
  if (!Array.isArray(value) || value.length > MAX_IMAGES) {
    throw new Error(`Можно добавить не более ${MAX_IMAGES} изображений.`);
  }
  const images = value.map(parseImage);
  const ids = new Set(images.map((image) => image.id));
  if (ids.size !== images.length) throw new Error('Изображения не должны повторяться.');
  if (
    images.reduce((total, image) => total + image.dataUrl.length, 0) >
    MAX_TOTAL_IMAGE_DATA_URL_LENGTH
  ) {
    throw new Error('Суммарный размер изображений превышает 24 МБ.');
  }
  return images;
}

function parseOption(value: unknown): UserQuestionnaireOption {
  if (!isRecord(value)) throw new Error('Некорректный вариант ответа.');
  const weight = value.weight;
  if (
    weight !== undefined &&
    (typeof weight !== 'number' || !Number.isFinite(weight) || weight < -1000 || weight > 1000)
  ) {
    throw new Error('Баллы за ответ должны быть числом от −1000 до 1000.');
  }
  return {
    id: boundedId(value.id, 'вариант ответа'),
    label: boundedText(value.label ?? '', 'Вариант ответа'),
    ...(weight === undefined ? {} : { weight }),
  };
}

function parseQuestion(value: unknown): UserQuestionnaireQuestion {
  if (!isRecord(value)) throw new Error('Некорректный вопрос опросника.');
  if (!Array.isArray(value.options) || value.options.length > MAX_OPTIONS_PER_QUESTION) {
    throw new Error(`В вопросе может быть не более ${MAX_OPTIONS_PER_QUESTION} вариантов ответа.`);
  }
  const options = value.options.map(parseOption);
  const optionIds = new Set(options.map((option) => option.id));
  if (optionIds.size !== options.length) throw new Error('Варианты ответа не должны повторяться.');
  const sectionId = value.sectionId;
  return {
    id: boundedId(value.id, 'вопрос'),
    prompt: boundedText(value.prompt, 'Вопрос'),
    text: boundedText(value.text ?? '', 'Текст вопроса'),
    images: parseImages(value.images ?? []),
    options,
    ...(sectionId === undefined ? {} : { sectionId: boundedId(sectionId, 'раздел вопроса') }),
  };
}

function parseSection(value: unknown): UserQuestionnaireSection {
  if (!isRecord(value)) throw new Error('Некорректный раздел опросника.');
  return {
    id: boundedId(value.id, 'раздел'),
    title: boundedText(value.title ?? '', 'Название раздела'),
    description: boundedText(value.description ?? '', 'Описание раздела'),
  };
}

function boundedScore(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 100_000) {
    throw new Error(`${label}: нужно число от −100 000 до 100 000.`);
  }
  return value;
}

function parseBand(value: unknown): UserQuestionnaireBand {
  if (!isRecord(value)) throw new Error('Некорректный диапазон результата.');
  return {
    id: boundedId(value.id, 'диапазон'),
    scope: boundedId(value.scope, 'область диапазона'),
    min: boundedScore(value.min, 'Диапазон «от»'),
    max: boundedScore(value.max, 'Диапазон «до»'),
    headline: boundedText(value.headline ?? '', 'Название результата'),
    message: boundedText(value.message ?? '', 'Пояснение результата'),
  };
}

function parseReference(value: unknown): UserQuestionnaireReference | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw new Error('Некорректный источник опросника.');
  const notice = boundedText(value.notice, 'Источник', false);
  const sourceUrl = value.sourceUrl;
  if (
    sourceUrl !== undefined &&
    (typeof sourceUrl !== 'string' || !/^https:\/\//u.test(sourceUrl))
  ) {
    throw new Error('Ссылка на источник должна начинаться с https://.');
  }
  return { notice, ...(sourceUrl ? { sourceUrl } : {}) };
}

export function parseUserQuestionnaire(value: unknown): UserQuestionnaire {
  if (!isRecord(value)) throw new Error('Файл опросника содержит некорректные данные.');
  // Version 1 files have no sections, bands or population: they are the same file without them.
  if (
    value.format !== USER_QUESTIONNAIRE_FORMAT ||
    (value.version !== USER_QUESTIONNAIRE_VERSION && value.version !== 1)
  ) {
    throw new Error('Этот файл опросника не поддерживается.');
  }
  const questionsValue = value.questions;
  if (!Array.isArray(questionsValue) || questionsValue.length > MAX_USER_QUESTIONS) {
    throw new Error(`В опроснике может быть не более ${MAX_USER_QUESTIONS} вопросов.`);
  }
  const questions = questionsValue.map(parseQuestion);
  const questionIds = new Set(questions.map((question) => question.id));
  if (questionIds.size !== questions.length) throw new Error('Вопросы не должны повторяться.');
  const sectionsValue = value.sections ?? [];
  if (!Array.isArray(sectionsValue) || sectionsValue.length > MAX_USER_SECTIONS) {
    throw new Error(`В опроснике может быть не более ${MAX_USER_SECTIONS} разделов.`);
  }
  const sections = sectionsValue.map(parseSection);
  const sectionIds = new Set(sections.map((section) => section.id));
  if (sectionIds.size !== sections.length) throw new Error('Разделы не должны повторяться.');
  if (questions.some((question) => question.sectionId && !sectionIds.has(question.sectionId))) {
    throw new Error('Вопрос ссылается на раздел, которого нет в файле.');
  }
  const bandsValue = value.bands ?? [];
  if (
    !Array.isArray(bandsValue) ||
    bandsValue.length > MAX_USER_BANDS_PER_SCOPE * (MAX_USER_SECTIONS + 1)
  ) {
    throw new Error('В опроснике слишком много диапазонов результата.');
  }
  const bands = bandsValue.map(parseBand);
  if (new Set(bands.map((band) => band.id)).size !== bands.length) {
    throw new Error('Диапазоны результата не должны повторяться.');
  }
  if (bands.some((band) => band.scope !== 'total' && !sectionIds.has(band.scope))) {
    throw new Error('Диапазон ссылается на раздел, которого нет в файле.');
  }
  const scoreBySection = value.scoreBySection ?? false;
  if (typeof scoreBySection !== 'boolean') throw new Error('Способ подсчёта указан неверно.');
  const title = normalizeUserLibraryName(boundedText(value.title, 'Название', false), 'file');
  const createdAt = boundedText(value.createdAt, 'Дата создания', false);
  const updatedAt = boundedText(value.updatedAt, 'Дата изменения', false);
  const sample = value.sample;
  if (sample !== undefined && sample !== 'whooley')
    throw new Error('Неизвестный пример опросника.');
  const images = parseImages(value.images ?? []);
  const totalImageDataLength = [
    ...images,
    ...questions.flatMap((question) => question.images),
  ].reduce((total, image) => total + image.dataUrl.length, 0);
  if (totalImageDataLength > MAX_TOTAL_IMAGE_DATA_URL_LENGTH) {
    throw new Error('Суммарный размер изображений превышает 24 МБ.');
  }
  const reference = parseReference(value.reference);
  const population =
    value.population === undefined ? undefined : parseUserToolPopulation(value.population);
  return {
    format: USER_QUESTIONNAIRE_FORMAT,
    version: USER_QUESTIONNAIRE_VERSION,
    title,
    description: boundedText(value.description, 'Описание'),
    disclaimer: boundedText(value.disclaimer, 'Ограничение', false),
    images,
    ...(population ? { population } : {}),
    sections,
    questions,
    scoreBySection,
    bands,
    createdAt,
    updatedAt,
    ...(sample ? { sample } : {}),
    ...(reference ? { reference } : {}),
  };
}

function withUpdatedAt(questionnaire: UserQuestionnaire): UserQuestionnaire {
  // An empty title or disclaimer while the doctor is typing must not stop the draft from saving.
  return {
    ...parseUserQuestionnaire({
      ...questionnaire,
      title: questionnaire.title.trim() || 'Новый опросник',
      disclaimer: questionnaire.disclaimer.trim() || DEFAULT_DISCLAIMER,
    }),
    updatedAt: new Date().toISOString(),
  };
}

function questionnaireFile(questionnaire: UserQuestionnaire): File {
  return new File(
    [JSON.stringify(questionnaire, null, 2)],
    userLibraryQuestionnaireFileName(questionnaire.title),
    { type: USER_LIBRARY_QUESTIONNAIRE_MIME_TYPE },
  );
}

export function createUserQuestionnaireOption(
  label = 'Новый вариант',
  weight?: number,
): UserQuestionnaireOption {
  return { id: createId('option'), label, ...(weight === undefined ? {} : { weight }) };
}

export function createUserQuestionnaireQuestion(): UserQuestionnaireQuestion {
  return {
    id: createId('question'),
    prompt: 'Новый вопрос',
    text: '',
    images: [],
    options: [createUserQuestionnaireOption('Нет'), createUserQuestionnaireOption('Да')],
  };
}

export function duplicateUserQuestionnaireQuestion(
  question: UserQuestionnaireQuestion,
): UserQuestionnaireQuestion {
  return {
    ...question,
    id: createId('question'),
    images: question.images.map((image) => ({ ...image, id: createId('image') })),
    options: question.options.map((option) => ({ ...option, id: createId('option') })),
  };
}

export function createUserQuestionnaireDraft(): UserQuestionnaire {
  const now = new Date().toISOString();
  return {
    format: USER_QUESTIONNAIRE_FORMAT,
    version: USER_QUESTIONNAIRE_VERSION,
    title: 'Новый опросник',
    description: '',
    disclaimer: DEFAULT_DISCLAIMER,
    images: [],
    sections: [],
    questions: [createUserQuestionnaireQuestion()],
    scoreBySection: false,
    bands: [],
    createdAt: now,
    updatedAt: now,
  };
}

export function createUserQuestionnaireSection(title = ''): UserQuestionnaireSection {
  return { id: createId('section'), title, description: '' };
}

export function createUserQuestionnaireBand(
  scope: string,
  min = 0,
  max = 0,
): UserQuestionnaireBand {
  return { id: createId('band'), scope, min, max, headline: '', message: '' };
}

function whooleySample(): UserQuestionnaire {
  const now = new Date().toISOString();
  const option = (label: string, weight: number): UserQuestionnaireOption => ({
    id: createId('option'),
    label,
    weight,
  });
  return {
    format: USER_QUESTIONNAIRE_FORMAT,
    version: USER_QUESTIONNAIRE_VERSION,
    title: 'Скрининг настроения (вопросы Whooley)',
    description:
      'Два вопроса Whooley для быстрого первичного скрининга настроения. Опросник можно изменить под себя.',
    disclaimer:
      'Это сверхкороткий скрининг, а не диагноз. Положительный ответ — повод для более подробного разговора со специалистом.',
    images: [],
    population: { group: 'adults' },
    sections: [],
    questions: [
      {
        id: createId('question'),
        prompt:
          'За последний месяц вас часто беспокоило подавленное настроение, тоска или чувство безнадёжности?',
        text: '',
        images: [],
        options: [option('Нет', 0), option('Да', 1)],
      },
      {
        id: createId('question'),
        prompt:
          'За последний месяц вас часто беспокоило заметно сниженное чувство интереса или удовольствия от дел?',
        text: '',
        images: [],
        options: [option('Нет', 0), option('Да', 1)],
      },
    ],
    scoreBySection: false,
    bands: [
      {
        id: createId('band'),
        scope: 'total',
        min: 0,
        max: 0,
        headline: 'Отрицательный результат скрининга',
        message:
          'Отрицательные ответы на оба вопроса снижают вероятность текущего депрессивного эпизода, но не исключают его полностью.',
      },
      {
        id: createId('band'),
        scope: 'total',
        min: 1,
        max: 2,
        headline: 'Положительный результат скрининга',
        message:
          'Положительный ответ хотя бы на один вопрос — повод обсудить настроение и при необходимости пройти более подробную оценку со специалистом.',
      },
    ],
    createdAt: now,
    updatedAt: now,
    sample: 'whooley',
    reference: {
      notice:
        'Вопросы Whooley: Whooley M.A. et al. Case-finding instruments for depression: two questions as good as many. J Gen Intern Med. 1997;12(7):439–445.',
      sourceUrl: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC1497134/',
    },
  };
}

/**
 * The age scope of a local questionnaire. An author who has not chosen yet is listed under every
 * age filter (nothing is hidden by a guess), but the questionnaire cannot run until they choose.
 */
export function userQuestionnaireAgeScope(questionnaire: UserQuestionnaire): ToolAgeScope {
  return questionnaire.population
    ? userToolPopulationToAgeScope(questionnaire.population)
    : anyAgeScope('Автор ещё не указал возраст пациентов.');
}

function scaleId(sectionId: string): string {
  return `section-${sectionId}`;
}

export function userQuestionnaireToAssessmentDefinition(
  stored: StoredUserQuestionnaire,
): AssessmentDefinition {
  const questionnaire = { ...stored.questionnaire, title: stored.file.title };
  const scored = questionnaireIsScored(questionnaire);
  const bySection = questionnaireScoresBySection(questionnaire);
  const ordered = orderedQuestions(questionnaire);
  const images = (items: readonly UserQuestionnaireImage[]): readonly AssessmentImage[] =>
    items.map((image) => ({ id: image.id, alt: image.name, dataUrl: image.dataUrl }));
  const scales = !scored
    ? []
    : bySection
      ? questionnaire.sections.map((section, index) => ({
          id: scaleId(section.id),
          label: questionnaireSectionLabel(section, index),
          shortLabel: questionnaireSectionLabel(section, index),
          description: section.description || 'Сумма баллов за ответы раздела.',
        }))
      : [
          {
            id: 'total',
            label: 'Общий балл',
            shortLabel: 'Баллы',
            description: 'Сумма баллов, заданных автором за выбранные ответы.',
          },
        ];
  const interpretations = scored
    ? questionnaire.bands
        .filter(
          (band) =>
            band.min <= band.max && (bySection ? band.scope !== 'total' : band.scope === 'total'),
        )
        .map((band) => ({
          minScore: band.min,
          maxScore: band.max,
          scaleId: band.scope === 'total' ? 'total' : scaleId(band.scope),
          headline: band.headline.trim(),
          message: band.message.trim() || band.headline.trim(),
        }))
    : [];
  return {
    schemaVersion: 2,
    id: `user-questionnaire:${stored.file.id}`,
    slug: stored.file.id,
    title: questionnaire.title,
    shortTitle: questionnaire.title,
    aliases: [],
    bankId: 'mine',
    bankLabel: 'Мои опросники',
    category: 'mine',
    description: questionnaire.description || 'Локальный опросник из «Моих файлов».',
    estimatedMinutes: Math.max(1, Math.ceil(questionnaire.questions.length / 4)),
    audience: 'Локальный файл',
    ageScope: userQuestionnaireAgeScope(questionnaire),
    responseOptions: [],
    scales,
    questions: ordered.map((question) => {
      const section = questionnaire.sections.find((item) => item.id === question.sectionId);
      return {
        id: question.id,
        prompt: question.prompt,
        text: question.text,
        images: images(question.images),
        scaleId: !scored ? 'total' : bySection && section ? scaleId(section.id) : 'total',
        ...(section ? { sectionId: section.id } : {}),
        responseOptions: question.options.map((option, index) => ({
          value: scored ? (option.weight ?? index) : index,
          label: option.label,
          ...(scored ? {} : { hideValue: true as const }),
        })),
      };
    }),
    ...(questionnaire.sections.length > 0
      ? {
          sections: questionnaire.sections.map((section, index) => ({
            id: section.id,
            title: questionnaireSectionLabel(section, index),
            ...(section.description ? { description: section.description } : {}),
          })),
        }
      : {}),
    ...(scored ? {} : { scoringMode: 'responses-only' as const }),
    ...(bySection ? { interpretationMode: 'per-scale' as const } : {}),
    evaluation: {
      status: 'unavailable',
      rules: [],
      missingContext: [],
      reason: 'Локальный опросник не содержит проверенного референсного диапазона.',
      sourceIds: [],
    },
    observationMappings: [],
    disclaimer: questionnaire.disclaimer,
    evidenceNote: questionnaire.reference
      ? 'Это локальная копия; проверьте актуальность текста и интерпретации по первичному источнику.'
      : 'Авторский локальный опросник. Интерпретацию результатов задаёт его автор.',
    ...(interpretations.length > 0 ? { interpretations } : {}),
    license: questionnaire.reference
      ? { kind: 'third-party-attributed', ...questionnaire.reference }
      : { kind: 'project-original', notice: 'Локальный пользовательский опросник.' },
    intro: questionnaire.description,
    images: images(questionnaire.images),
  };
}

export async function createUserQuestionnaire(
  draft: UserQuestionnaire = createUserQuestionnaireDraft(),
): Promise<StoredUserQuestionnaire> {
  const questionnaire = withUpdatedAt(draft);
  await listUserLibraryFolders();
  const file = questionnaireFile(questionnaire);
  const document = await addUserLibraryFile(
    file,
    USER_LIBRARY_QUESTIONNAIRES_FOLDER_ID,
    undefined,
    {
      skipProcessing: true,
    },
  );
  return { file: document, questionnaire: { ...questionnaire, title: document.title } };
}

export async function loadUserQuestionnaire(fileId: string): Promise<StoredUserQuestionnaire> {
  const file = await getUserLibraryDocument(fileId);
  if (!file || !isUserLibraryQuestionnaire(file)) throw new Error('Опросник не найден.');
  const source = await getUserLibraryFile(fileId);
  if (!source) throw new Error('Файл опросника недоступен.');
  let parsed: unknown;
  try {
    parsed = JSON.parse(await source.text());
  } catch {
    throw new Error('Не удалось прочитать файл опросника.');
  }
  return { file, questionnaire: { ...parseUserQuestionnaire(parsed), title: file.title } };
}

export async function listUserQuestionnaires(): Promise<readonly StoredUserQuestionnaire[]> {
  const files = (await listUserLibraryDocuments()).filter(isUserLibraryQuestionnaire);
  const loaded = await Promise.all(
    files.map((file) => loadUserQuestionnaire(file.id).catch(() => null)),
  );
  return loaded.filter((item): item is StoredUserQuestionnaire => item !== null);
}

export async function saveUserQuestionnaire(
  fileId: string,
  draft: UserQuestionnaire,
): Promise<StoredUserQuestionnaire> {
  const questionnaire = withUpdatedAt(draft);
  const document = await replaceUserLibraryFile(fileId, questionnaireFile(questionnaire), {
    folderId: USER_LIBRARY_QUESTIONNAIRES_FOLDER_ID,
    skipProcessing: true,
  });
  if (!document) throw new Error('Опросник не найден.');
  return { file: document, questionnaire: { ...questionnaire, title: document.title } };
}

export async function exportUserQuestionnaire(fileId: string): Promise<File> {
  const stored = await loadUserQuestionnaire(fileId);
  return questionnaireFile({ ...stored.questionnaire, title: stored.file.title });
}

/**
 * Hand-written files may omit ids, dates and the disclaimer; exported files already carry them.
 * Only absent fields are filled, so the strict parser still validates everything present.
 */
export function withQuestionnaireImportDefaults(value: unknown): unknown {
  if (!isRecord(value)) return value;
  const now = new Date().toISOString();
  const withId = (item: unknown, prefix: string): unknown =>
    isRecord(item) && item.id === undefined ? { ...item, id: createId(prefix) } : item;
  return {
    ...value,
    description: value.description ?? '',
    disclaimer:
      value.disclaimer ?? 'Локальный авторский опросник. Его результат не является диагнозом.',
    createdAt: value.createdAt ?? now,
    updatedAt: value.updatedAt ?? now,
    questions: Array.isArray(value.questions)
      ? value.questions.map((question) => {
          const withQuestionId = withId(question, 'question');
          return isRecord(withQuestionId) && Array.isArray(withQuestionId.options)
            ? {
                ...withQuestionId,
                options: withQuestionId.options.map((option) => withId(option, 'option')),
              }
            : withQuestionId;
        })
      : value.questions,
  };
}

export async function importUserQuestionnaire(file: File): Promise<StoredUserQuestionnaire> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await file.text());
  } catch {
    throw new Error('Выберите файл опросника MiniMed в формате JSON.');
  }
  const source = parseUserQuestionnaire(withQuestionnaireImportDefaults(parsed));
  const now = new Date().toISOString();
  return createUserQuestionnaire({ ...source, createdAt: now, updatedAt: now });
}

/** A copy under a new name: the same questions, sections, scores and ranges, never the sample mark. */
export async function duplicateUserQuestionnaire(fileId: string): Promise<StoredUserQuestionnaire> {
  const source = await loadUserQuestionnaire(fileId);
  const { sample: _sample, ...rest } = source.questionnaire;
  const now = new Date().toISOString();
  return createUserQuestionnaire({
    ...rest,
    title: `${source.file.title} (копия)`,
    createdAt: now,
    updatedAt: now,
  });
}

export async function deleteUserQuestionnaire(fileId: string): Promise<void> {
  await removeUserLibraryDocument(fileId);
}

export async function readUserQuestionnaireImages(
  files: readonly File[],
): Promise<readonly UserQuestionnaireImage[]> {
  if (files.length === 0) return [];
  if (
    files.some(
      (file) => !['image/gif', 'image/jpeg', 'image/png', 'image/webp'].includes(file.type),
    )
  ) {
    throw new Error('Поддерживаются изображения PNG, JPEG, GIF и WebP.');
  }
  if (files.some((file) => file.size > MAX_IMAGE_FILE_BYTES)) {
    throw new Error('Размер каждого изображения не должен превышать 5 МБ.');
  }
  const images = await Promise.all(
    files.map(
      (file) =>
        new Promise<UserQuestionnaireImage>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            if (typeof reader.result !== 'string') {
              reject(new Error('Не удалось прочитать изображение.'));
              return;
            }
            try {
              resolve(
                parseImage({ id: createId('image'), name: file.name, dataUrl: reader.result }),
              );
            } catch (cause) {
              reject(cause);
            }
          };
          reader.onerror = () => reject(new Error('Не удалось прочитать изображение.'));
          reader.readAsDataURL(file);
        }),
    ),
  );
  return images;
}

let sampleSeed: Promise<void> | undefined;
let sampleSeededThisSession = false;

export function ensureUserQuestionnaireSample(): Promise<void> {
  if (sampleSeededThisSession) return Promise.resolve();
  if (sampleSeed) return sampleSeed;
  sampleSeed = (async () => {
    try {
      if (localStorage.getItem(SAMPLE_SEEDED_KEY) === '1') {
        sampleSeededThisSession = true;
        return;
      }
    } catch {
      // The sample identity check below keeps storage without localStorage from duplicating it.
    }
    if (!(await listUserQuestionnaires()).some((item) => item.questionnaire.sample === 'whooley')) {
      await createUserQuestionnaire(whooleySample());
    }
    try {
      localStorage.setItem(SAMPLE_SEEDED_KEY, '1');
    } catch {
      // The sample can still live in IndexedDB when preferences are unavailable.
    }
    sampleSeededThisSession = true;
  })().finally(() => {
    sampleSeed = undefined;
  });
  return sampleSeed;
}
