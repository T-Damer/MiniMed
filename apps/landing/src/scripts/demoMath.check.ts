import { strict as assert } from 'node:assert';
import clinical from '../../../../content/tool-modules/core-clinical.json';
import obstetrics from '../../../../content/tool-modules/obstetrics-gynecology.json';
import {
  calculateDemo,
  calculator,
  evaluateDemoExpression,
  matchesDemoQuery,
  questionnaire,
  scoreDemo,
} from './demoMath';

assert.deepEqual(
  calculator,
  clinical.tools.find((tool) => tool.slug === calculator.slug)?.definition,
);
assert.deepEqual(
  questionnaire,
  obstetrics.tools.find((tool) => tool.slug === questionnaire.slug)?.definition,
);
assert.deepEqual(calculateDemo({ heightCm: 180, weightKg: 80 }), [14400, 4, 2]);
assert.ok(Math.abs((calculateDemo({ heightCm: 170, weightKg: 65 })?.[2] ?? 0) - 1.752) < 0.001);
for (const heightCm of [Number.NaN, Number.POSITIVE_INFINITY, 0, 261])
  assert.equal(calculateDemo({ heightCm, weightKg: 70 }), null);
assert.equal(calculateDemo({ heightCm: 170, weightKg: 0 }), null);
assert.throws(() => evaluateDemoExpression('alert(1)', {}));
const ids = questionnaire.questions.map((question) => question.id);
assert.ok(ids[0] && ids[1]);
assert.equal(scoreDemo({}), null);
assert.equal(scoreDemo({ [ids[0]]: 0 }), null);
assert.equal(scoreDemo({ [ids[0]]: 0, [ids[1]]: 0 })?.minScore, 0);
for (const values of [
  [0, 1],
  [1, 0],
  [1, 1],
])
  assert.equal(scoreDemo({ [ids[0]]: values[0] ?? 0, [ids[1]]: values[1] ?? 0 })?.minScore, 1);
assert.equal(scoreDemo({ [ids[0]]: 9, [ids[1]]: 0 }), null);
assert.equal(matchesDemoQuery('пневмония дети', '  ПНЕВМОНИЯ дети '), true);
assert.equal(matchesDemoQuery('осмотр ребенка', 'ребёнка'), true);
assert.equal(matchesDemoQuery('пневмония дети', 'цефтриаксон'), false);
assert.equal(matchesDemoQuery('пневмония дети', ''), true);
