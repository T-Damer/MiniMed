import type {
  UserLibraryMedicalAnnotationPoint,
  UserLibraryMedicalAnnotationStroke,
} from '@/state/user-library';

function squaredDistanceToSegment(
  point: UserLibraryMedicalAnnotationPoint,
  start: UserLibraryMedicalAnnotationPoint,
  end: UserLibraryMedicalAnnotationPoint,
): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (dx === 0 && dy === 0) return (point.x - start.x) ** 2 + (point.y - start.y) ** 2;
  const amount = Math.min(
    1,
    Math.max(0, ((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy)),
  );
  const x = start.x + amount * dx;
  const y = start.y + amount * dy;
  return (point.x - x) ** 2 + (point.y - y) ** 2;
}

export function eraseMedicalImageStrokes(
  strokes: readonly UserLibraryMedicalAnnotationStroke[],
  point: UserLibraryMedicalAnnotationPoint,
  tolerance: number,
): readonly UserLibraryMedicalAnnotationStroke[] {
  const toleranceSquared = tolerance ** 2;
  return strokes.filter((stroke) => {
    const first = stroke.points[0];
    if (!first) return false;
    if ((point.x - first.x) ** 2 + (point.y - first.y) ** 2 <= toleranceSquared) return false;
    for (let index = 1; index < stroke.points.length; index += 1) {
      const start = stroke.points[index - 1];
      const end = stroke.points[index];
      if (start && end && squaredDistanceToSegment(point, start, end) <= toleranceSquared) {
        return false;
      }
    }
    return true;
  });
}
