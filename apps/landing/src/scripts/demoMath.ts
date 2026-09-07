import calculator from '../data/calculator.json';
import questionnaire from '../data/questionnaire.json';

export { calculator, questionnaire };

// The landing supports only the arithmetic used by this small schema; never evaluate JavaScript.
export function evaluateDemoExpression(expression: string, scope: Record<string, number>): number {
  const term = (value: string): number => {
    const result = Object.hasOwn(scope, value) ? scope[value] : Number(value);
    if (result === undefined || !Number.isFinite(result)) throw new Error('Invalid formula term.');
    return result;
  };
  const root = /^sqrt\(([a-zA-Z][a-zA-Z0-9]*)\)$/u.exec(expression);
  if (root?.[1]) return Math.sqrt(term(root[1]));
  const binary = /^(\w+) ([*/]) (\w+)$/u.exec(expression);
  if (!binary?.[1] || !binary[2] || !binary[3]) throw new Error('Unsupported landing formula.');
  return binary[2] === '*' ? term(binary[1]) * term(binary[3]) : term(binary[1]) / term(binary[3]);
}

export function calculateDemo(values: Record<string, number>): number[] | null {
  for (const input of calculator.inputs) {
    const value = values[input.id];
    if (
      value === undefined ||
      !Number.isFinite(value) ||
      value < input.minimum ||
      value > input.maximum
    )
      return null;
  }
  const scope = { ...values };
  const results: number[] = [];
  for (const step of calculator.steps) {
    const value = evaluateDemoExpression(step.expression, scope);
    if (!Number.isFinite(value)) return null;
    scope[step.id] = value;
    results.push(value);
  }
  return results;
}

export function scoreDemo(answers: Record<string, number>) {
  const values = questionnaire.questions.map((question) => answers[question.id]);
  if (
    values.some((value) => !questionnaire.responseOptions.some((option) => option.value === value))
  )
    return null;
  const score = values.reduce<number>((sum, value) => sum + (value ?? 0), 0);
  return (
    questionnaire.interpretations.find(
      (band) => score >= band.minScore && score <= band.maxScore,
    ) ?? null
  );
}

export function matchesDemoQuery(text: string, query: string): boolean {
  const normalize = (value: string) => value.toLocaleLowerCase('ru').replaceAll('ё', 'е');
  const haystack = normalize(text);
  return normalize(query)
    .trim()
    .split(/\s+/u)
    .every((word) => haystack.includes(word));
}
