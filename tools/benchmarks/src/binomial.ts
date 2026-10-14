// Binomial confidence intervals for the dose-rule precision tools (RX2).

/** Wilson score interval for `successes` of `n`, `z` = 1.96 for 95 %. */
export function wilson(successes: number, n: number, z = 1.96): { low: number; high: number } {
  if (n === 0) return { low: 0, high: 1 };
  const p = successes / n;
  const z2 = z * z;
  const centre = (p + z2 / (2 * n)) / (1 + z2 / n);
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / (1 + z2 / n);
  return { low: Math.max(0, centre - half), high: Math.min(1, centre + half) };
}

function logGamma(x: number): number {
  const coefficients = [
    76.1800917294715, -86.5053203294168, 24.0140982408309, -1.23173957245015, 0.120865097386618e-2,
    -0.539523938495e-5,
  ];
  let y = x;
  let tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  let series = 1.00000000019002;
  for (const coefficient of coefficients) {
    y += 1;
    series += coefficient / y;
  }
  return -tmp + Math.log((2.506628274631 * series) / x);
}

function betaContinuedFraction(a: number, b: number, x: number): number {
  const tiny = 1e-30;
  let c = 1;
  let d = 1 - ((a + b) * x) / (a + 1);
  if (Math.abs(d) < tiny) d = tiny;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 200; m += 1) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((a + m2 - 1) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < tiny) d = tiny;
    c = 1 + aa / c;
    if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (a + b + m) * x) / ((a + m2) * (a + m2 + 1));
    d = 1 + aa * d;
    if (Math.abs(d) < tiny) d = tiny;
    c = 1 + aa / c;
    if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    const delta = d * c;
    h *= delta;
    if (Math.abs(delta - 1) < 1e-12) break;
  }
  return h;
}

/** Regularised incomplete beta function I_x(a, b). */
export function incompleteBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const front = Math.exp(
    logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x),
  );
  return x < (a + 1) / (a + b + 2)
    ? (front * betaContinuedFraction(a, b, x)) / a
    : 1 - (front * betaContinuedFraction(b, a, 1 - x)) / b;
}

function betaQuantile(probability: number, a: number, b: number): number {
  let low = 0;
  let high = 1;
  for (let step = 0; step < 80; step += 1) {
    const middle = (low + high) / 2;
    if (incompleteBeta(middle, a, b) < probability) low = middle;
    else high = middle;
  }
  return (low + high) / 2;
}

/** Exact (Clopper–Pearson) interval for `successes` of `n` at confidence `1 − alpha`. */
export function clopperPearson(
  successes: number,
  n: number,
  alpha = 0.05,
): { low: number; high: number } {
  if (n === 0) return { low: 0, high: 1 };
  const low = successes === 0 ? 0 : betaQuantile(alpha / 2, successes, n - successes + 1);
  const high = successes === n ? 1 : betaQuantile(1 - alpha / 2, successes + 1, n - successes);
  return { low, high };
}

export function percent(value: number, digits = 1): string {
  return `${(value * 100).toFixed(digits)} %`;
}
