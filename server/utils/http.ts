import type { Response } from "express";

export type ApiErrorCode =
  | "bad_request"
  | "not_found"
  | "internal_error"
  | "validation_failed";

export function sendOk<T>(response: Response, payload: T) {
  response.json(payload);
}

export function sendError(response: Response, status: number, code: ApiErrorCode, message: string, details?: unknown) {
  response.status(status).json({
    error: {
      code,
      message,
      details
    }
  });
}

export function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}
