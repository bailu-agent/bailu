import { compare, valid } from "semver";
import { getBailuUserAgent } from "./bailu-user-agent.ts";
import { fetchWithRetry } from "./management-http.ts";

/**
 * bailu's own latest-version source. bailu is published on npm as @bailu/coding-agent,
 * so the update check points at this fork's registry entry rather than upstream pi.
 * Until the package's first release is published (or BAILU_LATEST_VERSION_URL is set),
 * the lookup yields no update and the startup banner stays silent.
 *
 * Override with BAILU_LATEST_VERSION_URL to point at a custom endpoint, expecting a
 * JSON object with a `version` string and optional `name`/`packageName` and `note`.
 */
const DEFAULT_LATEST_VERSION_URL = "https://registry.npmjs.org/@bailu/coding-agent/latest";
const DEFAULT_VERSION_CHECK_TIMEOUT_MS = 10000;

function getLatestVersionUrl(): string {
	const override = process.env.BAILU_LATEST_VERSION_URL?.trim();
	return override || DEFAULT_LATEST_VERSION_URL;
}

export interface LatestBailuRelease {
	version: string;
	packageName?: string;
	note?: string;
}

/** Include useful errno details hidden behind Node's generic "fetch failed" error. */
export function formatVersionCheckError(error: unknown): string {
	const rootMessage = error instanceof Error && error.message ? error.message : String(error);
	const cause = error instanceof Error ? error.cause : undefined;
	const causes = cause instanceof AggregateError ? cause.errors : cause === undefined ? [] : [cause];
	const codes = causes
		.map((value) =>
			typeof value === "object" && value !== null && "code" in value && typeof value.code === "string"
				? value.code
				: undefined,
		)
		.filter((code): code is string => code !== undefined);

	if (codes.length > 0) return `${rootMessage} (${[...new Set(codes)].join(", ")})`;
	const causeMessage = causes.find(
		(value): value is Error => value instanceof Error && Boolean(value.message),
	)?.message;
	return causeMessage ? `${rootMessage} (cause: ${causeMessage})` : rootMessage;
}

export function comparePackageVersions(leftVersion: string, rightVersion: string): number | undefined {
	const left = valid(leftVersion.trim());
	const right = valid(rightVersion.trim());
	if (!left || !right) {
		return undefined;
	}
	return compare(left, right);
}

export function isNewerPackageVersion(candidateVersion: string, currentVersion: string): boolean {
	const comparison = comparePackageVersions(candidateVersion, currentVersion);
	if (comparison !== undefined) {
		return comparison > 0;
	}
	return candidateVersion.trim() !== currentVersion.trim();
}

export async function getLatestBailuRelease(
	currentVersion: string,
	options: { timeoutMs?: number; retry?: boolean } = {},
): Promise<LatestBailuRelease | undefined> {
	if (process.env.BAILU_OFFLINE) return undefined;

	const response = await fetchWithRetry(
		getLatestVersionUrl(),
		{
			headers: {
				"User-Agent": getBailuUserAgent(currentVersion),
				accept: "application/json",
			},
		},
		{
			maxRetries: options.retry ? 2 : 0,
			timeoutMs: options.timeoutMs ?? DEFAULT_VERSION_CHECK_TIMEOUT_MS,
		},
	);
	if (!response.ok) return undefined;

	const data = (await response.json()) as {
		name?: unknown;
		packageName?: unknown;
		version?: unknown;
		note?: unknown;
	};
	if (typeof data.version !== "string" || !data.version.trim()) {
		return undefined;
	}
	const explicitPackageName =
		typeof data.packageName === "string" && data.packageName.trim() ? data.packageName.trim() : undefined;
	const declaredName = typeof data.name === "string" && data.name.trim() ? data.name.trim() : undefined;
	const packageName = explicitPackageName ?? declaredName;
	const note = typeof data.note === "string" && data.note.trim() ? data.note.trim() : undefined;
	return {
		version: data.version.trim(),
		...(packageName ? { packageName } : {}),
		...(note ? { note } : {}),
	};
}

export async function getLatestBailuVersion(
	currentVersion: string,
	options: { timeoutMs?: number; retry?: boolean } = {},
): Promise<string | undefined> {
	return (await getLatestBailuRelease(currentVersion, options))?.version;
}

export async function checkForNewBailuVersion(currentVersion: string): Promise<LatestBailuRelease | undefined> {
	if (process.env.BAILU_SKIP_VERSION_CHECK) return undefined;

	try {
		const latestRelease = await getLatestBailuRelease(currentVersion);
		if (latestRelease && isNewerPackageVersion(latestRelease.version, currentVersion)) {
			return latestRelease;
		}
		return undefined;
	} catch {
		return undefined;
	}
}
