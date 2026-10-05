import { z } from 'zod';

/**
 * Who a calculator, questionnaire or app tool is meant for. Every tool declares it in its own
 * schema so lists can be filtered «Дети / Взрослые / Все» without any per-tool code: a tool
 * without a declared age scope is rejected where its definition is validated.
 *
 * Groups are not exclusive: a tool for «Взрослые и дети» lists both, a tool whose source says that
 * age does not matter lists all three. `neonates` marks tools that are meant for the newborn period
 * (the first month of life); a newborn is also a child, so the «Дети» filter includes it.
 */
export const TOOL_AGE_GROUPS = ['neonates', 'children', 'adults'] as const;

export const ToolAgeGroupSchema = z.enum(TOOL_AGE_GROUPS);

export const ToolAgeUnitSchema = z.enum(['days', 'months', 'years']);

/** A completed-age limit as the source states it: «от 2 месяцев», «до 16 лет». */
export const ToolAgeBoundSchema = z
  .object({
    value: z.number().int().min(0).max(130),
    unit: ToolAgeUnitSchema,
  })
  .strict();

export const TOOL_AGE_ADULT_FROM_YEARS = 18;
/** WHO defines growth references to 19 years, so a children-only tool may reach that far. */
export const TOOL_AGE_CHILD_UNTIL_YEARS = 19;
/** A newborn-only tool covers the first month of life (calendar month, so 31 days). */
export const TOOL_AGE_NEONATE_UNTIL_DAYS = 31;

export type ToolAgeGroup = z.infer<typeof ToolAgeGroupSchema>;
export type ToolAgeBound = z.infer<typeof ToolAgeBoundSchema>;

const DAYS_PER_UNIT = { days: 1, months: 30.4375, years: 365.25 } as const;

/** Start of the limit's unit in days: «2 мес.» = from the 61st day. */
export function toolAgeBoundStartDays(bound: ToolAgeBound): number {
  return Math.floor(bound.value * DAYS_PER_UNIT[bound.unit]);
}

/** Last day still inside the limit: «до 16 лет» = until the day before the 17th birthday. */
export function toolAgeBoundEndDays(bound: ToolAgeBound): number {
  return Math.ceil((bound.value + 1) * DAYS_PER_UNIT[bound.unit]) - 1;
}

export const ToolAgeScopeSchema = z
  .object({
    groups: z.array(ToolAgeGroupSchema).min(1),
    /** Completed age from which the source allows the tool; absent when it states no lower limit. */
    minAge: ToolAgeBoundSchema.optional(),
    /** Completed age up to which the source allows the tool; absent when it states no upper limit. */
    maxAge: ToolAgeBoundSchema.optional(),
    /** The statement the declaration rests on: a source or definition wording, never a guess. */
    basis: z.string().min(1),
  })
  .strict()
  .superRefine((scope, context) => {
    const groups = new Set(scope.groups);
    if (groups.size !== scope.groups.length) {
      context.addIssue({ code: 'custom', path: ['groups'], message: 'groups must be unique' });
    }
    const adults = groups.has('adults');
    const young = groups.has('children') || groups.has('neonates');
    const minDays = scope.minAge ? toolAgeBoundStartDays(scope.minAge) : undefined;
    const maxDays = scope.maxAge ? toolAgeBoundEndDays(scope.maxAge) : undefined;
    if (minDays !== undefined && maxDays !== undefined && minDays > maxDays) {
      context.addIssue({
        code: 'custom',
        path: ['minAge'],
        message: 'minAge must not exceed maxAge',
      });
    }
    if (adults && !young) {
      if (scope.minAge && toolAgeBoundStartDays(scope.minAge) < TOOL_AGE_ADULT_FROM_YEARS * 365) {
        context.addIssue({
          code: 'custom',
          path: ['minAge'],
          message: 'an adults-only tool cannot start below 18 years',
        });
      }
      return;
    }
    if (!adults && maxDays !== undefined) {
      const limit = groups.has('children')
        ? (TOOL_AGE_CHILD_UNTIL_YEARS + 1) * 365.25
        : TOOL_AGE_NEONATE_UNTIL_DAYS;
      if (maxDays > limit) {
        context.addIssue({
          code: 'custom',
          path: ['maxAge'],
          message: groups.has('children')
            ? 'a children-only tool cannot reach beyond 19 years'
            : 'a newborn-only tool cannot reach beyond one month',
        });
      }
    }
    if (!adults && !groups.has('children') && minDays !== undefined && minDays > 0) {
      context.addIssue({
        code: 'custom',
        path: ['minAge'],
        message: 'a newborn-only tool starts at birth',
      });
    }
    if (groups.has('neonates') && !groups.has('children') && adults) {
      context.addIssue({
        code: 'custom',
        path: ['groups'],
        message: 'newborns and adults without children is not a valid scope',
      });
    }
    if (groups.has('neonates') && minDays !== undefined && minDays >= TOOL_AGE_NEONATE_UNTIL_DAYS) {
      context.addIssue({
        code: 'custom',
        path: ['groups'],
        message: 'a tool that starts after the newborn period must not list neonates',
      });
    }
  });

export type ToolAgeScope = z.infer<typeof ToolAgeScopeSchema>;

/** The scope of a tool whose source says that age does not matter. */
export function anyAgeScope(basis: string): ToolAgeScope {
  return { groups: [...TOOL_AGE_GROUPS], basis };
}
