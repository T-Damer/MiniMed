/*
 * Standalone WebAssembly lexical distance kernels for @localmed/search-lexical.
 *
 * Implements exact bit-parallel Myers (1999) Levenshtein and Hyyrö (2003) OSA
 * (Optimal String Alignment) over UTF-16 code units using native 64-bit WASM i64
 * arithmetic (zero heap allocations per comparison), plus a length-pruned batch
 * top-K extractor (`extract_top_u16`) that scans tens of thousands of medication
 * names in a single JS->WASM call.
 *
 * Compile with:
 *   emcc -O3 -s STANDALONE_WASM=1 --no-entry -s ALLOW_MEMORY_GROWTH=1 \
 *     -s INITIAL_MEMORY=2097152 -s MAXIMUM_MEMORY=67108864 \
 *     -s EXPORTED_FUNCTIONS='["_malloc","_free","_osa_distance_u16","_levenshtein_distance_u16","_extract_top_u16"]' \
 *     packages/search-lexical/wasm/lexical_kernels.c -o packages/search-lexical/wasm/lexical_kernels.wasm
 */

#include <stdint.h>
#include <stdlib.h>
#include <string.h>

#define PEQ_SLOTS 128u
#define PEQ_MASK (PEQ_SLOTS - 1u)

typedef struct {
  uint16_t keys[PEQ_SLOTS];
  uint8_t used[PEQ_SLOTS];
  uint64_t masks[PEQ_SLOTS];
  uint32_t len;
  uint64_t vp0;
  uint64_t hi_mask;
} PeqTable;

static inline uint32_t hash_u16(uint16_t ch) {
  return ((uint32_t)ch * 2654435761u) >> 25;
}

static inline void peq_init(PeqTable *t, const uint16_t *pat, uint32_t m) {
  memset(t->used, 0, sizeof(t->used));
  t->len = m;
  t->vp0 = (m == 0u) ? 0ull : (m == 64u ? ~0ull : ((1ull << m) - 1ull));
  t->hi_mask = (m == 0u) ? 0ull : (1ull << (m - 1u));
  for (uint32_t i = 0u; i < m; i++) {
    uint16_t ch = pat[i];
    uint32_t slot = hash_u16(ch) & PEQ_MASK;
    while (t->used[slot] && t->keys[slot] != ch) {
      slot = (slot + 1u) & PEQ_MASK;
    }
    if (!t->used[slot]) {
      t->used[slot] = 1u;
      t->keys[slot] = ch;
      t->masks[slot] = 1ull << i;
    } else {
      t->masks[slot] |= (1ull << i);
    }
  }
}

static inline uint64_t peq_lookup(const PeqTable *t, uint16_t ch) {
  uint32_t slot = hash_u16(ch) & PEQ_MASK;
  while (t->used[slot]) {
    if (t->keys[slot] == ch) return t->masks[slot];
    slot = (slot + 1u) & PEQ_MASK;
  }
  return 0ull;
}

static inline uint32_t levenshtein_bitparallel(const PeqTable *t, const uint16_t *b, uint32_t n) {
  uint32_t m = t->len;
  if (m == 0u) return n;
  uint64_t vp = t->vp0;
  uint64_t vn = 0ull;
  uint32_t score = m;
  uint64_t mask = t->hi_mask;
  for (uint32_t j = 0u; j < n; j++) {
    uint64_t eq = peq_lookup(t, b[j]);
    uint64_t xv = eq | vn;
    uint64_t xh = (((eq & vp) + vp) ^ vp) | eq;
    uint64_t ph = vn | ~(xh | vp);
    uint64_t mh = vp & xh;
    if (ph & mask) score++;
    if (mh & mask) score--;
    ph = (ph << 1) | 1ull;
    mh = mh << 1;
    vp = mh | ~(xv | ph);
    vn = ph & xv;
  }
  return score;
}

static inline uint32_t osa_bitparallel(const PeqTable *t, const uint16_t *b, uint32_t n) {
  uint32_t m = t->len;
  if (m == 0u) return n;
  uint64_t vp = t->vp0;
  uint64_t vn = 0ull;
  uint64_t d0 = 0ull;
  uint64_t peq_prev = 0ull;
  uint32_t score = m;
  uint64_t mask = t->hi_mask;
  for (uint32_t j = 0u; j < n; j++) {
    uint64_t peq_char = peq_lookup(t, b[j]);
    uint64_t transposed = (((~d0) & peq_char) << 1) & peq_prev;
    uint64_t d0h = ((((peq_char & vp) + vp) ^ vp) | peq_char | vn) | transposed;
    uint64_t ph = vn | ~(d0h | vp);
    uint64_t mh = d0h & vp;
    if (ph & mask) score++;
    if (mh & mask) score--;
    ph = (ph << 1) | 1ull;
    mh = mh << 1;
    vp = mh | ~(d0h | ph);
    vn = ph & d0h;
    d0 = d0h;
    peq_prev = peq_char;
  }
  return score;
}

static uint32_t levenshtein_dp(const uint16_t *a, uint32_t m, const uint16_t *b, uint32_t n) {
  if (m == 0u) return n;
  if (n == 0u) return m;
  uint32_t *prev = (uint32_t *)malloc((size_t)(n + 1u) * sizeof(uint32_t));
  uint32_t *curr = (uint32_t *)malloc((size_t)(n + 1u) * sizeof(uint32_t));
  if (!prev || !curr) {
    free(prev);
    free(curr);
    return m > n ? m : n;
  }
  for (uint32_t j = 0u; j <= n; j++) prev[j] = j;
  for (uint32_t i = 1u; i <= m; i++) {
    curr[0] = i;
    uint16_t ca = a[i - 1u];
    for (uint32_t j = 1u; j <= n; j++) {
      uint32_t cost = (ca == b[j - 1u]) ? 0u : 1u;
      uint32_t del = prev[j] + 1u;
      uint32_t ins = curr[j - 1u] + 1u;
      uint32_t sub = prev[j - 1u] + cost;
      uint32_t v = del < ins ? del : ins;
      curr[j] = v < sub ? v : sub;
    }
    uint32_t *tmp = prev;
    prev = curr;
    curr = tmp;
  }
  uint32_t res = prev[n];
  free(prev);
  free(curr);
  return res;
}

static uint32_t osa_dp(const uint16_t *a, uint32_t m, const uint16_t *b, uint32_t n) {
  if (m == 0u) return n;
  if (n == 0u) return m;
  uint32_t *two_back = (uint32_t *)malloc((size_t)(n + 1u) * sizeof(uint32_t));
  uint32_t *one_back = (uint32_t *)malloc((size_t)(n + 1u) * sizeof(uint32_t));
  uint32_t *curr = (uint32_t *)malloc((size_t)(n + 1u) * sizeof(uint32_t));
  if (!two_back || !one_back || !curr) {
    free(two_back);
    free(one_back);
    free(curr);
    return m > n ? m : n;
  }
  for (uint32_t j = 0u; j <= n; j++) one_back[j] = j;
  for (uint32_t i = 1u; i <= m; i++) {
    curr[0] = i;
    uint16_t ca = a[i - 1u];
    for (uint32_t j = 1u; j <= n; j++) {
      uint32_t cost = (ca == b[j - 1u]) ? 0u : 1u;
      uint32_t del = one_back[j] + 1u;
      uint32_t ins = curr[j - 1u] + 1u;
      uint32_t sub = one_back[j - 1u] + cost;
      uint32_t v = del < ins ? del : ins;
      if (sub < v) v = sub;
      if (i > 1u && j > 1u && ca == b[j - 2u] && a[i - 2u] == b[j - 1u]) {
        uint32_t tr = two_back[j - 2u] + 1u;
        if (tr < v) v = tr;
      }
      curr[j] = v;
    }
    uint32_t *tmp = two_back;
    two_back = one_back;
    one_back = curr;
    curr = tmp;
  }
  uint32_t res = one_back[n];
  free(two_back);
  free(one_back);
  free(curr);
  return res;
}

uint32_t levenshtein_distance_u16(
  const uint16_t *a,
  uint32_t a_len,
  const uint16_t *b,
  uint32_t b_len
) {
  if (a_len <= 64u) {
    PeqTable t;
    peq_init(&t, a, a_len);
    return levenshtein_bitparallel(&t, b, b_len);
  }
  if (b_len <= 64u) {
    PeqTable t;
    peq_init(&t, b, b_len);
    return levenshtein_bitparallel(&t, a, a_len);
  }
  return levenshtein_dp(a, a_len, b, b_len);
}

uint32_t osa_distance_u16(
  const uint16_t *a,
  uint32_t a_len,
  const uint16_t *b,
  uint32_t b_len
) {
  if (a_len <= 64u) {
    PeqTable t;
    peq_init(&t, a, a_len);
    return osa_bitparallel(&t, b, b_len);
  }
  if (b_len <= 64u) {
    PeqTable t;
    peq_init(&t, b, b_len);
    return osa_bitparallel(&t, a, a_len);
  }
  return osa_dp(a, a_len, b, b_len);
}

typedef struct {
  uint32_t index;
  double score;
} HeapEntry;

static inline int is_worse(HeapEntry a, HeapEntry b) {
  return (a.score < b.score) || (a.score == b.score && a.index > b.index);
}

static inline void sift_up(HeapEntry *heap, uint32_t start) {
  uint32_t i = start;
  while (i > 0u) {
    uint32_t parent = (i - 1u) >> 1;
    if (!is_worse(heap[i], heap[parent])) break;
    HeapEntry tmp = heap[parent];
    heap[parent] = heap[i];
    heap[i] = tmp;
    i = parent;
  }
}

static inline void sift_down(HeapEntry *heap, uint32_t size, uint32_t start) {
  uint32_t i = start;
  for (;;) {
    uint32_t left = (i << 1) + 1u;
    uint32_t right = left + 1u;
    uint32_t worst = i;
    if (left < size && is_worse(heap[left], heap[worst])) worst = left;
    if (right < size && is_worse(heap[right], heap[worst])) worst = right;
    if (worst == i) break;
    HeapEntry tmp = heap[i];
    heap[i] = heap[worst];
    heap[worst] = tmp;
    i = worst;
  }
}

/*
 * Batch top-K extraction over a packed UTF-16 choice buffer.
 * metric: 0 = OSA normalizedSimilarity, 1 = Levenshtein normalizedSimilarity.
 * Returns the number of matches written to out_indices/out_scores (sorted best-first).
 */
uint32_t extract_top_u16(
  const uint16_t *query,
  uint32_t query_len,
  const uint16_t *choices_buf,
  const uint32_t *offsets,
  const uint32_t *lengths,
  uint32_t num_choices,
  double score_cutoff,
  uint32_t limit,
  uint32_t metric,
  uint32_t *out_indices,
  double *out_scores
) {
  if (limit == 0u || num_choices == 0u) return 0u;
  uint32_t cap = limit < num_choices ? limit : num_choices;
  HeapEntry *heap = (HeapEntry *)malloc((size_t)cap * sizeof(HeapEntry));
  if (!heap) return 0u;
  uint32_t heap_size = 0u;

  PeqTable t;
  int use_bp = (query_len <= 64u);
  if (use_bp) peq_init(&t, query, query_len);

  for (uint32_t idx = 0u; idx < num_choices; idx++) {
    uint32_t len = lengths[idx];
    uint32_t max_len = query_len > len ? query_len : len;
    double value;
    if (max_len == 0u) {
      value = 1.0;
    } else {
      /* Exact length-difference lower bound: distance >= |query_len - len|. */
      uint32_t diff = query_len > len ? (query_len - len) : (len - query_len);
      double upper_bound = 1.0 - ((double)diff / (double)max_len);
      double floor_score = score_cutoff;
      if (heap_size == cap && heap[0].score > floor_score) floor_score = heap[0].score;
      if (upper_bound < floor_score) continue;

      const uint16_t *choice = choices_buf + offsets[idx];
      uint32_t dist;
      if (use_bp) {
        dist = (metric == 0u) ? osa_bitparallel(&t, choice, len) : levenshtein_bitparallel(&t, choice, len);
      } else {
        dist = (metric == 0u) ? osa_distance_u16(query, query_len, choice, len)
                              : levenshtein_distance_u16(query, query_len, choice, len);
      }
      value = 1.0 - ((double)dist / (double)max_len);
    }

    if (value < score_cutoff) continue;
    HeapEntry cand;
    cand.index = idx;
    cand.score = value;
    if (heap_size < cap) {
      heap[heap_size] = cand;
      sift_up(heap, heap_size);
      heap_size++;
    } else if (is_worse(heap[0], cand)) {
      heap[0] = cand;
      sift_down(heap, heap_size, 0u);
    }
  }

  /* Sort heap entries descending by score, ascending by index (insertion sort: cap is tiny). */
  for (uint32_t i = 1u; i < heap_size; i++) {
    HeapEntry key = heap[i];
    uint32_t j = i;
    while (j > 0u && is_worse(heap[j - 1u], key)) {
      heap[j] = heap[j - 1u];
      j--;
    }
    heap[j] = key;
  }

  for (uint32_t i = 0u; i < heap_size; i++) {
    out_indices[i] = heap[i].index;
    out_scores[i] = heap[i].score;
  }
  free(heap);
  return heap_size;
}
