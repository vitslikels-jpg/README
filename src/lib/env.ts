function getEnvValue(name: string) {
  const value = process.env[name];

  if (!value) {
    return "";
  }

  return value.trim();
}

export function getDatabaseUrl() {
  return getEnvValue("DATABASE_URL");
}

export function isDatabaseConfigured() {
  return Boolean(getDatabaseUrl());
}

export function getDatabaseSetupMessage() {
  return "DATABASE_URL is not configured. Copy .env.example to .env and set a working PostgreSQL connection string.";
}
