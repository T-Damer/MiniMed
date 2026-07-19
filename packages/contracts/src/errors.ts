export type LocalMedErrorCode =
  | 'DATABASE_UNAVAILABLE'
  | 'CONTENT_PACK_INCOMPATIBLE'
  | 'CONTENT_NOT_FOUND'
  | 'FTS5_UNAVAILABLE'
  | 'FEATURE_DISABLED'
  | 'INVALID_REQUEST'
  | 'MODEL_UNAVAILABLE'
  | 'UNKNOWN';

export interface LocalMedError {
  readonly code: LocalMedErrorCode;
  readonly message: string;
  readonly details?: Readonly<Record<string, unknown>>;
}

export function localMedError(
  code: LocalMedErrorCode,
  message: string,
  details?: Readonly<Record<string, unknown>>,
): LocalMedError {
  return details ? { code, message, details } : { code, message };
}
