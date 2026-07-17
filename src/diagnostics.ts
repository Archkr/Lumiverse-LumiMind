function credentialField(key: string): boolean {
  const normalized = key.replace(/[^a-z0-9]/gi, "").toLocaleLowerCase();
  return (normalized.endsWith("apikey") && !normalized.startsWith("has"))
    || normalized === "authorization"
    || normalized === "accesstoken"
    || normalized === "refreshtoken"
    || normalized === "authtoken"
    || normalized === "bearertoken"
    || normalized === "clientsecret"
    || normalized === "password";
}

export function redactDiagnosticCredentials(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactDiagnosticCredentials);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
    key,
    credentialField(key) ? "[REDACTED]" : redactDiagnosticCredentials(entry),
  ]));
}
