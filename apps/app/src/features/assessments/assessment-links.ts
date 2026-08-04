export function openAssessment(slug: string): void {
  window.location.hash = `#/assessments/${encodeURIComponent(slug)}`;
}
