/**
 * Window events that tell the calculator lists to re-read the registry. They live in a module of
 * their own so the state that fires them (downloaded sections, the doctor's own calculators) does
 * not have to import the registry back.
 */

/** Fired when the set of installed calculators changes. */
export const CALCULATOR_PACKS_EVENT = 'minimed:calculator-packs-changed';

/** Fired after the doctor's own calculators were created, saved or deleted. */
export const USER_CALCULATORS_EVENT = 'minimed:user-calculators-changed';
