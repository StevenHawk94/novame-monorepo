/**
 * @novame/api-client/error
 *
 * Unified error type for all ApiClient failures. Wraps three failure
 * modes that fetch + JSON.parse exposes inconsistently:
 *
 *   1. HTTP non-2xx with parsable JSON body
 *      → kind='http', status=N, body=parsed object
 *   2. HTTP non-2xx with non-JSON body (e.g. HTML 404 page from Vercel)
 *      → kind='http', status=N, body=raw text
 *   3. Network failure (DNS, timeout, offline)
 *      → kind='network', cause=original Error
 *
 * Consumers can:
 *   try { await apiClient.get(...) }
 *   catch (e) {
 *     if (e instanceof ApiError && e.kind === 'http' && e.status === 404) { ... }
 *   }
 */

export type ApiErrorKind = 'http' | 'network'

export class ApiError extends Error {
  kind: ApiErrorKind
  status?: number
  body?: unknown
  override cause?: Error

  constructor(args: {
    kind: ApiErrorKind
    message: string
    status?: number
    body?: unknown
    cause?: Error
  }) {
    super(args.message)
    this.name = 'ApiError'
    this.kind = args.kind
    this.status = args.status
    this.body = args.body
    this.cause = args.cause
  }

  /** Is this a 4xx error? */
  isClientError(): boolean {
    return this.kind === 'http' && this.status !== undefined && this.status >= 400 && this.status < 500
  }

  /** Is this a 5xx error? */
  isServerError(): boolean {
    return this.kind === 'http' && this.status !== undefined && this.status >= 500
  }

  /** Is this a network/connectivity error (not an HTTP response)? */
  isNetworkError(): boolean {
    return this.kind === 'network'
  }
}
