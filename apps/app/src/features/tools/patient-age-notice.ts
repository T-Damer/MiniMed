import type { ToolAgeScope } from '@localmed/contracts';
import {
  ageDaysBetween,
  ageScopeAcceptsAgeDays,
  toolAgeBadge,
} from '@/features/tools/tool-age-scope';
import { pluralRu } from '@/i18n/labels';

/** «5 лет», «8 мес.», «12 дн.»: the patient's age the way a doctor says it. */
export function formatPatientAge(ageDays: number): string {
  if (ageDays < 61) return `${ageDays} ${pluralRu(ageDays, 'день', 'дня', 'дней')}`;
  if (ageDays < 730) return `${Math.floor(ageDays / 30.4375)} мес.`;
  const years = Math.floor(ageDays / 365.25);
  return `${years} ${pluralRu(years, 'год', 'года', 'лет')}`;
}

/**
 * A warning when the selected patient is outside the tool's declared population, or undefined
 * when the age fits or cannot be known (no birth date, a date in the future). It never blocks the
 * tool: the doctor decides, the app only says what the source says.
 */
export function patientAgeMismatch(
  scope: ToolAgeScope,
  birthDate: string | undefined,
  onDate: string,
): string | undefined {
  if (!birthDate) return undefined;
  const ageDays = ageDaysBetween(birthDate, onDate);
  if (ageDays === undefined || ageScopeAcceptsAgeDays(scope, ageDays)) return undefined;
  return `Инструмент рассчитан на другую группу: ${toolAgeBadge(scope).label.toLocaleLowerCase('ru-RU')}. Возраст пациента — ${formatPatientAge(ageDays).replace(/\.$/u, '')}.`;
}
