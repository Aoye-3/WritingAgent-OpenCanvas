import type { AgentBackendRuntimeConfig } from "./config.js";

export type AgentBackendAuthState = "not_configured" | "setup_required" | "authenticated" | "auth_failed";

export type AgentBackendAuthStatus = {
  authState: AgentBackendAuthState;
  lastError?: string;
};

type AgentBackendSession = {
  cookieHeader: string;
  csrfToken?: string;
};

type AuthenticatedFetchInput = {
  config: AgentBackendRuntimeConfig;
  path: string;
  init?: RequestInit;
  fetchImpl?: typeof fetch;
};

const csrfHeaderName = "X-CSRF-Token";
let cachedSession: AgentBackendSession | undefined;
let pendingSession: Promise<AgentBackendSession> | undefined;

export async function getAgentBackendAuthStatus(input: {
  config: AgentBackendRuntimeConfig;
  fetchImpl?: typeof fetch;
}): Promise<AgentBackendAuthStatus> {
  try {
    await ensureAgentBackendSession(input.config, input.fetchImpl);
    return { authState: "authenticated" };
  } catch (error) {
    if (error instanceof AgentBackendAuthError) {
      return { authState: error.authState, lastError: error.message };
    }
    return { authState: "auth_failed", lastError: "Unable to authenticate with AgentBackend" };
  }
}

export async function authenticatedAgentBackendFetch(input: AuthenticatedFetchInput): Promise<Response> {
  const fetcher = input.fetchImpl ?? fetch;
  const firstSession = await ensureAgentBackendSession(input.config, fetcher);
  const firstResponse = await fetchWithSession(fetcher, input.config, input.path, input.init, firstSession);

  if (firstResponse.status !== 401 && firstResponse.status !== 403) {
    return firstResponse;
  }

  clearAgentBackendSession();
  const nextSession = await ensureAgentBackendSession(input.config, fetcher);
  return fetchWithSession(fetcher, input.config, input.path, input.init, nextSession);
}

export function clearAgentBackendSession() {
  cachedSession = undefined;
  pendingSession = undefined;
}

async function ensureAgentBackendSession(config: AgentBackendRuntimeConfig, fetchImpl: typeof fetch = fetch): Promise<AgentBackendSession> {
  if (cachedSession) return cachedSession;
  if (pendingSession) return pendingSession;

  pendingSession = createAgentBackendSession(config, fetchImpl);
  try {
    cachedSession = await pendingSession;
    return cachedSession;
  } finally {
    pendingSession = undefined;
  }
}

async function createAgentBackendSession(config: AgentBackendRuntimeConfig, fetchImpl: typeof fetch): Promise<AgentBackendSession> {
  const auth = normalizeAuthConfig(config);
  const setupStatus = await readSetupStatus(config, auth.timeoutMs, fetchImpl);
  if (setupStatus.needsSetup) {
    if (!auth.email || !auth.password) {
      throw new AgentBackendAuthError("setup_required", "AgentBackend first-boot setup is required");
    }
    if (!auth.autoSetup) {
      throw new AgentBackendAuthError("setup_required", "AgentBackend first-boot setup is required");
    }
    return initializeAdmin(config, requireCredentials(auth), fetchImpl);
  }

  if (!auth.email || !auth.password) {
    throw new AgentBackendAuthError("not_configured", "AgentBackend auth credentials are not configured");
  }

  if (setupStatus.rateLimited) {
    return login(config, requireCredentials(auth), fetchImpl);
  }

  return login(config, requireCredentials(auth), fetchImpl);
}

async function fetchWithSession(fetchImpl: typeof fetch, config: AgentBackendRuntimeConfig, path: string, init: RequestInit | undefined, session: AgentBackendSession) {
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

async function readSetupStatus(config: AgentBackendRuntimeConfig, timeoutMs: number, fetchImpl: typeof fetch): Promise<{ needsSetup: boolean; rateLimited?: boolean }> {
  const response = await fetchWithTimeout(fetchImpl, `${config.baseUrl}/api/v1/auth/setup-status`, { method: "GET" }, timeoutMs);
  if (response.status === 429) {
    return { needsSetup: false, rateLimited: true };
  }
  if (!response.ok) {
    throw new AgentBackendAuthError("auth_failed", `AgentBackend setup status returned HTTP ${response.status}`);
  }
  const payload = await response.json() as unknown;
  return { needsSetup: isRecord(payload) && payload.needs_setup === true };
}

async function initializeAdmin(config: AgentBackendRuntimeConfig, auth: AuthConfigWithCredentials, fetchImpl: typeof fetch): Promise<AgentBackendSession> {
  const response = await fetchWithTimeout(fetchImpl, `${config.baseUrl}/api/v1/auth/initialize`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: auth.email, password: auth.password })
  }, auth.timeoutMs);

  if (!response.ok) {
    throw new AgentBackendAuthError("auth_failed", `AgentBackend setup failed with HTTP ${response.status}`);
  }
  return readSession(response);
}

async function login(config: AgentBackendRuntimeConfig, auth: AuthConfigWithCredentials, fetchImpl: typeof fetch): Promise<AgentBackendSession> {
  const body = new URLSearchParams();
  body.set("username", auth.email);
  body.set("password", auth.password);

  const response = await fetchWithTimeout(fetchImpl, `${config.baseUrl}/api/v1/auth/login/local`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  }, auth.timeoutMs);

  if (!response.ok) {
    throw new AgentBackendAuthError("auth_failed", `AgentBackend login failed with HTTP ${response.status}`);
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
      throw new AgentBackendAuthError("auth_failed", "AgentBackend auth request timed out");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function readSession(response: Response): AgentBackendSession {
  const cookies = readSetCookieHeaders(response.headers);
  const accessToken = readCookieValue(cookies, "access_token");
  const csrfToken = readCookieValue(cookies, "csrf_token");
  if (!accessToken) {
    throw new AgentBackendAuthError("auth_failed", "AgentBackend auth response did not include a session cookie");
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

function normalizeAuthConfig(config: AgentBackendRuntimeConfig): AuthConfigWithOptionalCredentials {
  return {
    email: config.auth?.email,
    password: config.auth?.password,
    autoSetup: config.auth?.autoSetup ?? false,
    timeoutMs: config.auth?.timeoutMs ?? 5000
  };
}

function requireCredentials(auth: AuthConfigWithOptionalCredentials): AuthConfigWithCredentials {
  if (!auth.email || !auth.password) {
    throw new AgentBackendAuthError("not_configured", "AgentBackend auth credentials are not configured");
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

class AgentBackendAuthError extends Error {
  constructor(readonly authState: AgentBackendAuthState, message: string) {
    super(message);
    this.name = "AgentBackendAuthError";
  }
}
