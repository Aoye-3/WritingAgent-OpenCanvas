export type SettingsWritePolicy = {
  allowed: boolean;
  reason?: string;
};

export function evaluateSettingsWritePolicy(env: NodeJS.ProcessEnv = process.env): SettingsWritePolicy {
  if (env.LOCAL_SETTINGS_WRITE_ENABLED === "true" || env.LOCAL_SETTINGS_WRITE_ENABLED === "1") {
    return { allowed: true };
  }

  if (env.NODE_ENV === "production") {
    return {
      allowed: false,
      reason: "Local settings writes are disabled in production. Configure provider secrets through the deployment environment."
    };
  }

  return { allowed: true };
}
