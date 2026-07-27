import type {
  AnalyzeQueryRequest,
  LocalMedError,
  QueryAnalysis,
  Result,
  SearchRequest,
  SearchResponse,
} from '@localmed/contracts';

export type SearchWorkerRequest =
  | {
      readonly id: number;
      readonly contentBaseUrl: string;
      readonly method: 'analyzeQuery';
      readonly request: AnalyzeQueryRequest;
    }
  | {
      readonly id: number;
      readonly contentBaseUrl: string;
      readonly method: 'search';
      readonly request: SearchRequest;
    };

export type SearchWorkerResult =
  | Result<QueryAnalysis, LocalMedError>
  | Result<SearchResponse, LocalMedError>;

export type SearchWorkerResponse =
  | { readonly id: number; readonly result: SearchWorkerResult }
  | { readonly id: number; readonly error: string };
