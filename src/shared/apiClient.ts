export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly details?: unknown
  ) {
    super(message);
    this.name = "ApiError";
  }
}

type RequestOptions = {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
};

export function apiGet<T>(url: string) {
  return apiRequest<T>(url);
}

export function apiPost<T>(url: string, body?: unknown) {
  return apiRequest<T>(url, { method: "POST", body });
}

export function apiPut<T>(url: string, body?: unknown) {
  return apiRequest<T>(url, { method: "PUT", body });
}

export function apiPatch<T>(url: string, body?: unknown) {
  return apiRequest<T>(url, { method: "PATCH", body });
}

export function apiDelete<T>(url: string) {
  return apiRequest<T>(url, { method: "DELETE" });
}

async function apiRequest<T>(url: string, options: RequestOptions = {}): Promise<T> {
  const response = await fetch(url, {
    method: options.method ?? "GET",
    headers: options.body === undefined ? undefined : { "Content-Type": "application/json" },
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });

  const payload = await readJson(response);
  if (!response.ok) {
    const errorPayload = readErrorPayload(payload);
    throw new ApiError(errorPayload.message || `Request failed with ${response.status}`, response.status, errorPayload.code, errorPayload.details);
  }

  return payload as T;
}

async function readJson(response: Response) {
  const text = await response.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ApiError("Response was not valid JSON", response.status);
  }
}

function readErrorPayload(payload: unknown) {
  if (payload && typeof payload === "object" && "error" in payload) {
    const error = (payload as { error?: unknown }).error;
    if (typeof error === "string") {
      return { message: error, code: undefined, details: undefined };
    }
    if (error && typeof error === "object") {
      const data = error as { message?: unknown; code?: unknown; details?: unknown };
      return {
        message: typeof data.message === "string" ? data.message : "",
        code: typeof data.code === "string" ? data.code : undefined,
        details: data.details
      };
    }
  }

  return { message: "", code: undefined, details: undefined };
}
