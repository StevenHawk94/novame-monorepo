/**
 * @novame/api-client
 *
 * Unified HTTP client for NovaMe. Single source of truth for:
 *   - request construction (baseUrl + auth header injection)
 *   - response parsing (JSON-first with HTML/text fallback)
 *   - error normalization (everything throws ApiError)
 *
 * Usage:
 *
 *   import { ApiClient } from '@novame/api-client'
 *
 *   const apiClient = new ApiClient({
 *     baseUrl: '',                              // same-origin (admin)
 *     getToken: async () => null,               // admin uses cookie session
 *   })
 *
 *   try {
 *     const data = await apiClient.get<{ users: User[] }>('/api/admin/users')
 *   } catch (e) {
 *     if (e instanceof ApiError) { ... }
 *   }
 */

import { ApiError } from './error'

export { ApiError } from './error'
export type { ApiErrorKind } from './error'

export type ApiClientConfig = {
  /** Base URL prepended to every path. Use '' for same-origin. */
  baseUrl: string
  /** Async token getter. Return null if no auth header should be sent. */
  getToken?: () => Promise<string | null>
  /** Stable identity generation, not the rotating token. Optional for public/admin clients. */
  getRequestContext?: () => { key: string; actorId?: string }
  /** Build-time capabilities, never an authentication/authorization grant. */
  headers?: Record<string,string>
}

export type RequestOptions = {
  /** Extra headers to merge into the request. */
  headers?: Record<string, string>
  /** AbortSignal to cancel the request. */
  signal?: AbortSignal
}

export class ApiClient {
  private readonly baseUrl: string
  private readonly getToken?: () => Promise<string | null>
  private readonly getRequestContext?: ApiClientConfig['getRequestContext']
  private readonly headers: Record<string,string>

  constructor(config: ApiClientConfig) {
    this.baseUrl = config.baseUrl
    this.getToken = config.getToken
    this.getRequestContext = config.getRequestContext
    this.headers = { ...config.headers }
  }

  /**
   * Low-level request method. Use this for non-JSON bodies (FormData) or
   * when you need full control over the request shape.
   */
  async request<T>(
    method: string,
    path: string,
    body?: unknown,
    options?: RequestOptions,
  ): Promise<T> {
    const context = this.getRequestContext?.()
    const assertCurrent = () => {
      const latest = this.getRequestContext?.()
      if (context && (!latest || latest.key !== context.key || latest.actorId !== context.actorId)) throw new Error('session_changed')
      if (options?.signal?.aborted) throw new Error('request_aborted')
    }
    const url = this.baseUrl + path
    const headers: Record<string, string> = { ...this.headers, ...(options?.headers ?? {}) }

    let requestBody: BodyInit | undefined
    if (body !== undefined && body !== null) {
      if (body instanceof FormData) {
        // Let fetch set Content-Type with the multipart boundary
        requestBody = body
      } else {
        headers['Content-Type'] = headers['Content-Type'] ?? 'application/json'
        requestBody = JSON.stringify(body)
      }
    }

    if (this.getToken) {
      const token = await this.getToken()
      if (token) {
        headers['Authorization'] = `Bearer ${token}`
      }
    }
    assertCurrent()
    if (context?.actorId) headers['X-Burrow-Actor'] = context.actorId

    let res: Response
    try {
      res = await fetch(url, {
        method,
        headers,
        body: requestBody,
        signal: options?.signal,
      })
    } catch (err) {
      throw new ApiError({
        kind: 'network',
        message: `Network request failed: ${method} ${url}`,
        cause: err instanceof Error ? err : new Error(String(err)),
      })
    }

    // Parse body — try JSON, fall back to text. Ignore parse failures on
    // empty bodies (some 204 responses).
    const rawText = await res.text()
    assertCurrent()
    let parsedBody: unknown = rawText
    if (rawText.length > 0) {
      try {
        parsedBody = JSON.parse(rawText)
      } catch {
        // body is not JSON (e.g. HTML 404 page) — keep as string
      }
    }

    if (!res.ok) {
      throw new ApiError({
        kind: 'http',
        status: res.status,
        message: `HTTP ${res.status} ${res.statusText} on ${method} ${url}`,
        body: parsedBody,
      })
    }

    return parsedBody as T
  }

  get<T>(path: string, options?: RequestOptions): Promise<T> {
    return this.request<T>('GET', path, undefined, options)
  }

  post<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return this.request<T>('POST', path, body, options)
  }

  patch<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return this.request<T>('PATCH', path, body, options)
  }

  put<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return this.request<T>('PUT', path, body, options)
  }

  delete<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return this.request<T>('DELETE', path, body, options)
  }
}
