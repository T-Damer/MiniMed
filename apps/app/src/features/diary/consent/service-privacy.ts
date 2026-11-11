/**
 * The privacy policy of the diary service for DOCTORS' accounts (152-ФЗ ст. 18.1, 9): the service
 * owner is the operator of the doctors' own data; patients' data stay under their clinic and are
 * not restated here. Kept as data with a version, like the joining documents (`joining-documents.ts`),
 * and drawn by the same `ConsentDocumentText`. The wording is a template for the lawyer
 * (docs/diary-consent/service-privacy.draft.md): a new wording gets a new `version`, and every
 * doctor whose accepted version differs sees it again after signing in.
 */
import type { JoiningDocument } from '@/features/diary/consent/joining-documents';

/** Changes with every new wording; the server keeps the version each doctor accepted. */
export const SERVICE_PRIVACY_VERSION = 'service-privacy-2026-11-11';

/** Where a doctor asks for access, correction, deletion or withdraws consent. */
export const SERVICE_PRIVACY_CONTACT = 'admin@1damer.com';

/** Who runs the service, as the app names it (the legal name is the lawyer's to add to the draft). */
export const SERVICE_OPERATOR_LINE = 'Владелец сервиса med.1damer.com';

export const SERVICE_PRIVACY_TITLE = 'Политика обработки персональных данных сервиса дневников';

export type ServicePrivacyDocument = Pick<JoiningDocument, 'version' | 'title' | 'sections'> & {
  readonly summary: readonly string[];
};

export const SERVICE_PRIVACY: ServicePrivacyDocument = {
  version: SERVICE_PRIVACY_VERSION,
  title: SERVICE_PRIVACY_TITLE,
  summary: [
    'Сервис хранит вашу почту, имя и хеш пароля — только чтобы вы входили и получали срочные уведомления.',
    'Пароль сервер не знает; дневники пациентов зашифрованы, и сервер их прочитать не может.',
    'Данные лежат в России. Удалить их или отозвать согласие можно письмом.',
  ],
  sections: [
    {
      paragraphs: [
        [
          `${SERVICE_OPERATOR_LINE} (далее — оператор) обрабатывает персональные данные врачей, у которых есть аккаунт в сервисе дневников. Данные пациентов в этой политике не описаны: ими занимается клиника врача.`,
        ],
      ],
    },
    {
      heading: '1. Какие данные',
      paragraphs: [
        [
          'Адрес электронной почты; имя, которым вы подписываетесь для пациентов; хеш пароля — сам пароль оператору неизвестен, он закрывает ключи шифрования на вашем устройстве. Для входа по коду доступа — служебный адрес, выведенный из кода, и имя «Врач».',
        ],
        [
          'Время входов и срок сессии; адрес push-подписки браузера, если вы включили уведомления; сводные числа по вашим дневникам (сколько дневников, назначений, приёмов лекарств и сколько отмечено принятыми) — без имён и записей пациентов.',
        ],
      ],
    },
    {
      heading: '2. Цели',
      paragraphs: [
        [
          'Создать аккаунт и пускать вас в него; присылать срочные уведомления о пациентах; показывать владельцу сервиса сводный обзор: число врачей, а по каждому врачу — имя, почту, число дневников, время последней записи и те же сводные числа. Других целей нет: рекламы и передачи данных третьим лицам нет.',
        ],
      ],
    },
    {
      heading: '3. Основание',
      paragraphs: [
        [
          'Ваше согласие (ст. 6 ч. 1 п. 1 и ст. 9 Федерального закона № 152-ФЗ). Вы даёте его флажком при регистрации; оператор сохраняет версию этого текста и время согласия.',
        ],
      ],
    },
    {
      heading: '4. Где хранятся',
      paragraphs: [
        [
          'В России: база и сервер сервиса работают в Yandex Cloud, регион ru-central1. Push-уведомления доставляет служба вашего браузера (у Chrome — Google, у Safari — Apple, у Firefox — Mozilla): через неё проходят адрес подписки и сам факт уведомления, без данных пациентов и без вашего имени.',
        ],
      ],
    },
    {
      heading: '5. Сколько хранятся',
      paragraphs: [
        [
          `Пока существует аккаунт. Чтобы его удалить, напишите на ${SERVICE_PRIVACY_CONTACT}: оператор удалит данные не позднее чем через 30 дней; в резервных копиях они остаются ещё до 2 суток.`,
        ],
      ],
    },
    {
      heading: '6. Ваши права',
      paragraphs: [
        [
          `Узнать, какие данные о вас обрабатываются, получить их, потребовать исправить или удалить, отозвать согласие, обратиться в Роскомнадзор или в суд. Запрос — письмом на ${SERVICE_PRIVACY_CONTACT}; ответ придёт в сроки, которые устанавливает закон.`,
        ],
      ],
    },
    {
      heading: '7. Как данные защищены',
      paragraphs: [
        [
          'Дневники шифруются на устройствах, сервер хранит только шифротекст. Пароль нигде не хранится, только его хеш. В журналах сервера нет персональных данных: метод, маршрут, код ответа и время. Обзор сервиса открыт только владельцу.',
        ],
      ],
    },
    {
      heading: '8. Как отозвать согласие',
      paragraphs: [
        [
          `Письмом на ${SERVICE_PRIVACY_CONTACT}. После отзыва аккаунт удаляется (пункт 5), и войти в сервис с него уже нельзя.`,
        ],
      ],
    },
    {
      heading: '9. Изменения',
      paragraphs: [
        [
          'Новая редакция получает новую версию. После входа вы увидите её и сможете принять или выйти; до этого действует то, что вы приняли.',
        ],
      ],
    },
    {
      heading: 'Контакты',
      paragraphs: [[`${SERVICE_OPERATOR_LINE}, ${SERVICE_PRIVACY_CONTACT}.`]],
    },
  ],
};

/**
 * Whether the doctor still has to accept the policy: nothing accepted yet, or another wording.
 * `undefined` (the answer has not come, or the service is offline) asks nothing: reading is not
 * held up by a question that cannot be recorded.
 */
export function privacyAcceptanceNeeded(
  accepted: { readonly version: string } | null | undefined,
): boolean {
  if (accepted === undefined) return false;
  return accepted === null || accepted.version !== SERVICE_PRIVACY_VERSION;
}
