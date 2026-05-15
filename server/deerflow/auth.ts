import type { DeerFlowRuntimeConfig } from "./config.js";

export type DeerFlowAuthState = "not_configured" | "setup_required" | "authenticated" | "auth_failed";

export type DeerFlowAuthStatus = {
  authState: DeerFlowAuthState;
  lastError?: string;
};

type DeerFlowSession = {
  cookieHeader: string;
  csrfToken?: string;
};

type AuthenticatedFetchInput = {
  config: DeerFlowRuntimeConfig;
  path: string;
  init?: RequestInit;
  fetchImpl?: typeof fetch;
};

const csrfHeaderName = "X-CSRF-Token";
let cachedSession: DeerFlowSession | undefined;

export async function getDeerFlowAuthStatus(input: {
  config: DeerFlowRuntimeConfig;
  fetchImpl?: typeof fetch;
}): Promise<DeerFlowAuthStatus> {
  try {
    await ensureDeerFlowSession(input.config, input.fetchImpl);
    return { authState: "authenticated" };
  } catch (error) {
    if (error instanceof DeerFlowAuthError) {
      return { authState: error.authState, lastError: error.message };
    }
    return { authState: "auth_failed", lastError: "Unable to authenticate with DeerFlow" };
  }
}

export async function authenticatedDeerFlowFetch(input: AuthenticatedFetchInput): Promise<Response> {
  const fetcher = input.fetchImpl ?? fetch;
  const firstSession = await ensureDeerFlowSession(input.config, fetcher);
  const firstResponse = await fetchWithSession(fetcher, input.config, input.path, input.init, firstSession);

  if (firstResponse.status !== 401 && firstResponse.status !== 403) {
    return firstResponse;
  }

  clearDeerFlowSession();
  const nextSession = await ensureDeerFlowSession(input.config, fetcher);
  return fetchWithSession(fetcher, input.config, input.path, input.init, nextSession);
}

export function clearDeerFlowSession() {
  cachedSession = undefined;
}

async function ensureDeerFlowSession(config: DeerFlowRuntimeConfig, fetchImpl: typeof fetch = fetch): Promise<DeerFlowSession> {
  if (cachedSession) return cachedSession;

  const auth = normalizeAuthConfig(config);
  const setupStatus = await readSetupStatus(config, auth.timeoutMs, fetchImpl);
  if (setupStatus.needsSetup) {
    if (!auth.email || !auth.password) {
      throw new DeerFlowAuthError("setup_required", "DeerFlow first-boot setup is required");
    }
    if (!auth.autoSetup) {
      throw new DeerFlowAuthError("setup_required", "DeerFlow first-boot setup is required");
    }
    cachedSession = await initializeAdmin(config, requireCredentials(auth), fetchImpl);
    return cachedSession;
  }

  if (!auth.email || !auth.password) {
    throw new DeerFlowAuthError("not_configured", "DeerFlow auth credentials are not configured");
  }

  cachedSession = await login(config, requireCredentials(auth), fetchImpl);
  return cachedSession;
}

async function fetchWithSession(fetchImpl: typeof fetch, config: DeerFlowRuntimeConfig, path: string, init: RequestInit | undefined, session: DeerFlowSession) {
  const headers = new Headers(init?.headers);
  headers.set("Cookie", session.cookieHeader);

  const method = (init?.method ?? "GET").toUpperCase();
  if (!["GET", "HEAD", "OPTIONS", "TRACE"].includes(method) && session.csrfToken) {
    headers.set(csrfHeaderName, session.csrfToken);
  }

  return fetchImpl(`${config.baseUrl}${path}`, {
    ...init,
    headers
  });
}

async function readSetupStatus(config: DeerFlowRuntimeConfig, timeoutMs: number, fetchImpl: typeof fetch): Promise<{ needsSetup: boolean }> {
  const response = await fetchWithTimeout(fetchImpl, `${config.baseUrl}/api/v1/auth/setup-status`, { method: "GET" }, timeoutMs);
  if (!response.ok) {
    throw new DeerFlowAuthError("auth_failed", `DeerFlow setup status returned HTTP ${response.status}`);
  }
  const payload = await response.json() as unknown;
  return { needsSetup: isRecord(payload) && payload.needs_setup === true };
}

async function initializeAdmin(config: DeerFlowRuntimeConfig, auth: AuthConfigWithCredentials, fetchImpl: typeof fetch): Promise<DeerFlowSession> {
  const response = await fetchWithTimeout(fetchImpl, `${config.baseUrl}/api/v1/auth/initialize`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: auth.email, password: auth.password })
  }, auth.timeoutMs);

  if (!response.ok) {
    throw new DeerFlowAuthError("auth_failed", `DeerFlow setup failed with HTTP ${response.status}`);
  }
  return readSession(response);
}

async function login(config: DeerFlowRuntimeConfig, auth: AuthConfigWithCredentials, fetchImpl: typeof fetch): Promise<DeerFlowSession> {
  const body = new URLSearchParams();
  body.set("username", auth.email);
  body.set("password", auth.password);

  const response = await fetchWithTimeout(fetchImpl, `${config.baseUrl}/api/v1/auth/login/local`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  }, auth.timeoutMs);

  if (!response.ok) {
    throw new DeerFlowAuthError("auth_failed", `DeerFlow login failed with HTTP ${response.status}`);
  }
  return readSession(response);
}

async function fetchWithTimeout(fetchImpl: typeof fetch, url: string, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new DeerFlowAuthError("auth_failed", "DeerFlow auth request timed out");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function readSession(response: Response): DeerFlowSession {
  const cookies = readSetCookieHeaders(response.headers);
  const accessToken = readCookieValue(cookies, "access_token");
  const csrfToken = readCookieValue(cookies, "csrf_token");
  if (!accessToken) {
    throw new DeerFlowAuthError("auth_failed", "DeerFlow auth response did not include a session cookie");
  }

  const cookieParts = [`access_token=${accessToken}`];
  if (csrfToken) cookieParts.push(`csrf_token=${csrfToken}`);
  return {
    cookieHeader: cookieParts.join("; "),
    csrfToken
  };
}

function readSetCookieHeaders(headers: Headers): string[] {
  const withGetSetCookie = headers as Headers & { getSetCookie?: () => string[] };
  const explicit = withGetSetCookie.getSetCookie?.();
  if (explicit?.length) return explicit;

  const raw = (headers as Headers & { raw?: () => Record<string, string[]> }).raw?.();
  if (raw?.["set-cookie"]?.length) return raw["set-cookie"];

  const header = headers.get("set-cookie");
  if (!header) return [];
  return header.split(/,(?=\s*[^;,]+=)/).map((value) => value.trim()).filter(Boolean);
}

function readCookieValue(setCookieHeaders: string[], name: string) {
  for (const cookie of setCookieHeaders) {
    const [pair] = cookie.split(";");
    const [cookieName, ...valueParts] = pair.split("=");
    if (cookieName.trim() === name) return valueParts.join("=").trim();
  }
  return undefined;
}

type AuthConfigWithOptionalCredentials = {
  email?: string;
  password?: string;
  autoSetup: boolean;
  timeoutMs: number;
};

type AuthConfigWithCredentials = {
  email: string;
  password: string;
  autoSetup: boolean;
  timeoutMs: number;
};

function normalizeAuthConfig(config: DeerFlowRuntimeConfig): AuthConfigWithOptionalCredentials {
  return {
    email: config.auth?.email,
    password: config.auth?.password,
    autoSetup: config.auth?.autoSetup ?? false,
    timeoutMs: config.auth?.timeoutMs ?? 5000
  };
}

function requireCredentials(auth: AuthConfigWithOptionalCredentials): AuthConfigWithCredentials {
  if (!auth.email || !auth.password) {
    throw new DeerFlowAuthError("not_configured", "DeerFlow auth credentials are not configured");
  }
  return {
    email: auth.email,
    password: auth.password,
    autoSetup: auth.autoSetup,
    timeoutMs: auth.timeoutMs
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

class DeerFlowAuthError extends Error {
  constructor(readonly authState: DeerFlowAuthState, message: string) {
    super(message);
    this.name = "DeerFlowAuthError";
  }
}
