import type { Dirent } from "node:fs";
import { open, readdir, readFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import ignore from "ignore";
import { minimatch } from "minimatch";

/**
 * Pure-Node fallback search backend for the grep and find tools.
 *
 * Whenever ripgrep/fd are unavailable (not cached, not on PATH, offline, or a
 * download failed), the tools fall back to these implementations instead of
 * erroring. ripgrep/fd remain the primary path; this module only needs to be
 * good enough to keep the tools usable. It deliberately does not try to match
 * ripgrep's full PCRE2 dialect or fd's every option.
 */

export interface WalkEntry {
	/** Absolute path. */
	path: string;
	isDirectory: boolean;
}

/** Directories always skipped, matching the find tool's glob-operation ignore contract. */
const ALWAYS_SKIP_DIRS = new Set([".git", "node_modules"]);
const BINARY_SNIFF_BYTES = 8192;

type IgnoreMatcher = ReturnType<typeof ignore>;

/**
 * Build the gitignore matcher for a single directory from its own `.gitignore`.
 * Rules are anchored to `dir`, exactly like git's semantics for that file.
 * Returns undefined when the directory has no `.gitignore`.
 */
async function loadGitIgnoreMatcher(dir: string): Promise<IgnoreMatcher | undefined> {
	let content: string;
	try {
		content = await readFile(join(dir, ".gitignore"), "utf8");
	} catch {
		return undefined;
	}
	if (!content.trim()) return undefined;
	return ignore().add(content.split("\n"));
}

/**
 * Decide whether an entry is gitignored. Consults `.gitignore` matchers from the
 * entry's own directory upward, deepest first, mirroring git's last-match-wins
 * semantics across nested ignore files. `isDirectory` adds a trailing slash so
 * directory-only rules (e.g. `build/`) apply.
 */
function isGitIgnored(matchers: Map<string, IgnoreMatcher>, root: string, entryPath: string, isDir: boolean): boolean {
	let current = dirname(entryPath);
	while (true) {
		const matcher = matchers.get(current);
		if (matcher) {
			const rel = relative(current, entryPath);
			const candidate = isDir ? `${rel}/` : rel;
			const result = matcher.test(candidate);
			if (result.ignored || result.unignored) {
				return result.ignored;
			}
		}
		if (current === root) break;
		const parent = dirname(current);
		if (parent === current) break;
		current = parent;
	}
	return false;
}

/**
 * Recursively collect candidate paths under `searchPath` (files and directories),
 * excluding `.git`/`node_modules`, respecting nested `.gitignore` scoping, and
 * including hidden entries (aligning with fd's `--hidden`). Symbolic links are
 * yielded but not followed, matching fd's default. Results are sorted for
 * deterministic output.
 */
export async function walkCandidatePaths(
	searchPath: string,
	options: { signal?: AbortSignal } = {},
): Promise<WalkEntry[]> {
	const root = resolve(searchPath);
	const matchers = new Map<string, IgnoreMatcher>();
	const rootMatcher = await loadGitIgnoreMatcher(root);
	if (rootMatcher) matchers.set(root, rootMatcher);

	const results: WalkEntry[] = [];

	async function walk(dir: string): Promise<void> {
		options.signal?.throwIfAborted();
		let entries: Dirent[];
		try {
			entries = await readdir(dir, { withFileTypes: true });
		} catch {
			return; // Unreadable directory: skip it rather than failing the whole search.
		}
		const ownMatcher = await loadGitIgnoreMatcher(dir);
		if (ownMatcher) matchers.set(dir, ownMatcher);

		const sorted = [...entries].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
		for (const entry of sorted) {
			if (ALWAYS_SKIP_DIRS.has(entry.name)) continue;
			const absolute = join(dir, entry.name);
			const isDirectory = entry.isDirectory();
			const isSymlink = entry.isSymbolicLink();

			if (isGitIgnored(matchers, root, absolute, isDirectory)) continue;

			results.push({ path: absolute, isDirectory });

			if (isDirectory && !isSymlink) {
				await walk(absolute);
			}
		}
	}

	await walk(root);
	// Each directory's entries were already sorted; a global sort keeps output
	// stable regardless of directory traversal order.
	return results.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/** True when a glob pattern has an unclosed `[` character class (garbage globs). */
function hasUnbalancedBracket(pattern: string): boolean {
	let open = 0;
	let close = 0;
	let escaped = false;
	for (const ch of pattern) {
		if (escaped) {
			escaped = false;
			continue;
		}
		if (ch === "\\") {
			escaped = true;
			continue;
		}
		if (ch === "[") open++;
		else if (ch === "]") close++;
	}
	return open > close;
}

/**
 * Match a glob pattern with fd-compatible semantics:
 * - Patterns without `/` match against the basename at any depth (`*.spec.ts`).
 * - Patterns containing `/` match against the relative path, with a leading
 *   double-star slash prefix added unless already anchored — mirroring find.ts's
 *   fd full-path handling.
 */
export function matchesFindGlob(relPath: string, pattern: string): boolean {
	if (!pattern.includes("/")) {
		return minimatch(basename(relPath), pattern, { dot: true });
	}
	let effective = pattern;
	if (!pattern.startsWith("/") && !pattern.startsWith("**/") && pattern !== "**") {
		effective = `**/${pattern}`;
	}
	return minimatch(relPath, effective, { dot: true });
}

/** Returns true for malformed globs (e.g. an unclosed `[`), like fd's parse error. */
export function isMalformedGlob(pattern: string): boolean {
	return hasUnbalancedBracket(pattern);
}

/**
 * Pure-Node `find` implementation. Returns relative (posix) matches, files and
 * directories, sorted. Throws an `error parsing glob` error for malformed globs
 * so callers surface the same shape of failure as fd.
 */
export async function findWithFallback(
	searchPath: string,
	pattern: string,
	options: { limit?: number; signal?: AbortSignal } = {},
): Promise<string[]> {
	if (isMalformedGlob(pattern)) {
		throw new Error(`error parsing glob '${pattern}'`);
	}

	const limit = options.limit ?? Number.MAX_SAFE_INTEGER;
	const matches: string[] = [];
	const entries = await walkCandidatePaths(searchPath, options);
	for (const entry of entries) {
		if (matches.length >= limit) break;
		const rel = relative(searchPath, entry.path).split(sep).join("/");
		const candidate = entry.isDirectory ? `${rel}/` : rel;
		if (matchesFindGlob(candidate, pattern) || matchesFindGlob(rel, pattern)) {
			matches.push(rel);
		}
	}
	return matches;
}

export interface GrepMatch {
	filePath: string;
	lineNumber: number;
	lineText?: string;
}

export interface GrepFallbackOptions {
	pattern: string;
	literal?: boolean;
	ignoreCase?: boolean;
	glob?: string;
	limit: number;
	signal?: AbortSignal;
}

export interface GrepFallbackResult {
	matches: GrepMatch[];
	matchLimitReached: boolean;
}

/** Escape a string for use inside a RegExp, used for literal (fixed-string) search. */
function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Guess whether a file is binary by sniffing its first bytes for a NUL byte. */
async function isProbablyBinary(filePath: string): Promise<boolean> {
	try {
		const handle = await open(filePath, "r");
		try {
			const buffer = Buffer.alloc(BINARY_SNIFF_BYTES);
			const { bytesRead } = await handle.read(buffer, 0, BINARY_SNIFF_BYTES, 0);
			return buffer.subarray(0, bytesRead).includes(0);
		} finally {
			await handle.close();
		}
	} catch {
		return false;
	}
}

/**
 * Pure-Node `grep` implementation. Searches a single file or all files under a
 * directory, skipping binaries and gitignored paths, honoring `literal` /
 * `ignoreCase` / `glob`, and stopping at `limit`. Match semantics follow JS
 * RegExp rather than ripgrep's PCRE2; this is an intentional floor.
 */
export async function grepSearchFallback(
	searchPath: string,
	isDirectory: boolean,
	options: GrepFallbackOptions,
): Promise<GrepFallbackResult> {
	const flags = ["u", "m", ...(options.ignoreCase ? ["i"] : [])].join("");
	const source = options.literal ? escapeRegExp(options.pattern) : options.pattern;
	let regex: RegExp;
	try {
		regex = new RegExp(source, flags);
	} catch (error: unknown) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(`error parsing regex: ${message}`);
	}

	const matches: GrepMatch[] = [];
	let matchLimitReached = false;

	async function searchFile(filePath: string): Promise<void> {
		if ((await isProbablyBinary(filePath)) || matches.length >= options.limit) return;
		let content: string;
		try {
			content = await readFile(filePath, "utf8");
		} catch {
			return;
		}
		const lines = content.split("\n");
		for (let i = 0; i < lines.length && matches.length < options.limit; i++) {
			if (regex.test(lines[i] as string)) {
				matches.push({ filePath, lineNumber: i + 1, lineText: lines[i] as string });
				if (matches.length >= options.limit) {
					matchLimitReached = true;
					return;
				}
			}
		}
	}

	if (!isDirectory) {
		await searchFile(searchPath);
	} else {
		const entries = await walkCandidatePaths(searchPath, options);
		for (const entry of entries) {
			if (entry.isDirectory) continue;
			if (options.glob) {
				const rel = relative(searchPath, entry.path).split(sep).join("/");
				if (
					!minimatch(rel, options.glob, { dot: true }) &&
					!minimatch(basename(entry.path), options.glob, { dot: true })
				) {
					continue;
				}
			}
			await searchFile(entry.path);
			if (matchLimitReached) break;
		}
	}

	return { matches, matchLimitReached };
}
