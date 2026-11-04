/**
 * The three documents a patient accepts before a care diary starts (DIARY26, owner 2026-11-04,
 * as the patient joins elsewhere: «подписывает информированное согласие, согласие на обработку
 * персональных данных и договор на дистанционное сопровождение»). Each has a short summary and its
 * full text; the clinic and the doctor come from the plan's `operator` (the doctor's «Врач и
 * организация»), and what nobody has filled in stays a visible blank. The wording is a template
 * for the clinic's lawyer (drafts with the open questions: docs/diary-consent/): a new wording gets
 * a new `version`, and each acceptance keeps the version the patient read.
 */
import type { DiaryInvitation, DiaryOperator } from '@/features/diary/diary-model';
import type { ClinicianProfile } from '@/state/clinician-profile';

export const JOINING_DOCUMENT_IDS = ['monitoring', 'personal-data', 'contract'] as const;

export type JoiningDocumentId = (typeof JOINING_DOCUMENT_IDS)[number];

/** A run of text, an operator detail, or a blank the clinic fills in (shown as a gap to fill). */
export type JoiningSegment =
  | string
  | { readonly field: keyof DiaryOperator; readonly blank: string }
  | { readonly blank: string };

export interface JoiningSection {
  readonly heading?: string;
  readonly paragraphs: readonly (readonly JoiningSegment[])[];
}

export interface JoiningDocument {
  readonly id: JoiningDocumentId;
  /** Changes with every new wording; an acceptance of another version is not this document's. */
  readonly version: string;
  readonly title: string;
  readonly summary: readonly string[];
  readonly sections: readonly JoiningSection[];
}

/** One document the patient accepted: which wording, and when. */
export interface JoiningAcceptance {
  readonly document: JoiningDocumentId;
  readonly version: string;
  readonly at: string;
}

/** The set as a whole, sent with the consent record. */
export const JOINING_SET_VERSION = 'joining-template-2026-11-04';
const TEMPLATE_VERSION = 'template-2026-11-04';

const ORGANIZATION = { field: 'organization', blank: 'медицинская организация' } as const;
const ADDRESS = { field: 'address', blank: 'адрес организации' } as const;
const OGRN = { field: 'ogrn', blank: 'ОГРН' } as const;
const CLINICIAN = { field: 'clinician', blank: 'ФИО лечащего врача' } as const;
const POSITION = { field: 'position', blank: 'должность врача' } as const;

const HOURS = { blank: 'дни и часы, когда врач смотрит записи' } as const;
const PROCESSOR = { blank: 'разработчик, обрабатывающий данные по поручению' } as const;

const OPERATOR_LINE: readonly JoiningSegment[] = [
  ORGANIZATION,
  ', ',
  ADDRESS,
  ', ОГРН ',
  OGRN,
  '.',
];

function monitoring(connected: boolean): JoiningDocument {
  return {
    id: 'monitoring',
    version: TEMPLATE_VERSION,
    title: 'Информированное согласие на дистанционное наблюдение',
    summary: [
      'Вы отмечаете лекарства, самочувствие, показатели и опросники, которые назначил врач.',
      'Записи видят только ваш врач и врачи, которых он подключит; список виден вам.',
      'Врач читает записи в рабочее время; в опасной ситуации звоните 112.',
      'Отказаться можно в любой момент — на лечение это не влияет.',
    ],
    sections: [
      {
        paragraphs: [
          [
            'Я добровольно соглашаюсь на дистанционное наблюдение за моим состоянием и лечением, которое назначил мой лечащий врач ',
            CLINICIAN,
            ', ',
            POSITION,
            ', ',
            ORGANIZATION,
            ' (',
            ADDRESS,
            '), с помощью приложения «Дневник».',
          ],
        ],
      },
      {
        heading: '1. Цель',
        paragraphs: [
          [
            'Следить за самочувствием, переносимостью и регулярностью лечения между очными приёмами, чтобы врач мог вовремя изменить лечение и дать рекомендации.',
          ],
        ],
      },
      {
        heading: '2. Что я делаю',
        paragraphs: [
          [
            'По плану врача отмечаю приём лекарств и самочувствие после него, записываю назначенные показатели (пульс, давление, сатурацию и другие), заполняю назначенные опросники и по желанию описываю состояние своими словами. Врач опирается на мои записи, поэтому я вношу их достоверно.',
          ],
        ],
      },
      {
        heading: '3. Кто видит записи',
        paragraphs: [
          [
            'Мой лечащий врач и врачи, которых он подключит к наблюдению; список врачей с доступом виден мне в приложении. ',
            connected
              ? 'Записи шифруются на моём телефоне и на устройствах врачей; сервер хранит только шифр и прочитать его не может.'
              : 'Записи хранятся на моём телефоне и попадают к врачу, когда я их отправлю.',
          ],
        ],
      },
      {
        heading: '4. Как врач отвечает',
        paragraphs: [
          ['Врач просматривает записи и отвечает: ', HOURS, '.'],
          [
            'Срочные отметки (например, ответ о мыслях о причинении себе вреда) приходят врачу уведомлением, но в этот момент врач может быть недоступен. При резком ухудшении, мыслях о самоубийстве или угрозе жизни я звоню 112 или по номерам из раздела «Помощь» в приложении.',
          ],
        ],
      },
      {
        heading: '5. Риски и ограничения',
        paragraphs: [
          [
            'Ответ врача может прийти с задержкой; без интернета записи доходят позже. Возможны ошибки ввода, сбои телефона и потеря записей, ещё не отправленных с телефона. Если телефон потерян или передан без блокировки экрана, записи могут увидеть посторонние. Очные приёмы, назначенные врачом, остаются в силе.',
          ],
        ],
      },
      {
        heading: '6. Врачебная тайна',
        paragraphs: [
          [
            'Я разрешаю передавать сведения о моём здоровье и лечении, которые я вношу в «Дневник», врачам из раздела 3, а также лицу, которое обрабатывает данные по поручению медицинской организации (',
            PROCESSOR,
            '), в зашифрованном виде и только для цели из раздела 1.',
          ],
        ],
      },
      {
        heading: '7. Право отказа',
        paragraphs: [
          [
            'Я могу наблюдаться только на очных приёмах, без приложения. Отказаться от дистанционного наблюдения можно в любой момент кнопкой «Отозвать согласие» в «Настройках» дневника или заявлением в медицинскую организацию; отказ не влияет на моё лечение. После отзыва записи удаляются с сервера; то, что врач уже внёс в медицинскую документацию, хранится по закону.',
          ],
        ],
      },
      {
        heading: '8. Срок',
        paragraphs: [['Согласие действует до окончания наблюдения или до отзыва.']],
      },
    ],
  };
}

function personalData(connected: boolean): JoiningDocument {
  return {
    id: 'personal-data',
    version: TEMPLATE_VERSION,
    title: 'Согласие на обработку персональных данных',
    summary: connected
      ? [
          'В дневнике нет вашего имени: кто вы, знает только врач.',
          'Записи шифруются на телефоне и уходят врачу сами; сервер хранит только шифр.',
          'Данные хранятся в России. Отозвать согласие можно в «Настройках» — записи удалятся с сервера.',
        ]
      : [
          'В дневнике нет вашего имени: кто вы, знает только врач.',
          'Записи хранятся на вашем телефоне и уходят врачу, когда вы их отправите.',
          'Удалить дневник можно в любой момент вместе со всеми записями.',
        ],
    sections: [
      {
        paragraphs: [
          [
            'Я даю согласие оператору — ',
            ...OPERATOR_LINE.slice(0, -1),
            ' — на обработку моих персональных данных, включая данные о состоянии здоровья, на условиях ниже.',
          ],
        ],
      },
      {
        heading: '1. Цель',
        paragraphs: [
          [
            'Дистанционное наблюдение за моим состоянием и лечением лечащим врачом и подключёнными им врачами с помощью приложения «Дневник» по моему информированному согласию.',
          ],
        ],
      },
      {
        heading: '2. Какие данные',
        paragraphs: [
          [
            'В приложении: условное имя или значок вместо имени; назначенное лечение и его приём; показатели, назначенные врачом; оценки самочувствия; ответы на опросники; описания состояния; рекомендации врача.',
          ],
          [
            connected
              ? 'Технические данные: случайные номера дневника и устройства, время отправки записей, IP-адрес при соединении с сервером.'
              : 'Технические данные: случайный номер дневника и время записей.',
          ],
          [
            'Имя, дата рождения и контакты остаются в медицинской документации оператора и в приложение не передаются.',
          ],
        ],
      },
      ...(connected
        ? [
            {
              heading: '3. Кто обрабатывает по поручению',
              paragraphs: [
                [
                  PROCESSOR,
                  ' — хранение зашифрованных записей на сервере и их передача между моим телефоном и устройствами врачей. Содержание записей шифруется на устройствах и этому лицу недоступно. Сервер находится в России.',
                ],
              ],
            },
          ]
        : []),
      {
        heading: connected ? '4. Действия с данными' : '3. Действия с данными',
        paragraphs: [
          [
            'Сбор, запись, систематизация, накопление, хранение, уточнение, извлечение, использование, передача лечащему врачу и подключённым им врачам, обезличивание (псевдоним), блокирование, удаление и уничтожение; обработка автоматизированная.',
          ],
        ],
      },
      {
        heading: connected ? '5. Срок и отзыв' : '4. Срок и отзыв',
        paragraphs: [
          [
            'Согласие действует до окончания наблюдения либо до отзыва. Отозвать его можно кнопкой «Отозвать согласие» в «Настройках» дневника или заявлением оператору; после отзыва записи удаляются, а сведения, уже внесённые врачом в медицинскую документацию, хранятся по закону.',
          ],
        ],
      },
    ],
  };
}

function contract(): JoiningDocument {
  return {
    id: 'contract',
    version: TEMPLATE_VERSION,
    title: 'Договор на дистанционное сопровождение',
    summary: [
      'Врач составляет план и смотрит ваши записи между приёмами, меняет лечение, когда нужно.',
      'Вы вносите записи по плану и приходите на очные приёмы.',
      'Договор действует до конца наблюдения; отказаться можно в любой момент.',
    ],
    sections: [
      {
        paragraphs: [
          [
            'Исполнитель — ',
            ...OPERATOR_LINE.slice(0, -1),
            ', в лице лечащего врача ',
            CLINICIAN,
            ' (',
            POSITION,
            '). Пациент — человек, который получил этот дневник от лечащего врача и принял договор в приложении; кто он, исполнитель знает по медицинской документации.',
          ],
        ],
      },
      {
        heading: '1. Предмет',
        paragraphs: [
          [
            'Исполнитель сопровождает лечение пациента между очными приёмами с помощью приложения «Дневник»: составляет план (лекарства, показатели, опросники), просматривает записи пациента, меняет план и даёт рекомендации.',
          ],
        ],
      },
      {
        heading: '2. Исполнитель',
        paragraphs: [
          [
            'Просматривает записи пациента: ',
            HOURS,
            '. Отвечает на срочные отметки при первой возможности в это время. Сообщает об изменениях плана через приложение. Хранит врачебную тайну.',
          ],
        ],
      },
      {
        heading: '3. Пациент',
        paragraphs: [
          [
            'Вносит записи по плану и достоверно. Приходит на очные приёмы, которые назначил врач. При резком ухудшении звонит 112 или по номерам из раздела «Помощь». Блокирует экран телефона, на котором ведёт дневник.',
          ],
        ],
      },
      {
        heading: '4. Стоимость',
        paragraphs: [[{ blank: 'стоимость и порядок оплаты либо «безвозмездно»' }, '.']],
      },
      {
        heading: '5. Срок и отказ',
        paragraphs: [
          [
            'Договор действует с принятия в приложении до окончания наблюдения. Пациент может отказаться в любой момент кнопкой «Отозвать согласие» в «Настройках» дневника; исполнитель может завершить наблюдение, сообщив об этом пациенту в приложении.',
          ],
        ],
      },
      {
        heading: '6. Принятие',
        paragraphs: [
          [
            'Договор заключается, когда пациент принимает его в приложении; время принятия и версия текста сохраняются вместе с дневником и видны лечащему врачу.',
          ],
        ],
      },
    ],
  };
}

/** The documents for this diary, in the order the patient reads them. */
export function joiningDocuments(connected: boolean): readonly JoiningDocument[] {
  return [monitoring(connected), personalData(connected), contract()];
}

/** The operator as the documents name them: the plan's details, the doctor's signature last. */
export function diaryOperator(invitation: DiaryInvitation): DiaryOperator {
  const operator = invitation.operator ?? {};
  return {
    ...operator,
    ...(!operator.clinician && invitation.doctor ? { clinician: invitation.doctor } : {}),
  };
}

/** The doctor's «Врач и организация» as the plan carries it; nothing filled in → nothing. */
export function operatorFromProfile(profile: ClinicianProfile): DiaryOperator | undefined {
  const operator: DiaryOperator = {
    ...(profile.organizationName ? { organization: profile.organizationName } : {}),
    ...(profile.organizationAddress ? { address: profile.organizationAddress } : {}),
    ...(profile.ogrn ? { ogrn: profile.ogrn } : {}),
    ...(profile.clinicianFullName ? { clinician: profile.clinicianFullName } : {}),
    ...(profile.clinicianPosition ? { position: profile.clinicianPosition } : {}),
  };
  return Object.keys(operator).length ? operator : undefined;
}

export interface JoiningPart {
  readonly text: string;
  /** A blank the clinic has not filled in: drawn as a gap with what belongs there. */
  readonly blank?: boolean;
}

/** One paragraph with the operator's details in place. */
export function joiningParagraph(
  segments: readonly JoiningSegment[],
  operator: DiaryOperator,
): readonly JoiningPart[] {
  return segments.map((segment) => {
    if (typeof segment === 'string') return { text: segment };
    const value = 'field' in segment ? operator[segment.field] : undefined;
    return value ? { text: value } : { text: segment.blank, blank: true };
  });
}

/** Whether every document of the set is accepted in its current wording. */
export function acceptedAll(
  documents: readonly JoiningDocument[],
  acceptances: readonly JoiningAcceptance[],
): boolean {
  return documents.every((document) =>
    acceptances.some(
      (acceptance) =>
        acceptance.document === document.id && acceptance.version === document.version,
    ),
  );
}

const MAX_VERSION = 80;

function isJoiningDocumentId(value: unknown): value is JoiningDocumentId {
  return typeof value === 'string' && (JOINING_DOCUMENT_IDS as readonly string[]).includes(value);
}

/**
 * Acceptances read from storage or a consent record (untrusted): unknown documents and broken
 * entries are left out, one per document, in the documents' order.
 */
export function parseJoiningAcceptances(value: unknown): JoiningAcceptance[] {
  if (!Array.isArray(value)) return [];
  const byDocument = new Map<JoiningDocumentId, JoiningAcceptance>();
  for (const item of value) {
    if (typeof item !== 'object' || item === null) continue;
    const { document, version, at } = item as Record<string, unknown>;
    if (!isJoiningDocumentId(document)) continue;
    if (typeof version !== 'string' || !version || version.length > MAX_VERSION) continue;
    if (typeof at !== 'string' || Number.isNaN(Date.parse(at))) continue;
    byDocument.set(document, { document, version, at });
  }
  return JOINING_DOCUMENT_IDS.flatMap((id) => {
    const acceptance = byDocument.get(id);
    return acceptance ? [acceptance] : [];
  });
}

/** The moment the last document was accepted: when the diary could start. */
export function acceptedAt(acceptances: readonly JoiningAcceptance[]): string | undefined {
  let latest: string | undefined;
  for (const acceptance of acceptances) {
    if (!latest || Date.parse(acceptance.at) > Date.parse(latest)) latest = acceptance.at;
  }
  return latest;
}

/** The title of an accepted document, also for a wording this version no longer ships. */
export function joiningTitle(id: JoiningDocumentId): string {
  return joiningDocuments(true).find((document) => document.id === id)?.title ?? id;
}
