import {
  type ApiErrorBody,
  ERROR_MESSAGES_JA,
  ERROR_STATUS,
  type ErrorCode,
} from '@coto2ba/contracts'
import type { ContentfulStatusCode } from 'hono/utils/http-status'

export class AppError extends Error {
  readonly code: ErrorCode
  readonly status: ContentfulStatusCode

  constructor(code: ErrorCode, message?: string) {
    super(message ?? ERROR_MESSAGES_JA[code])
    this.name = 'AppError'
    this.code = code
    this.status = ERROR_STATUS[code] as ContentfulStatusCode
  }

  toBody(): ApiErrorBody {
    return { code: this.code, message: this.message }
  }
}

export function appError(code: ErrorCode, message?: string): AppError {
  return new AppError(code, message)
}
