import { describe, expect, it } from 'vitest';
import {
  cosineInt8,
  embedPortableText,
  PORTABLE_HASH_PROFILE,
  PortableHashEmbedder,
  profilesCompatible,
} from '../src/index';
import golden from './portable-hash-golden.json';

describe('portable feature-hash embeddings', () => {
  it('matches the cross-language golden vectors', () => {
    for (const row of golden.rows) {
      const vector = embedPortableText(row.text);
      expect(vector.values).toEqual(row.values);
      expect(vector.norm).toBeCloseTo(row.norm, 10);
    }
  });

  it('is deterministic and emits the declared dimensions', () => {
    const first = embedPortableText('Ребёнок часто дышит и температурит');
    const second = embedPortableText('Ребенок часто дышит и температурит');
    expect(first).toEqual(second);
    expect(first.values).toHaveLength(PORTABLE_HASH_PROFILE.dimensions);
    expect(first.norm).toBeGreaterThan(0);
  });

  it('scores related surface forms above unrelated text', () => {
    const query = embedPortableText('боль справа внизу живота и рвота');
    const related = embedPortableText('боль в правой подвздошной области, тошнота и рвота');
    const unrelated = embedPortableText('кашель, тахипноэ и лихорадка');
    expect(cosineInt8(query.values, related.values)).toBeGreaterThan(
      cosineInt8(query.values, unrelated.values),
    );
  });

  it('exposes an asynchronous query embedder contract', async () => {
    const embedder = new PortableHashEmbedder();
    const vector = await embedder.embedQuery('лихорадка без очага и дизурия');
    expect(vector.profileId).toBe(embedder.profile.id);
  });

  it('requires exact profile compatibility', () => {
    expect(profilesCompatible(PORTABLE_HASH_PROFILE, { ...PORTABLE_HASH_PROFILE })).toBe(true);
    expect(
      profilesCompatible(PORTABLE_HASH_PROFILE, {
        ...PORTABLE_HASH_PROFILE,
        dimensions: 256,
      }),
    ).toBe(false);
  });
});
