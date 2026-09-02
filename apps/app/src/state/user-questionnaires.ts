import type {
  AssessmentDefinition,
  AssessmentImage,
} from '@/features/assessments/assessment-types';
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

export const USER_QUESTIONNAIRE_FORMAT = 'minimed-questionnaire';
export const USER_QUESTIONNAIRE_VERSION = 1;

const MAX_QUESTIONS = 50;
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
  readonly questions: readonly UserQuestionnaireQuestion[];
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
  if (typeof value !== 'string') throw new Error(`${label} должен быть текстом.`);
  const text = value.trim();
  if (!allowEmpty && !text) throw new Error(`${label} не должен быть пустым.`);
  if ([...text].length > MAX_TEXT_LENGTH) throw new Error(`${label} слишком длинный.`);
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
    throw new Error('Вес ответа должен быть числом от −1000 до 1000.');
  }
  return {
    id: boundedId(value.id, 'вариант ответа'),
    label: boundedText(value.label, 'Вариант ответа', false),
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
  return {
    id: boundedId(value.id, 'вопрос'),
    prompt: boundedText(value.prompt, 'Вопрос'),
    text: boundedText(value.text ?? '', 'Текст вопроса'),
    images: parseImages(value.images ?? []),
    options,
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
  if (value.format !== USER_QUESTIONNAIRE_FORMAT || value.version !== USER_QUESTIONNAIRE_VERSION) {
    throw new Error('Этот файл опросника не поддерживается.');
  }
  const questionsValue = value.questions;
  if (!Array.isArray(questionsValue) || questionsValue.length > MAX_QUESTIONS) {
    throw new Error(`В опроснике может быть не более ${MAX_QUESTIONS} вопросов.`);
  }
  const questions = questionsValue.map(parseQuestion);
  const questionIds = new Set(questions.map((question) => question.id));
  if (questionIds.size !== questions.length) throw new Error('Вопросы не должны повторяться.');
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
  return {
    format: USER_QUESTIONNAIRE_FORMAT,
    version: USER_QUESTIONNAIRE_VERSION,
    title,
    description: boundedText(value.description, 'Описание'),
    disclaimer: boundedText(value.disclaimer, 'Ограничение', false),
    images,
    questions,
    createdAt,
    updatedAt,
    ...(sample ? { sample } : {}),
    ...(reference ? { reference } : {}),
  };
}

function withUpdatedAt(questionnaire: UserQuestionnaire): UserQuestionnaire {
  return { ...parseUserQuestionnaire(questionnaire), updatedAt: new Date().toISOString() };
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
    disclaimer: 'Локальный авторский опросник. Его результат не является диагнозом.',
    images: [],
    questions: [createUserQuestionnaireQuestion()],
    createdAt: now,
    updatedAt: now,
  };
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
    title: 'Пример: скрининг настроения Whooley',
    description:
      'Демонстрационный локальный файл с двумя вопросами Whooley для первичного скрининга настроения.',
    disclaimer:
      'Это сверхкороткий скрининг, а не диагноз. Положительный ответ — повод для более подробного разговора со специалистом.',
    images: [],
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

export function userQuestionnaireReadinessError(questionnaire: UserQuestionnaire): string | null {
  if (questionnaire.questions.length === 0) return 'Добавьте хотя бы один вопрос.';
  const usesWeights = questionnaire.questions.some((question) =>
    question.options.some((option) => option.weight !== undefined),
  );
  for (const [index, question] of questionnaire.questions.entries()) {
    if (!question.prompt.trim()) return `Заполните вопрос ${index + 1}.`;
    if (question.options.length < 2) return `Добавьте два варианта ответа к вопросу ${index + 1}.`;
    // ponytail: weights use one total scale; add per-question score modes if mixed scoring is needed.
    if (usesWeights && question.options.some((option) => option.weight === undefined)) {
      return 'Укажите веса у всех вариантов или оставьте все веса пустыми.';
    }
    if (!usesWeights) continue;
    const weights = new Set(question.options.map((option) => option.weight));
    if (weights.size < 2) return `Задайте разные веса ответов к вопросу ${index + 1}.`;
  }
  return null;
}

export function userQuestionnaireToAssessmentDefinition(
  stored: StoredUserQuestionnaire,
): AssessmentDefinition {
  const questionnaire = { ...stored.questionnaire, title: stored.file.title };
  const usesWeights = questionnaire.questions.some((question) =>
    question.options.some((option) => option.weight !== undefined),
  );
  const images = (items: readonly UserQuestionnaireImage[]): readonly AssessmentImage[] =>
    items.map((image) => ({ id: image.id, alt: image.name, dataUrl: image.dataUrl }));
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
    responseOptions: [],
    scales: usesWeights
      ? [
          {
            id: 'total',
            label: 'Сумма весов ответов',
            shortLabel: 'Баллы',
            description: 'Сумма заданных автором весов выбранных ответов.',
          },
        ]
      : [],
    questions: questionnaire.questions.map((question) => ({
      id: question.id,
      prompt: question.prompt,
      text: question.text,
      images: images(question.images),
      scaleId: 'total',
      responseOptions: question.options.map((option, index) => ({
        value: usesWeights ? (option.weight ?? index) : index,
        label: option.label,
        ...(usesWeights ? {} : { hideValue: true }),
      })),
    })),
    ...(usesWeights ? {} : { scoringMode: 'responses-only' as const }),
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
    ...(usesWeights && questionnaire.sample === 'whooley'
      ? {
          interpretations: [
            {
              minScore: 0,
              maxScore: 0,
              scaleId: 'total',
              headline: 'Отрицательный результат скрининга',
              message:
                'Отрицательные ответы на оба вопроса снижают вероятность текущего депрессивного эпизода, но не исключают его полностью.',
            },
            {
              minScore: 1,
              maxScore: 2,
              scaleId: 'total',
              headline: 'Положительный результат скрининга',
              message:
                'Положительный ответ хотя бы на один вопрос — повод обсудить настроение и при необходимости пройти более подробную оценку со специалистом.',
            },
          ],
        }
      : {}),
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

export async function importUserQuestionnaire(file: File): Promise<StoredUserQuestionnaire> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await file.text());
  } catch {
    throw new Error('Выберите файл опросника MiniMed в формате JSON.');
  }
  const source = parseUserQuestionnaire(parsed);
  const now = new Date().toISOString();
  return createUserQuestionnaire({ ...source, createdAt: now, updatedAt: now });
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
