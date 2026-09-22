import type { SettingsManager } from "./settings-manager.ts";

function isTruthyEnvFlag(value: string | undefined): boolean {
	if (!value) return false;
	return value === "1" || value.toLowerCase() === "true" || value.toLowerCase() === "yes";
}

export function isInstallTelemetryEnabled(
	settingsManager: SettingsManager,
	telemetryEnv: string | undefined = process.env.BAILU_TELEMETRY,
): boolean {
	return telemetryEnv !== undefined ? isTruthyEnvFlag(telemetryEnv) : settingsManager.getEnableInstallTelemetry();
}

/**
 * bailu has no install-analytics backend of its own yet, so install/update pings are
 * disabled by default and only fire when a bailu-owned endpoint is configured with
 * BAILU_TELEMETRY_URL. Never point this at an upstream third party; the fork's traffic
 * belongs to the fork's channel.
 */
export function getInstallTelemetryEndpoint(): string | undefined {
	return process.env.BAILU_TELEMETRY_URL?.trim() || undefined;
}
