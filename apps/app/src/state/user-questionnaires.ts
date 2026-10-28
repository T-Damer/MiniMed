import {
  addUserLibraryFile,
  getUserLibraryDocument,
  getUserLibraryFile,
  isUserLibraryQuestionnaire,
  listUserLibraryDocuments,
  listUserLibraryFolders,
  removeUserLibraryDocument,
  replaceUserLibraryFile,
  USER_LIBRARY_QUESTIONNAIRE_MIME_TYPE,
  USER_LIBRARY_QUESTIONNAIRES_FOLDER_ID,
  userLibraryQuestionnaireFileName,
} from '@/state/user-library';
import {
  createId,
  createUserQuestionnaireDraft,
  DEFAULT_DISCLAIMER,
  MAX_IMAGE_FILE_BYTES,
  parseImage,
  parseUserQuestionnaire,
  type StoredUserQuestionnaire,
  type UserQuestionnaire,
  type UserQuestionnaireImage,
  whooleySample,
  withQuestionnaireImportDefaults,
} from '@/state/user-questionnaire-format';

export * from '@/state/user-questionnaire-format';

const SAMPLE_SEEDED_KEY = 'minimed.userQuestionnaires.sampleSeeded.v1';

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
