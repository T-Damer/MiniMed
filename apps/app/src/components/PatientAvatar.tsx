import { type JSX, Show } from 'solid-js';
import { AppGlyph } from '@/components/AppGlyph';
import { type PatientAvatar as Avatar, patientInitials } from '@/state/patientAvatar';
import '@/styles/patientAvatar.css';

export function PatientAvatar(props: {
  readonly avatar?: Avatar | undefined;
  readonly portrait?: boolean;
  readonly name: string;
}): JSX.Element {
  return (
    <span
      class="patient-avatar"
      classList={{ 'patient-avatar--portrait': props.portrait }}
      aria-hidden="true"
    >
      <Show
        when={props.avatar}
        fallback={
          <Show
            when={patientInitials(props.name)}
            fallback={<AppGlyph name="users" class="patient-avatar__icon" />}
          >
            <span class="patient-avatar__initials">{patientInitials(props.name)}</span>
          </Show>
        }
      >
        {(avatar) => (
          <Show
            when={avatar().kind === 'photo'}
            fallback={<span class="patient-avatar__symbol">{avatar().value}</span>}
          >
            <img class="patient-avatar__photo" src={avatar().value} alt="" />
          </Show>
        )}
      </Show>
    </span>
  );
}
