export function openCalculator(slug: string): void {
  window.location.hash = `#/calculators/${encodeURIComponent(slug)}`;
}
