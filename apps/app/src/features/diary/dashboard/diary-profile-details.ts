import { type DiaryProfile, isDiaryMeasurement } from '@/features/diary/connected/diary-replica';

export interface DiaryIdentityDetails {
  readonly biologicalSex: NonNullable<DiaryProfile['biologicalSex']> | '';
  readonly height: string;
  readonly weight: string;
}

export function diaryIdentityDetails(profile?: DiaryProfile): DiaryIdentityDetails {
  return {
    biologicalSex: profile?.biologicalSex ?? '',
    height: profile?.heightCm?.toString() ?? '',
    weight: profile?.weightKg?.toString() ?? '',
  };
}

function measurement(text: string): number | undefined {
  const value = text.trim();
  if (!value) return undefined;
  return /^\d+(?:[.,]\d+)?$/u.test(value) ? Number(value.replace(',', '.')) : NaN;
}

export function diaryProfileDetails(
  fields: DiaryIdentityDetails,
): Pick<DiaryProfile, 'biologicalSex' | 'heightCm' | 'weightKg'> | undefined {
  const heightCm = measurement(fields.height);
  const weightKg = measurement(fields.weight);
  if (heightCm !== undefined && !isDiaryMeasurement(heightCm)) return undefined;
  if (weightKg !== undefined && !isDiaryMeasurement(weightKg)) return undefined;
  return {
    ...(fields.biologicalSex ? { biologicalSex: fields.biologicalSex } : {}),
    ...(heightCm === undefined ? {} : { heightCm }),
    ...(weightKg === undefined ? {} : { weightKg }),
  };
}
