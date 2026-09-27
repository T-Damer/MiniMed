/** Node kinds as sent to the layout worker. */
export const GRAPH_KIND_DOMAIN = 0;
export const GRAPH_KIND_DOCUMENT = 1;

export type GraphLayoutMode = 'force' | 'grid';

export type GraphLayoutRequest =
  | {
      readonly type: 'start';
      readonly id: number;
      readonly mode: GraphLayoutMode;
      /** Interleaved x, y initial positions. */
      readonly positions: Float32Array;
      /** Interleaved domain→document node indices; a document's first edge is its primary area. */
      readonly edges: Uint32Array;
      readonly kinds: Uint8Array;
      /** Drawn radius per node. */
      readonly radii: Float32Array;
      /** Primary-area group per node, or -1. */
      readonly groups: Int32Array;
      /** Clear gap between node circles. */
      readonly gap: number;
      /** Preferred neighbour distance from the canvas area per node. */
      readonly spacing: number;
    }
  | {
      readonly type: 'pin';
      readonly id: number;
      readonly index: number;
      readonly x: number;
      readonly y: number;
    }
  | { readonly type: 'unpin'; readonly id: number; readonly index: number }
  | { readonly type: 'stop'; readonly id: number };

export interface GraphLayoutResponse {
  readonly type: 'positions';
  readonly id: number;
  readonly positions: Float32Array;
  /** No further updates until the next pin/start. */
  readonly settled: boolean;
  readonly iterations: number;
}
