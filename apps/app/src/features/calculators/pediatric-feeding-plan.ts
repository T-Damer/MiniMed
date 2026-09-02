import type { TextCalculationResult } from '@/features/calculators/clinical-calculations';

export const PEDIATRIC_FEEDING_PLAN_ID = 'minimed.calculator.pediatric-feeding-plan';

export interface PediatricFeedingPlanDisplay {
  readonly details: string;
  readonly guide: string;
  readonly frequency: string;
  readonly dailyVolume: string;
  readonly dailyCalories: string;
  readonly allergyPlan?: string;
  readonly meals: readonly {
    readonly time: string;
    readonly food: string;
    readonly volume: string;
    readonly calories: string;
  }[];
  readonly calendar: readonly { readonly day: string; readonly instruction: string }[];
}

function numericValue(text: string): number {
  return Number(text.replace(',', '.').match(/-?\d+(?:\.\d+)?/u)?.[0] ?? 0);
}

export function parsePediatricFeedingPlan(
  textValues: TextCalculationResult['textValues'],
): PediatricFeedingPlanDisplay {
  const text = (id: string) => textValues.find((item) => item.id === id)?.text ?? '';
  const ageMonths = numericValue(text('ageMonthsOut'));
  const feedingCount = numericValue(text('feedingCount'));
  const feedingMode = text('feedingModeOut');
  const feedingModeLabel =
    feedingMode === 'breast' ? 'грудное' : feedingMode === 'mixed' ? 'смешанное' : 'искусственное';
  const supplement = numericValue(text('mixedSupplementPerFeed'));
  const oneFeedVolume = numericValue(text('oneFeedVolume'));
  const measuredBreastMilk = Math.max(0, oneFeedVolume - supplement);
  const meals = [1, 2, 3, 4, 5].flatMap((index) => {
    const food = text(`meal${index}Food`);
    if (!food) return [];
    const volume = text(`meal${index}Volume`);
    const mealSupplement = Math.max(0, numericValue(volume) - measuredBreastMilk);
    return [
      {
        time: text(`meal${index}Time`),
        food:
          feedingMode === 'mixed' && food.includes('рассчитанный докорм')
            ? `Грудное молоко ${measuredBreastMilk} мл + докорм смесью ${mealSupplement} мл`
            : food,
        volume,
        calories: text(`meal${index}Calories`),
      },
    ];
  });
  const excludedFoods = text('excludedFoodsOut').trim();
  const allergyAlternative = text('allergyAlternative').trim();

  return {
    details: `${ageMonths.toLocaleString('ru-RU')} мес. · ${feedingModeLabel} вскармливание`,
    guide:
      ageMonths < 6
        ? feedingMode === 'breast'
          ? 'Грудное кормление — по требованию днём и ночью; числа служат расчётным ориентиром, а не жёстким объёмом у груди.'
          : 'Суточный и разовый объём рассчитаны по массе ребёнка и энергетической плотности смеси.'
        : ageMonths < 12
          ? 'Новый продукт предлагают утром и отдельно от других новых продуктов; молочное кормление сохраняют по требованию.'
          : 'Пять приёмов пищи: три основных и два дополнительных. Грудное кормление, если сохраняется, — по требованию.',
    frequency:
      ageMonths < 6 && feedingMode === 'breast'
        ? `${feedingCount} расчётных кормлений; фактически — по требованию`
        : ageMonths >= 12
          ? '5 приёмов пищи: 3 основных и 2 дополнительных'
          : `${feedingCount} кормлений в сутки`,
    dailyVolume: text('dailyVolume'),
    dailyCalories: text('dailyCalories'),
    ...(allergyAlternative
      ? {
          allergyPlan: `${excludedFoods ? `Исключить: ${excludedFoods}. ` : ''}${allergyAlternative}`,
        }
      : {}),
    meals,
    calendar: [1, 2, 3, 4, 5, 6, 7].flatMap((index) => {
      const instruction = text(`calendarDay${index}`);
      return instruction ? [{ day: `День ${index}`, instruction }] : [];
    }),
  };
}
