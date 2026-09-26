export async function loadClinicalSourceExcerptAssets(): Promise<readonly unknown[]> {
  const parts = await Promise.all([
    import('./clinical-source-excerpts-2026.09.21.part-01.json'),
    import('./clinical-source-excerpts-2026.09.21.part-02.json'),
    import('./clinical-source-excerpts-2026.09.21.part-03.json'),
    import('./clinical-source-excerpts-2026.09.21.part-04.json'),
    import('./clinical-source-excerpts-2026.09.21.part-05.json'),
  ]);
  return parts.map((part) => part.default);
}
