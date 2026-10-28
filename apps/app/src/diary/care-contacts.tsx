import { For, type JSX, Show } from 'solid-js';

import { AppGlyph, type AppGlyphName } from '@/components/AppGlyph';
import { DiarySheet } from '@/diary/DiarySheet';
import { crisisLineParts } from '@/features/diary/crisis-lines';
import type { DiaryContact, DiaryInvitation } from '@/features/diary/diary-model';

const CONTACT_GLYPH: Readonly<Record<DiaryContact['kind'], AppGlyphName>> = {
  phone: 'phone',
  telegram: 'chat',
  link: 'arrow-square-out',
  email: 'envelope-simple',
};

const CONTACT_WORD: Readonly<Record<DiaryContact['kind'], string>> = {
  phone: 'Позвонить',
  telegram: 'Написать в Telegram',
  link: 'Открыть',
  email: 'Написать письмо',
};

/** Where tapping a contact goes: a call, a chat, a page or a letter. */
export function contactHref(contact: DiaryContact): string {
  switch (contact.kind) {
    case 'phone':
      return `tel:${contact.value.replaceAll(/[^\d+]/gu, '')}`;
    case 'email':
      return `mailto:${contact.value}`;
    case 'telegram':
      return contact.value.startsWith('https://')
        ? contact.value
        : `https://t.me/${contact.value.replace(/^@/u, '')}`;
    case 'link':
      return contact.value;
  }
}

export function ContactList(props: { readonly contacts: readonly DiaryContact[] }): JSX.Element {
  return (
    <ul class="diary-contacts">
      <For each={props.contacts}>
        {(contact) => (
          <li class="diary-contacts__item">
            <a
              class="diary-contact"
              href={contactHref(contact)}
              target={contact.kind === 'phone' || contact.kind === 'email' ? undefined : '_blank'}
              rel="noreferrer"
            >
              <span class="diary-contact__icon">
                <AppGlyph name={CONTACT_GLYPH[contact.kind]} class="diary-contact__glyph" />
              </span>
              <span class="diary-contact__text">
                <span class="diary-contact__title">
                  {contact.label ?? CONTACT_WORD[contact.kind]}
                </span>
                <span class="diary-contact__value">{contact.value}</span>
              </span>
            </a>
          </li>
        )}
      </For>
    </ul>
  );
}

export function ContactsSheet(props: {
  readonly invitation: DiaryInvitation;
  readonly onClose: () => void;
}): JSX.Element {
  return (
    <DiarySheet
      title="Связаться с врачом"
      subtitle={props.invitation.doctor}
      onClose={props.onClose}
    >
      <ContactList contacts={props.invitation.contacts ?? []} />
    </DiarySheet>
  );
}

/** What to do when it is very bad: 112, the doctor, and the help lines the doctor listed. */
export function CrisisContent(props: { readonly invitation: DiaryInvitation }): JSX.Element {
  return (
    <div class="diary-crisis">
      <a class="diary-crisis__call" href="tel:112">
        <AppGlyph name="phone" class="diary-crisis__call-icon" />
        <span class="diary-crisis__call-text">
          <span class="diary-crisis__call-title">Позвонить 112</span>
          <span class="diary-crisis__call-hint">
            Если есть опасность для жизни — вашей или чужой
          </span>
        </span>
      </a>
      <Show when={props.invitation.contacts?.length}>
        <h3 class="diary-crisis__heading">Ваш врач</h3>
        <ContactList contacts={props.invitation.contacts ?? []} />
      </Show>
      <Show when={props.invitation.crisis?.length}>
        <h3 class="diary-crisis__heading">Где ещё помогут</h3>
        <ul class="diary-crisis__lines">
          <For each={props.invitation.crisis}>
            {(line) => (
              <li class="diary-crisis__line">
                <For each={crisisLineParts(line)}>
                  {(part) =>
                    part.kind === 'phone' ? (
                      <a class="diary-crisis__phone" href={part.href}>
                        {part.text}
                      </a>
                    ) : (
                      part.text
                    )
                  }
                </For>
              </li>
            )}
          </For>
        </ul>
      </Show>
    </div>
  );
}

export function CrisisSheet(props: {
  readonly invitation: DiaryInvitation;
  /** Opened by an answer of a questionnaire rather than by the patient. */
  readonly raised: boolean;
  readonly onClose: () => void;
}): JSX.Element {
  return (
    <DiarySheet
      title="Если вам очень плохо"
      subtitle={props.raised ? 'Ваши ответы сохранены. Не оставайтесь с этим одни.' : undefined}
      onClose={props.onClose}
    >
      <CrisisContent invitation={props.invitation} />
    </DiarySheet>
  );
}
