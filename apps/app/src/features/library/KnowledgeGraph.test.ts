import { describe, expect, it } from 'vitest';

import { graphDomainColor, graphToneForSourceType } from '@/features/library/graph-tones';
import {
  GRAPH_DOCUMENT_SPACING,
  GRAPH_NODE_GAP,
  graphNodeRadius,
  LARGE_GRAPH_NODE_LIMIT,
  layoutLargeKnowledgeGraph,
  shouldUseStaticKnowledgeGraphLayout,
} from '@/features/library/knowledge-graph-layout';

describe('KnowledgeGraph source tones', () => {
  it('keeps clinical, drugs, legal sources and notes visually distinct', () => {
    expect(graphToneForSourceType('clinical_recommendation')).toBe('clinical');
    expect(graphToneForSourceType('official_drug_instruction')).toBe('drug');
    expect(graphToneForSourceType('regulatory_act')).toBe('legal');
    expect(graphToneForSourceType('personal_note')).toBe('notes');
  });
});

describe('graph theme helpers', () => {
  it('uses darker domain fills in dark theme', () => {
    expect(graphDomainColor('pediatrics', false)).not.toBe(graphDomainColor('pediatrics', true));
  });
});

describe('large knowledge graph layout', () => {
  it('uses the static path above the bounded simulation size', () => {
    expect(shouldUseStaticKnowledgeGraphLayout(LARGE_GRAPH_NODE_LIMIT)).toBe(false);
    expect(shouldUseStaticKnowledgeGraphLayout(LARGE_GRAPH_NODE_LIMIT + 1)).toBe(true);
  });

  it('keeps grouped positions deterministic', () => {
    const makeNodes = () => [
      { id: 'domain:a', kind: 'domain' as const, documentId: null, x: 0, y: 0 },
      { id: 'domain:b', kind: 'domain' as const, documentId: null, x: 0, y: 0 },
      ...Array.from({ length: 5 }, (_, index) => ({
        id: `document:${index}`,
        kind: 'document' as const,
        documentId: String(index),
        x: 0,
        y: 0,
      })),
    ];
    const edges = Array.from({ length: 5 }, (_, index) => ({
      from: `domain:${index % 2 === 0 ? 'a' : 'b'}`,
      to: `document:${index}`,
    }));
    const first = makeNodes();
    const second = makeNodes();
    layoutLargeKnowledgeGraph(first, edges);
    layoutLargeKnowledgeGraph(second, edges);
    expect(first.map(({ x, y }) => [x, y])).toEqual(second.map(({ x, y }) => [x, y]));
  });

  it('lays out 20,000 documents without dropping nodes', () => {
    const nodes = Array.from({ length: 20_000 }, (_, index) => ({
      id: `document:${index}`,
      kind: 'document' as const,
      documentId: String(index),
      x: 0,
      y: 0,
    }));
    const domains = Array.from({ length: 8 }, (_, index) => ({
      id: `domain:${index}`,
      kind: 'domain' as const,
      documentId: null,
      x: 0,
      y: 0,
    }));
    const allNodes = [...domains, ...nodes];
    const edges = nodes.map((node, index) => ({
      from: `domain:${index % domains.length}`,
      to: node.id,
    }));

    const started = performance.now();
    const bounds = layoutLargeKnowledgeGraph(allNodes, edges);
    const elapsed = performance.now() - started;

    expect(allNodes).toHaveLength(20_008);
    expect(allNodes.every((node) => Number.isFinite(node.x) && Number.isFinite(node.y))).toBe(true);
    expect(new Set(nodes.map((node) => `${node.x}:${node.y}`)).size).toBe(nodes.length);
    expect(bounds.width).toBeGreaterThan(0);
    expect(bounds.height).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(1_000);
  });

  it('keeps every circle one gap clear of the others, areas in separate blocks', () => {
    const domains = Array.from({ length: 12 }, (_, index) => ({
      id: `domain:${index}`,
      kind: 'domain' as const,
      documentId: null,
      x: 0,
      y: 0,
    }));
    const documents = Array.from({ length: 700 }, (_, index) => ({
      id: `document:${index}`,
      kind: 'document' as const,
      documentId: String(index),
      x: 0,
      y: 0,
    }));
    // Uneven areas: area k holds about 1/(k+1) of the documents.
    const areaOf = (index: number) => Math.floor(domains.length * (index / documents.length) ** 2);
    const edges = documents.map((document, index) => ({
      from: `domain:${areaOf(index)}`,
      to: document.id,
    }));
    const nodes = [...domains, ...documents];
    layoutLargeKnowledgeGraph(nodes, edges);
    for (let i = 0; i < nodes.length; i += 1) {
      for (let j = i + 1; j < nodes.length; j += 1) {
        const a = nodes[i];
        const b = nodes[j];
        if (!a || !b) continue;
        const clearance = graphNodeRadius(a.kind) + graphNodeRadius(b.kind) + GRAPH_NODE_GAP;
        expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(clearance);
      }
    }
    // Documents of different areas are never grid neighbours.
    const box = (area: number) => {
      const members = documents.filter((_, index) => areaOf(index) === area);
      return {
        left: Math.min(...members.map((node) => node.x)),
        right: Math.max(...members.map((node) => node.x)),
        top: Math.min(...members.map((node) => node.y)),
        bottom: Math.max(...members.map((node) => node.y)),
      };
    };
    const used = [...new Set(documents.map((_, index) => areaOf(index)))];
    for (const first of used) {
      for (const second of used) {
        if (first >= second) continue;
        const a = box(first);
        const b = box(second);
        const apart =
          a.right + GRAPH_DOCUMENT_SPACING < b.left ||
          b.right + GRAPH_DOCUMENT_SPACING < a.left ||
          a.bottom + GRAPH_DOCUMENT_SPACING < b.top ||
          b.bottom + GRAPH_DOCUMENT_SPACING < a.top;
        expect(apart).toBe(true);
      }
    }
  });
});
