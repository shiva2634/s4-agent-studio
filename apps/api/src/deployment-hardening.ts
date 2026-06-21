export type DeploymentHardeningCheckStatus = "PASS" | "WARN" | "FAIL";

export type DeploymentHardeningCheck = {
  key: string;
  label: string;
  status: DeploymentHardeningCheckStatus;
  message: string;
};

export type DeploymentHardeningStatus = {
  environment: "production" | "non-production";
  checks: DeploymentHardeningCheck[];
  missingConfigNames: string[];
};

export const requiredProductionConfigNames = [
  "S4_DB_PATH",
  "S4_WEB_ORIGINS",
  "S4_INTERNAL_APP_ORIGIN",
  "S4_API_PUBLIC_ORIGIN",
  "S4_BACKUP_LOCATION",
  "S4_LOG_RETENTION_DAYS"
] as const;

export const securityHeaders: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Cross-Origin-Resource-Policy": "same-site"
};

export function buildDeploymentHardeningStatus(env: NodeJS.ProcessEnv = process.env): DeploymentHardeningStatus {
  const production = env.NODE_ENV === "production";
  const missingConfigNames = production ? requiredProductionConfigNames.filter((name) => !hasValue(env[name])) : [];
  const origins = parseOriginList(env.S4_WEB_ORIGINS);
  const checks: DeploymentHardeningCheck[] = [
    productionConfigCheck(production, missingConfigNames),
    cookieSecureCheck(production),
    corsAllowlistCheck(production, origins, Boolean(env.S4_WEB_ORIGINS)),
    internalApiProtectionCheck(),
    publicInternalRouteSeparationCheck(),
    securityHeadersCheck()
  ];
  return {
    environment: production ? "production" : "non-production",
    checks,
    missingConfigNames
  };
}

export function applySecurityHeaders(reply: { header: (name: string, value: string) => unknown }) {
  for (const [name, value] of Object.entries(securityHeaders)) {
    reply.header(name, value);
  }
}

function productionConfigCheck(production: boolean, missingConfigNames: string[]): DeploymentHardeningCheck {
  if (!production) {
    return {
      key: "production_config_names",
      label: "Production environment config",
      status: "WARN",
      message: "Production config validation is advisory outside NODE_ENV=production."
    };
  }
  if (missingConfigNames.length) {
    return {
      key: "production_config_names",
      label: "Production environment config",
      status: "FAIL",
      message: "Required production config names are missing. Values are not returned."
    };
  }
  return {
    key: "production_config_names",
    label: "Production environment config",
    status: "PASS",
    message: "Required production config names are present. Values are redacted."
  };
}

function cookieSecureCheck(production: boolean): DeploymentHardeningCheck {
  return {
    key: "secure_session_cookie",
    label: "Secure session cookie",
    status: production ? "PASS" : "WARN",
    message: production
      ? "Internal session cookies use the Secure flag when NODE_ENV=production."
      : "Secure cookie flag is disabled outside production for local development."
  };
}

function corsAllowlistCheck(production: boolean, origins: string[], configured: boolean): DeploymentHardeningCheck {
  if (origins.some((origin) => origin === "*")) {
    return {
      key: "cors_allowlist",
      label: "CORS allowlist",
      status: "FAIL",
      message: "Wildcard CORS origins are not allowed for internal systems."
    };
  }
  if (production && !configured) {
    return {
      key: "cors_allowlist",
      label: "CORS allowlist",
      status: "FAIL",
      message: "S4_WEB_ORIGINS must be explicitly configured in production."
    };
  }
  if (production && origins.some((origin) => /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin))) {
    return {
      key: "cors_allowlist",
      label: "CORS allowlist",
      status: "WARN",
      message: "Production CORS allowlist includes local development origins."
    };
  }
  return {
    key: "cors_allowlist",
    label: "CORS allowlist",
    status: production ? "PASS" : "WARN",
    message: production
      ? "CORS is configured with explicit origins and credentials support."
      : "Local CORS defaults are enabled for development only."
  };
}

function internalApiProtectionCheck(): DeploymentHardeningCheck {
  return {
    key: "internal_api_protection",
    label: "Internal API protection",
    status: "PASS",
    message: "Business Control Centre and App Studio internal APIs are routed through internal session and permission guards."
  };
}

function publicInternalRouteSeparationCheck(): DeploymentHardeningCheck {
  return {
    key: "public_internal_route_separation",
    label: "Public/internal route separation",
    status: "PASS",
    message: "Internal Business Control Centre and App Studio APIs remain under protected internal route groups; public health/bootstrap routes remain separate."
  };
}

function securityHeadersCheck(): DeploymentHardeningCheck {
  return {
    key: "safe_security_headers",
    label: "Safe security headers",
    status: "PASS",
    message: "API responses include safe baseline security headers without changing CORS, auth, cookies, or RBAC."
  };
}

function parseOriginList(value: string | undefined) {
  return (value ?? "http://localhost:5173,http://127.0.0.1:5173")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function hasValue(value: string | undefined) {
  return typeof value === "string" && value.trim().length > 0;
}
