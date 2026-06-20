export function getInternalAuthApiBase() {
  if (typeof window === "undefined") return "http://127.0.0.1:4310";
  const hostname = window.location.hostname;
  if (hostname === "localhost" || hostname === "127.0.0.1") {
    return `http://${hostname}:4310`;
  }
  return "http://127.0.0.1:4310";
}

function internalAuthUrl(path: string) {
  return `${getInternalAuthApiBase()}${path}`;
}

export type InternalAuthUser = {
  id: string;
  email: string;
  displayName: string;
  userType: string;
  status: string;
  roles: string[];
  permissions: string[];
};

export type InternalAuthSession = {
  expiresAt: string;
};

export type InternalAuthState = {
  authenticated: boolean;
  user: InternalAuthUser | null;
  session: InternalAuthSession | null;
};

export const unauthenticatedInternalState: InternalAuthState = {
  authenticated: false,
  user: null,
  session: null
};

type CurrentUserResponse = {
  authenticated?: boolean;
  user?: Partial<InternalAuthUser> | null;
  session?: Partial<InternalAuthSession> | null;
};

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return {};
  }
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function normalizeCurrentUser(value: unknown): InternalAuthState {
  const response = value as CurrentUserResponse;
  if (!response.authenticated || !response.user) return unauthenticatedInternalState;
  return {
    authenticated: true,
    user: {
      id: typeof response.user.id === "string" ? response.user.id : "",
      email: typeof response.user.email === "string" ? response.user.email : "",
      displayName: typeof response.user.displayName === "string" ? response.user.displayName : "",
      userType: typeof response.user.userType === "string" ? response.user.userType : "",
      status: typeof response.user.status === "string" ? response.user.status : "",
      roles: toStringArray(response.user.roles),
      permissions: toStringArray(response.user.permissions)
    },
    session: {
      expiresAt: typeof response.session?.expiresAt === "string" ? response.session.expiresAt : ""
    }
  };
}

export async function getCurrentInternalUser(): Promise<InternalAuthState> {
  try {
    const response = await fetch(internalAuthUrl("/api/business-auth/current-user"), {
      credentials: "include"
    });
    if (!response.ok) return unauthenticatedInternalState;
    return normalizeCurrentUser(await readJson(response));
  } catch {
    return unauthenticatedInternalState;
  }
}

export async function loginInternalUser(email: string, password: string): Promise<InternalAuthState> {
  const response = await fetch(internalAuthUrl("/api/business-auth/login"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ email, password })
  });
  if (!response.ok) {
    await readJson(response);
    throw new Error("Invalid email or password");
  }
  await readJson(response);
  return getCurrentInternalUser();
}

export async function logoutInternalUser(): Promise<void> {
  try {
    await fetch(internalAuthUrl("/api/business-auth/logout"), {
      method: "POST",
      credentials: "include"
    });
  } catch {
    // Logout should leave the frontend in a signed-out state even if the API is unavailable.
  }
}
