/**
 * Force-directed layout for the knowledge graph on typed arrays, so it runs in a worker and
 * transfers positions. Forces, all O(n log n) or O(n) per step:
 * - many-body repulsion through a Barnes–Hut quadtree, its strength calibrated by the target
 *   spacing (canvas area per node), so density rather than node count sets the scale;
 * - links as ropes that only pull once longer than their rest length; a domain's rope grows with
 *   the square root of its degree so its documents fill a disc instead of one crowded ring. The
 *   primary area pulls harder than further areas, and each end moves in inverse proportion to its
 *   degree (as in d3-force), so hubs are not dragged onto their neighbours;
 * - a weak pull to the centroid of the node's group (its primary area) and pushes between group
 *   centroids closer than their estimated radii, so clusters stay apart;
 * - collisions on a uniform grid: two circles never come closer than r_i + r_j + gap.
 */

/** Repulsion at the reference spacing; scales with the square of the target spacing. */
const REPULSION = 900;
const REFERENCE_SPACING = 46;
const MIN_DISTANCE_SQUARED = 180;
const PRIMARY_LINK_STRENGTH = 0.25;
const SECONDARY_LINK_STRENGTH = 0.04;
const GROUP_PULL = 0.012;
const GROUP_PUSH = 0.25;
/** Extra clearance between the estimated discs of two groups, in target spacings. */
const GROUP_GAP_SPACINGS = 1.5;
const GRAVITY = 0.004;
const DAMPING = 0.6;
const COLLISION_STRENGTH = 0.7;
/** Collision passes per step, and projection passes once the simulation has cooled. */
const COLLISION_PASSES = 2;
const FINAL_COLLISION_PASSES = 40;
/** Cells whose size/distance falls below this are treated as a single mass. */
const THETA = 0.6;
/** Below this many nodes exact pairwise repulsion is cheaper than building a tree. */
const EXACT_REPULSION_LIMIT = 128;
/**
 * Cooling as in d3-force: forces are scaled by alpha, which decays to ALPHA_MIN in about 300
 * steps. Without it the tree approximation keeps a small jitter and the layout never settles.
 */
const ALPHA_DECAY = 0.0228;
const ALPHA_MIN = 0.001;
export const REHEAT_ALPHA = 0.3;
/** Mean per-node speed below which the layout is considered settled. */
export const SETTLED_ENERGY_PER_NODE = 0.002;
export const MAX_FORCE_ITERATIONS = 600;

export interface ForceLayoutInput {
  /** Interleaved x, y per node. */
  readonly positions: Float32Array;
  /** Interleaved from, to node indices per edge; the first edge of a node is its primary one. */
  readonly edges: Uint32Array;
  /** Drawn radius per node. */
  readonly radii: Float32Array;
  /** Group per node (its primary area), or -1. */
  readonly groups: Int32Array;
  /** Clear gap kept between node circles. */
  readonly gap: number;
  /** Preferred centre distance of neighbouring nodes, from the canvas area per node. */
  readonly spacing: number;
}

export interface ForceLayout {
  readonly positions: Float32Array;
  /** One simulation step; returns the mean speed per movable node. */
  step(): number;
  /** True once cooled down or below the settled speed. */
  settled(): boolean;
  /** Restarts cooling from at least `alpha` (e.g. after a node is dragged). */
  reheat(alpha?: number): void;
  /** Pushes overlapping circles apart without other forces; run once the layout has settled. */
  resolveCollisions(passes?: number): void;
  pin(index: number, x: number, y: number): void;
  unpin(index: number): void;
}

/** Array-backed quadtree rebuilt every step; cells store mass and center of mass. */
class QuadTree {
  private capacity = 0;
  private count = 0;
  private x0 = new Float64Array(0);
  private y0 = new Float64Array(0);
  private size = new Float64Array(0);
  private mass = new Float64Array(0);
  private cx = new Float64Array(0);
  private cy = new Float64Array(0);
  /** Body index for a leaf, -1 for an empty cell, -2 for an internal cell. */
  private body = new Int32Array(0);
  private firstChild = new Int32Array(0);

  private ensure(cells: number): void {
    if (cells <= this.capacity) return;
    const capacity = Math.max(cells, this.capacity * 2, 64);
    const grow = <T extends Float64Array | Int32Array>(old: T, make: (n: number) => T): T => {
      const next = make(capacity);
      next.set(old);
      return next;
    };
    this.x0 = grow(this.x0, (n) => new Float64Array(n));
    this.y0 = grow(this.y0, (n) => new Float64Array(n));
    this.size = grow(this.size, (n) => new Float64Array(n));
    this.mass = grow(this.mass, (n) => new Float64Array(n));
    this.cx = grow(this.cx, (n) => new Float64Array(n));
    this.cy = grow(this.cy, (n) => new Float64Array(n));
    this.body = grow(this.body, (n) => new Int32Array(n));
    this.firstChild = grow(this.firstChild, (n) => new Int32Array(n));
    this.capacity = capacity;
  }

  private cell(x0: number, y0: number, size: number): number {
    this.ensure(this.count + 1);
    const index = this.count;
    this.count += 1;
    this.x0[index] = x0;
    this.y0[index] = y0;
    this.size[index] = size;
    this.mass[index] = 0;
    this.cx[index] = 0;
    this.cy[index] = 0;
    this.body[index] = -1;
    this.firstChild[index] = -1;
    return index;
  }

  private split(index: number): void {
    const half = (this.size[index] ?? 0) / 2;
    const x0 = this.x0[index] ?? 0;
    const y0 = this.y0[index] ?? 0;
    const first = this.cell(x0, y0, half);
    this.cell(x0 + half, y0, half);
    this.cell(x0, y0 + half, half);
    this.cell(x0 + half, y0 + half, half);
    this.firstChild[index] = first;
  }

  private childFor(index: number, x: number, y: number): number {
    const half = (this.size[index] ?? 0) / 2;
    const right = x >= (this.x0[index] ?? 0) + half ? 1 : 0;
    const bottom = y >= (this.y0[index] ?? 0) + half ? 2 : 0;
    return (this.firstChild[index] ?? 0) + right + bottom;
  }

  build(positions: Float32Array, n: number): void {
    this.count = 0;
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < n; i += 1) {
      const x = positions[i * 2] ?? 0;
      const y = positions[i * 2 + 1] ?? 0;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
    const size = Math.max(maxX - minX, maxY - minY, 1) + 1;
    this.cell(minX, minY, size);
    for (let i = 0; i < n; i += 1)
      this.insert(i, positions[i * 2] ?? 0, positions[i * 2 + 1] ?? 0, positions);
  }

  private insert(bodyIndex: number, x: number, y: number, positions: Float32Array): void {
    let index = 0;
    for (let depth = 0; depth < 48; depth += 1) {
      const total = (this.mass[index] ?? 0) + 1;
      this.cx[index] = ((this.cx[index] ?? 0) * (total - 1) + x) / total;
      this.cy[index] = ((this.cy[index] ?? 0) * (total - 1) + y) / total;
      this.mass[index] = total;
      const occupant = this.body[index] ?? -1;
      if (occupant === -1 && total === 1) {
        this.body[index] = bodyIndex;
        return;
      }
      if (occupant >= 0) {
        // Leaf becomes internal: push its body one level down, then continue with ours.
        this.body[index] = -2;
        this.split(index);
        const ox = positions[occupant * 2] ?? 0;
        const oy = positions[occupant * 2 + 1] ?? 0;
        const child = this.childFor(index, ox, oy);
        this.mass[child] = 1;
        this.cx[child] = ox;
        this.cy[child] = oy;
        this.body[child] = occupant;
      }
      index = this.childFor(index, x, y);
    }
    // Coincident points beyond the depth limit stay aggregated in the deepest cell.
  }

  /** Accumulates unit-charge repulsion on one body into force[0..1]. */
  repulse(bodyIndex: number, x: number, y: number, force: Float64Array): void {
    force[0] = 0;
    force[1] = 0;
    const stack = [0];
    while (stack.length > 0) {
      const index = stack.pop() ?? 0;
      const mass = this.mass[index] ?? 0;
      if (mass === 0 || this.body[index] === bodyIndex) continue;
      const dx = (this.cx[index] ?? 0) - x;
      const dy = (this.cy[index] ?? 0) - y;
      const distanceSquared = Math.max(MIN_DISTANCE_SQUARED, dx * dx + dy * dy);
      const size = this.size[index] ?? 0;
      const leaf = (this.body[index] ?? -1) >= 0;
      if (leaf || (size * size) / distanceSquared < THETA * THETA) {
        const distance = Math.sqrt(distanceSquared);
        const magnitude = mass / distanceSquared;
        force[0] -= (dx / distance) * magnitude;
        force[1] -= (dy / distance) * magnitude;
        continue;
      }
      const first = this.firstChild[index] ?? -1;
      if (first < 0) continue;
      stack.push(first, first + 1, first + 2, first + 3);
    }
  }
}

export function createForceLayout(input: ForceLayoutInput): ForceLayout {
  const { positions, edges, radii, groups, gap } = input;
  const spacing = Math.max(1, input.spacing);
  const n = positions.length / 2;
  const velocity = new Float32Array(positions.length);
  const pinned = new Uint8Array(n);
  const tree = new QuadTree();
  const force = new Float64Array(2);
  const edgeCount = edges.length / 2;
  const charge = REPULSION * (spacing / REFERENCE_SPACING) ** 2;
  let alpha = 1;
  let lastEnergy = Number.POSITIVE_INFINITY;

  const degree = new Uint32Array(n);
  for (let e = 0; e < edgeCount; e += 1) {
    degree[edges[e * 2] ?? 0] = (degree[edges[e * 2] ?? 0] ?? 0) + 1;
    degree[edges[e * 2 + 1] ?? 0] = (degree[edges[e * 2 + 1] ?? 0] ?? 0) + 1;
  }
  const restLength = new Float32Array(edgeCount);
  const linkStrength = new Float32Array(edgeCount);
  const fromShare = new Float32Array(edgeCount);
  const seen = new Uint8Array(n);
  for (let e = 0; e < edgeCount; e += 1) {
    const from = edges[e * 2] ?? 0;
    const to = edges[e * 2 + 1] ?? 0;
    const fromDegree = degree[from] ?? 1;
    const toDegree = degree[to] ?? 1;
    const hubDegree = Math.max(fromDegree, toDegree);
    // A disc holding `hubDegree` nodes at the target spacing has radius spacing·√(degree/π).
    restLength[e] =
      (radii[from] ?? 0) + (radii[to] ?? 0) + gap + spacing * Math.sqrt(hubDegree / Math.PI);
    const primary = !seen[to];
    seen[to] = 1;
    linkStrength[e] = primary ? PRIMARY_LINK_STRENGTH : SECONDARY_LINK_STRENGTH;
    // The end with fewer links moves more.
    fromShare[e] = toDegree / (fromDegree + toDegree);
  }

  let groupCount = 0;
  for (let i = 0; i < n; i += 1) groupCount = Math.max(groupCount, (groups[i] ?? -1) + 1);
  const groupSize = new Float64Array(groupCount);
  for (let i = 0; i < n; i += 1) {
    const group = groups[i] ?? -1;
    if (group >= 0) groupSize[group] = (groupSize[group] ?? 0) + 1;
  }
  const groupRadius = new Float64Array(groupCount);
  for (let g = 0; g < groupCount; g += 1)
    groupRadius[g] = spacing * Math.sqrt((groupSize[g] ?? 0) / Math.PI);
  const groupX = new Float64Array(groupCount);
  const groupY = new Float64Array(groupCount);
  const groupShiftX = new Float64Array(groupCount);
  const groupShiftY = new Float64Array(groupCount);

  let maxRadius = 0;
  for (let i = 0; i < n; i += 1) maxRadius = Math.max(maxRadius, radii[i] ?? 0);
  const cellSize = Math.max(1, maxRadius * 2 + gap);
  const cellHead = new Map<number, number>();
  const cellNext = new Int32Array(n);
  const cellKey = (column: number, row: number): number => column * 73856093 + row * 19349663;

  const exactRepulsion = (index: number): void => {
    force[0] = 0;
    force[1] = 0;
    const x = positions[index * 2] ?? 0;
    const y = positions[index * 2 + 1] ?? 0;
    for (let other = 0; other < n; other += 1) {
      if (other === index) continue;
      const dx = (positions[other * 2] ?? 0) - x;
      const dy = (positions[other * 2 + 1] ?? 0) - y;
      const distanceSquared = Math.max(MIN_DISTANCE_SQUARED, dx * dx + dy * dy);
      const distance = Math.sqrt(distanceSquared);
      force[0] -= dx / distance / distanceSquared;
      force[1] -= dy / distance / distanceSquared;
    }
  };

  /** One position-projection pass: every overlapping pair moves apart, weighted by area. */
  const collide = (strength: number): void => {
    cellHead.clear();
    for (let i = 0; i < n; i += 1) {
      const key = cellKey(
        Math.floor((positions[i * 2] ?? 0) / cellSize),
        Math.floor((positions[i * 2 + 1] ?? 0) / cellSize),
      );
      cellNext[i] = cellHead.get(key) ?? -1;
      cellHead.set(key, i);
    }
    for (let i = 0; i < n; i += 1) {
      const column = Math.floor((positions[i * 2] ?? 0) / cellSize);
      const row = Math.floor((positions[i * 2 + 1] ?? 0) / cellSize);
      for (let dx = -1; dx <= 1; dx += 1) {
        for (let dy = -1; dy <= 1; dy += 1) {
          for (let j = cellHead.get(cellKey(column + dx, row + dy)) ?? -1; j >= 0; ) {
            if (j > i) {
              const minimum = (radii[i] ?? 0) + (radii[j] ?? 0) + gap;
              let ox = (positions[j * 2] ?? 0) - (positions[i * 2] ?? 0);
              let oy = (positions[j * 2 + 1] ?? 0) - (positions[i * 2 + 1] ?? 0);
              let distanceSquared = ox * ox + oy * oy;
              if (distanceSquared < minimum * minimum) {
                if (distanceSquared === 0) {
                  // Coincident: separate along a deterministic direction.
                  ox = Math.cos(i + j);
                  oy = Math.sin(i + j);
                  distanceSquared = 1;
                }
                const distance = Math.sqrt(distanceSquared);
                const push = ((minimum - distance) / distance) * strength;
                const areaI = (radii[i] ?? 1) ** 2;
                const areaJ = (radii[j] ?? 1) ** 2;
                let shareI = pinned[i] ? 0 : areaJ / (areaI + areaJ);
                let shareJ = pinned[j] ? 0 : areaI / (areaI + areaJ);
                if (shareI + shareJ === 0) {
                  j = cellNext[j] ?? -1;
                  continue;
                }
                const total = shareI + shareJ;
                shareI /= total;
                shareJ /= total;
                positions[i * 2] = (positions[i * 2] ?? 0) - ox * push * shareI;
                positions[i * 2 + 1] = (positions[i * 2 + 1] ?? 0) - oy * push * shareI;
                positions[j * 2] = (positions[j * 2] ?? 0) + ox * push * shareJ;
                positions[j * 2 + 1] = (positions[j * 2 + 1] ?? 0) + oy * push * shareJ;
              }
            }
            j = cellNext[j] ?? -1;
          }
        }
      }
    }
  };

  const groupForces = (): void => {
    if (groupCount === 0) return;
    groupX.fill(0);
    groupY.fill(0);
    for (let i = 0; i < n; i += 1) {
      const group = groups[i] ?? -1;
      if (group < 0) continue;
      groupX[group] = (groupX[group] ?? 0) + (positions[i * 2] ?? 0);
      groupY[group] = (groupY[group] ?? 0) + (positions[i * 2 + 1] ?? 0);
    }
    for (let g = 0; g < groupCount; g += 1) {
      const size = Math.max(1, groupSize[g] ?? 1);
      groupX[g] = (groupX[g] ?? 0) / size;
      groupY[g] = (groupY[g] ?? 0) / size;
    }
    groupShiftX.fill(0);
    groupShiftY.fill(0);
    const clearance = spacing * GROUP_GAP_SPACINGS;
    for (let a = 0; a < groupCount; a += 1) {
      for (let b = a + 1; b < groupCount; b += 1) {
        const dx = (groupX[b] ?? 0) - (groupX[a] ?? 0);
        const dy = (groupY[b] ?? 0) - (groupY[a] ?? 0);
        const desired = (groupRadius[a] ?? 0) + (groupRadius[b] ?? 0) + clearance;
        const distance = Math.max(1, Math.hypot(dx, dy));
        if (distance >= desired) continue;
        const push = ((desired - distance) / distance) * GROUP_PUSH * alpha;
        // The smaller group gives way more.
        const sizeA = groupSize[a] ?? 1;
        const sizeB = groupSize[b] ?? 1;
        const shareA = sizeB / (sizeA + sizeB);
        groupShiftX[a] = (groupShiftX[a] ?? 0) - dx * push * shareA;
        groupShiftY[a] = (groupShiftY[a] ?? 0) - dy * push * shareA;
        groupShiftX[b] = (groupShiftX[b] ?? 0) + dx * push * (1 - shareA);
        groupShiftY[b] = (groupShiftY[b] ?? 0) + dy * push * (1 - shareA);
      }
    }
    for (let i = 0; i < n; i += 1) {
      const group = groups[i] ?? -1;
      if (group < 0 || pinned[i]) continue;
      const pullX = ((groupX[group] ?? 0) - (positions[i * 2] ?? 0)) * GROUP_PULL * alpha;
      const pullY = ((groupY[group] ?? 0) - (positions[i * 2 + 1] ?? 0)) * GROUP_PULL * alpha;
      velocity[i * 2] = (velocity[i * 2] ?? 0) + pullX + (groupShiftX[group] ?? 0);
      velocity[i * 2 + 1] = (velocity[i * 2 + 1] ?? 0) + pullY + (groupShiftY[group] ?? 0);
    }
  };

  return {
    positions,
    settled() {
      return alpha <= ALPHA_MIN || lastEnergy < SETTLED_ENERGY_PER_NODE;
    },
    reheat(next = REHEAT_ALPHA) {
      alpha = Math.max(alpha, next);
      lastEnergy = Number.POSITIVE_INFINITY;
    },
    resolveCollisions(passes = FINAL_COLLISION_PASSES) {
      for (let pass = 0; pass < passes; pass += 1) collide(1);
    },
    pin(index, x, y) {
      if (index < 0 || index >= n) return;
      pinned[index] = 1;
      positions[index * 2] = x;
      positions[index * 2 + 1] = y;
      velocity[index * 2] = 0;
      velocity[index * 2 + 1] = 0;
    },
    unpin(index) {
      if (index >= 0 && index < n) pinned[index] = 0;
    },
    step() {
      if (n === 0) return 0;
      const exact = n <= EXACT_REPULSION_LIMIT;
      if (!exact) tree.build(positions, n);
      for (let i = 0; i < n; i += 1) {
        if (pinned[i]) continue;
        if (exact) exactRepulsion(i);
        else tree.repulse(i, positions[i * 2] ?? 0, positions[i * 2 + 1] ?? 0, force);
        velocity[i * 2] = (velocity[i * 2] ?? 0) + (force[0] ?? 0) * charge * alpha;
        velocity[i * 2 + 1] = (velocity[i * 2 + 1] ?? 0) + (force[1] ?? 0) * charge * alpha;
      }
      for (let e = 0; e < edgeCount; e += 1) {
        const from = edges[e * 2] ?? 0;
        const to = edges[e * 2 + 1] ?? 0;
        const dx =
          (positions[to * 2] ?? 0) +
          (velocity[to * 2] ?? 0) -
          (positions[from * 2] ?? 0) -
          (velocity[from * 2] ?? 0);
        const dy =
          (positions[to * 2 + 1] ?? 0) +
          (velocity[to * 2 + 1] ?? 0) -
          (positions[from * 2 + 1] ?? 0) -
          (velocity[from * 2 + 1] ?? 0);
        const distance = Math.max(1, Math.hypot(dx, dy));
        const rest = restLength[e] ?? 0;
        // A rope: slack inside its length, so collisions and repulsion arrange the disc.
        if (distance <= rest) continue;
        const pull = ((distance - rest) / distance) * (linkStrength[e] ?? 0) * alpha;
        const share = fromShare[e] ?? 0.5;
        if (!pinned[to]) {
          velocity[to * 2] = (velocity[to * 2] ?? 0) - dx * pull * (1 - share);
          velocity[to * 2 + 1] = (velocity[to * 2 + 1] ?? 0) - dy * pull * (1 - share);
        }
        if (!pinned[from]) {
          velocity[from * 2] = (velocity[from * 2] ?? 0) + dx * pull * share;
          velocity[from * 2 + 1] = (velocity[from * 2 + 1] ?? 0) + dy * pull * share;
        }
      }
      groupForces();
      let energy = 0;
      let movable = 0;
      for (let i = 0; i < n; i += 1) {
        if (pinned[i]) continue;
        movable += 1;
        const x = positions[i * 2] ?? 0;
        const y = positions[i * 2 + 1] ?? 0;
        const vx = ((velocity[i * 2] ?? 0) - x * GRAVITY * alpha) * DAMPING;
        const vy = ((velocity[i * 2 + 1] ?? 0) - y * GRAVITY * alpha) * DAMPING;
        velocity[i * 2] = vx;
        velocity[i * 2 + 1] = vy;
        positions[i * 2] = x + vx;
        positions[i * 2 + 1] = y + vy;
        energy += Math.abs(vx) + Math.abs(vy);
      }
      for (let pass = 0; pass < COLLISION_PASSES; pass += 1) collide(COLLISION_STRENGTH);
      alpha = Math.max(ALPHA_MIN, alpha * (1 - ALPHA_DECAY));
      lastEnergy = movable === 0 ? 0 : energy / movable;
      return lastEnergy;
    },
  };
}

/** Runs a layout to convergence or the iteration budget, then clears remaining overlaps. */
export function settleForceLayout(layout: ForceLayout, budget = MAX_FORCE_ITERATIONS): number {
  let iterations = budget;
  for (let iteration = 1; iteration <= budget; iteration += 1) {
    layout.step();
    if (layout.settled()) {
      iterations = iteration;
      break;
    }
  }
  layout.resolveCollisions();
  return iterations;
}

/** Share of node pairs, and of nodes, whose circles intersect. */
export function graphOverlap(
  positions: Float32Array,
  radii: Float32Array,
): { readonly pairs: number; readonly nodes: number } {
  const n = radii.length;
  if (n < 2) return { pairs: 0, nodes: 0 };
  let overlapping = 0;
  const touched = new Uint8Array(n);
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      const dx = (positions[i * 2] ?? 0) - (positions[j * 2] ?? 0);
      const dy = (positions[i * 2 + 1] ?? 0) - (positions[j * 2 + 1] ?? 0);
      const reach = (radii[i] ?? 0) + (radii[j] ?? 0);
      if (dx * dx + dy * dy < reach * reach) {
        overlapping += 1;
        touched[i] = 1;
        touched[j] = 1;
      }
    }
  }
  return {
    pairs: overlapping / ((n * (n - 1)) / 2),
    nodes: touched.reduce((sum, value) => sum + value, 0) / n,
  };
}
