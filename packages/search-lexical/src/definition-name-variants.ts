/** Bounded spelling candidates for one normalized name, not clinical aliases or fuzzy codes. */
export function definitionNameTranspositions(name: string): readonly string[] {
  if (!/^(?:[а-я]{6,48}|[a-z]{6,48})$/u.test(name)) return [];
  const variants = new Set<string>();
  for (let index = 0; index + 1 < name.length; index += 1) {
    if (name[index] === name[index + 1]) continue;
    variants.add(name.slice(0, index) + name[index + 1] + name[index] + name.slice(index + 2));
  }
  return [...variants];
}
