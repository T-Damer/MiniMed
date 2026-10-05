/**
 * Identity of the doctor's own calculators. The model id (`uc-…`) is also the route slug; the
 * registered schema id adds a prefix so no downloaded calculator can ever share it.
 */
export const USER_CALCULATOR_ID_PREFIX = 'user-calculator:';

/** The model id format: it is read back from storage and files, so only this shape is accepted. */
export const USER_CALCULATOR_MODEL_ID = /^uc-[a-z0-9]{6,32}$/u;

export function userCalculatorSchemaId(modelId: string): string {
  return `${USER_CALCULATOR_ID_PREFIX}${modelId}`;
}

export function isUserCalculatorId(id: string): boolean {
  return id.startsWith(USER_CALCULATOR_ID_PREFIX);
}
