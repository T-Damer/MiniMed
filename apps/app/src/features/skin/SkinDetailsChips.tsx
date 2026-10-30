import { For, type JSX, Show } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { MultiPickField } from '@/components/MultiPickField';
import { type SkinChipState, skinChipGroups } from '@/features/skin/skin-details';
import type { SkinDetails } from '@/features/skin/skin-model';

import '@/styles/skin-photo.css';

const CHIP_ICON: Partial<Record<SkinChipState, 'check' | 'close'>> = {
  on: 'check',
  absent: 'close',
};

/**
 * What the doctor knows about the lesion: the place as a dropdown field, the rest as tap chips. Nothing is pre-filled; a group appears once
 * the one before it has an answer. A symptom chip cycles present → absent → not asked.
 */
export function SkinDetailsChips(props: {
  readonly details: SkinDetails;
  readonly onChange: (next: SkinDetails) => void;
}): JSX.Element {
  const groups = () => skinChipGroups(props.details);
  return (
    <div class="skin-details" data-testid="skin-details">
      <For each={groups().map((group) => group.id)}>
        {(groupId) => {
          const group = () => groups().find((entry) => entry.id === groupId);
          const choose = (chipId: string): void => {
            const next = group()?.chips.find((entry) => entry.id === chipId)?.next;
            if (next) props.onChange(next);
          };
          return (
            <Show
              when={group()?.control !== 'pick'}
              fallback={
                <div class="skin-details__group" data-group={groupId}>
                  <MultiPickField
                    label={group()?.label ?? ''}
                    placeholder={group()?.placeholder ?? ''}
                    options={(group()?.chips ?? []).map((chip) => ({
                      id: chip.id,
                      label: chip.label,
                      selected: chip.state === 'on',
                    }))}
                    onToggle={choose}
                    testId={`skin-pick-${groupId}`}
                  />
                </div>
              }
            >
              <fieldset class="skin-details__group" data-group={groupId}>
                <legend class="skin-details__label">{group()?.label}</legend>
                <div class="skin-details__chips">
                  <For each={group()?.chips.map((chip) => chip.id) ?? []}>
                    {(chipId) => {
                      const chip = () => group()?.chips.find((entry) => entry.id === chipId);
                      const icon = () => CHIP_ICON[chip()?.state ?? 'off'];
                      return (
                        <button
                          type="button"
                          class="skin-chip"
                          classList={{
                            'skin-chip--on': chip()?.state === 'on',
                            'skin-chip--absent': chip()?.state === 'absent',
                          }}
                          aria-pressed={chip()?.state === 'off' ? 'false' : 'true'}
                          onClick={() => choose(chipId)}
                        >
                          {icon() ? (
                            <AppGlyph name={icon() ?? 'check'} class="skin-chip__icon" />
                          ) : null}
                          <span
                            class="skin-chip__label"
                            classList={{ 'skin-chip__label--struck': chip()?.state === 'absent' }}
                          >
                            {chip()?.label}
                          </span>
                        </button>
                      );
                    }}
                  </For>
                </div>
              </fieldset>
            </Show>
          );
        }}
      </For>
    </div>
  );
}
