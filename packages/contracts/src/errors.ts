export const errorCodes = [
  "VALIDATION_ERROR", "UNAUTHENTICATED", "FORBIDDEN", "NOT_FOUND", "CONFLICT", "INVALID_STATE_TRANSITION",
  "IDEMPOTENCY_CONFLICT", "CONFIGURATION_REQUIRED", "CREDENTIAL_INVALID", "EXTERNAL_TIMEOUT", "EXTERNAL_UNAVAILABLE",
  "RESOURCE_UNAVAILABLE", "RATE_LIMITED", "NOT_IMPLEMENTED", "INTERNAL_ERROR"
] as const;
export type ErrorCode = (typeof errorCodes)[number];

export interface ApiError {
  error: { code: ErrorCode; message: string; requestId: string; details?: Record<string, string | number | boolean>; retryable: boolean };
}

export const errorStatus: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 400, UNAUTHENTICATED: 401, FORBIDDEN: 403, NOT_FOUND: 404, CONFLICT: 409,
  INVALID_STATE_TRANSITION: 409, IDEMPOTENCY_CONFLICT: 409, CONFIGURATION_REQUIRED: 422, CREDENTIAL_INVALID: 422,
  EXTERNAL_TIMEOUT: 504, EXTERNAL_UNAVAILABLE: 503, RESOURCE_UNAVAILABLE: 422, RATE_LIMITED: 429,
  NOT_IMPLEMENTED: 501, INTERNAL_ERROR: 500
};

export class AppError extends Error {
  constructor(public readonly code: ErrorCode, message: string, public readonly retryable = false, public readonly details?: Record<string, string | number | boolean>) {
    super(message); this.name = "AppError";
  }
  toBody(requestId: string): ApiError {
    return { error: { code: this.code, message: this.message, requestId, retryable: this.retryable, ...(this.details ? { details: this.details } : {}) } };
  }
}

