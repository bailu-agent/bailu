import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFindToolDefinition } from "../src/core/tools/find.ts";
import { createGrepToolDefinition } from "../src/core/tools/grep.ts";
import {
	findWithFallback,
	grepSearchFallback,
	isMalformedGlob,
	matchesFindGlob,
	walkCandidatePaths,
} from "../src/core/tools/search-fallback.ts";

// Force the tools onto the pure-Node backend for the integration describe below,
// even when ripgrep/fd are cached on this machine. The unit tests above import the
// fallback functions directly and are unaffected by this mock.
vi.mock("../src/utils/tools-manager.ts", async (importOriginal) => {
	const original = await importOriginal<typeof import("../src/utils/tools-manager.ts")>();
	return { ...original, ensureTool: async () => undefined };
});

let tempRoot: string;

beforeEach(() => {
	tempRoot = mkdtempSync(join(tmpdir(), "bailu-search-fallback-"));
});

afterEach(() => {
	rmSync(tempRoot, { recursive: true, force: true });
});

async function runFind(pattern: string, options: { limit?: number } = {}): Promise<string[]> {
	return findWithFallback(tempRoot, pattern, options);
}

describe("find fallback glob semantics", () => {
	beforeEach(() => {
		mkdirSync(join(tempRoot, "some", "parent", "child"), { recursive: true });
		mkdirSync(join(tempRoot, "src", "foo", "bar"), { recursive: true });
		writeFileSync(join(tempRoot, "some", "parent", "child", "file.ext"), "");
		writeFileSync(join(tempRoot, "some", "parent", "child", "test.spec.ts"), "");
		writeFileSync(join(tempRoot, "src", "foo", "bar", "example.spec.ts"), "");
	});

	it("matches a basename glob at any depth", async () => {
		const files = (await runFind("*.spec.ts")).sort();
		expect(files).toEqual(["some/parent/child/test.spec.ts", "src/foo/bar/example.spec.ts"]);
	});

	it("matches a directory-prefixed pattern with a ** tail", async () => {
		const files = await runFind("some/parent/child/**");
		expect(files).toContain("some/parent/child/file.ext");
		expect(files).toContain("some/parent/child/test.spec.ts");
	});

	it("matches a leading ** wildcard with path segments", async () => {
		const files = await runFind("**/parent/child/*");
		expect(files).toContain("some/parent/child/file.ext");
		expect(files).toContain("some/parent/child/test.spec.ts");
	});

	it("matches src/**/*.spec.ts exactly", async () => {
		expect(await runFind("src/**/*.spec.ts")).toEqual(["src/foo/bar/example.spec.ts"]);
	});
});

describe("find fallback hidden and ignored paths", () => {
	it("includes hidden files but always skips .git and node_modules", async () => {
		mkdirSync(join(tempRoot, ".secret"));
		writeFileSync(join(tempRoot, ".secret", "hidden.txt"), "");
		writeFileSync(join(tempRoot, "visible.txt"), "");
		mkdirSync(join(tempRoot, "node_modules"));
		writeFileSync(join(tempRoot, "node_modules", "dep.txt"), "");
		mkdirSync(join(tempRoot, ".git"));
		writeFileSync(join(tempRoot, ".git", "config"), "");

		const files = await runFind("**");
		expect(files).toContain(".secret/hidden.txt");
		expect(files).toContain("visible.txt");
		expect(files).not.toContain("node_modules/dep.txt");
		expect(files).not.toContain(".git/config");
	});

	it("scopes nested .gitignore rules to their own subtree", async () => {
		mkdirSync(join(tempRoot, "a", "deep"), { recursive: true });
		mkdirSync(join(tempRoot, "b"), { recursive: true });
		writeFileSync(join(tempRoot, "a", ".gitignore"), "ignored.txt\n");
		writeFileSync(join(tempRoot, "a", "deep", ".gitignore"), "secret.txt\n");
		writeFileSync(join(tempRoot, "a", "ignored.txt"), "");
		writeFileSync(join(tempRoot, "a", "kept.txt"), "");
		writeFileSync(join(tempRoot, "a", "deep", "ignored.txt"), "");
		writeFileSync(join(tempRoot, "a", "deep", "secret.txt"), "");
		writeFileSync(join(tempRoot, "a", "deep", "kept.txt"), "");
		writeFileSync(join(tempRoot, "b", "ignored.txt"), "");
		writeFileSync(join(tempRoot, "b", "kept.txt"), "");
		writeFileSync(join(tempRoot, "root.txt"), "");

		const files = (await runFind("**/*.txt")).sort();
		expect(files).toEqual(["a/deep/kept.txt", "a/kept.txt", "b/ignored.txt", "b/kept.txt", "root.txt"]);
	});

	it("honors a root gitignore even outside a git repository", async () => {
		writeFileSync(join(tempRoot, ".gitignore"), "ignored.txt\n");
		writeFileSync(join(tempRoot, "ignored.txt"), "");
		writeFileSync(join(tempRoot, "kept.txt"), "");
		const files = await runFind("**/*.txt");
		expect(files).toEqual(["kept.txt"]);
	});

	it("rejects malformed globs with an fd-shaped parse error", async () => {
		expect(isMalformedGlob("[")).toBe(true);
		expect(isMalformedGlob("a[bc]d")).toBe(false);
		await expect(runFind("[")).rejects.toThrow(/error parsing glob/);
	});

	it("respects the result limit", async () => {
		for (let i = 0; i < 5; i++) writeFileSync(join(tempRoot, `f${i}.txt`), "");
		const files = await runFind("**", { limit: 2 });
		expect(files.length).toBe(2);
	});
});

describe("matchesFindGlob edge semantics", () => {
	it("treats patterns without a slash as basename matches at any depth", () => {
		expect(matchesFindGlob("a/b/test.spec.ts", "*.spec.ts")).toBe(true);
		expect(matchesFindGlob("a/b/readme.md", "*.spec.ts")).toBe(false);
	});

	it("anchors slash patterns with a ** prefix", () => {
		expect(matchesFindGlob("src/foo/bar/example.spec.ts", "src/**/*.spec.ts")).toBe(true);
		expect(matchesFindGlob("other/example.spec.ts", "src/**/*.spec.ts")).toBe(false);
	});
});

describe("grep fallback matching", () => {
	it("searches a single file and reports line numbers", async () => {
		const file = join(tempRoot, "example.txt");
		writeFileSync(file, "first line\nmatch line\nlast line");

		const result = await grepSearchFallback(file, false, { pattern: "match", limit: 100 });
		expect(result.matches).toEqual([{ filePath: file, lineNumber: 2, lineText: "match line" }]);
		expect(result.matchLimitReached).toBe(false);
	});

	it("searches a directory and honors literal + ignoreCase", async () => {
		writeFileSync(join(tempRoot, "x.txt"), "a.b\naxb\nMatch me\nplain\n");
		const literal = await grepSearchFallback(tempRoot, true, { pattern: "a.b", literal: true, limit: 100 });
		expect(literal.matches.map((m) => m.lineText)).toEqual(["a.b"]);

		const ignoreCase = await grepSearchFallback(tempRoot, true, { pattern: "match", ignoreCase: true, limit: 100 });
		expect(ignoreCase.matches.map((m) => m.lineText)).toEqual(["Match me"]);
	});

	it("skips binary files", async () => {
		writeFileSync(join(tempRoot, "bin.dat"), Buffer.from([0x41, 0x42, 0x43, 0x00, 0x44, 0x45, 0x46]));
		writeFileSync(join(tempRoot, "text.txt"), "needle\n");
		const result = await grepSearchFallback(tempRoot, true, { pattern: "needle", limit: 100 });
		expect(result.matches).toHaveLength(1);
		expect(result.matches[0]?.filePath.endsWith("text.txt")).toBe(true);
	});

	it("stops at the match limit and flags it", async () => {
		for (let i = 0; i < 3; i++) writeFileSync(join(tempRoot, `f${i}.txt`), "needle\n");
		const result = await grepSearchFallback(tempRoot, true, { pattern: "needle", limit: 2 });
		expect(result.matches).toHaveLength(2);
		expect(result.matchLimitReached).toBe(true);
	});

	it("applies a glob filter to candidate files", async () => {
		writeFileSync(join(tempRoot, "a.ts"), "needle\n");
		writeFileSync(join(tempRoot, "b.js"), "needle\n");
		const result = await grepSearchFallback(tempRoot, true, { pattern: "needle", glob: "*.ts", limit: 100 });
		expect(result.matches.map((m) => m.filePath.endsWith("a.ts"))).toEqual([true]);
	});

	it("returns no matches cleanly", async () => {
		writeFileSync(join(tempRoot, "a.txt"), "nothing here\n");
		const result = await grepSearchFallback(tempRoot, true, { pattern: "zzz", limit: 100 });
		expect(result.matches).toEqual([]);
		expect(result.matchLimitReached).toBe(false);
	});

	it("surfaces invalid regular expressions", async () => {
		writeFileSync(join(tempRoot, "a.txt"), "x\n");
		await expect(grepSearchFallback(tempRoot, true, { pattern: "(", limit: 100 })).rejects.toThrow(
			/error parsing regex/,
		);
	});
});

describe("find and grep tools fall back when rg/fd are unavailable", () => {
	it("find returns real results through the Node backend", async () => {
		mkdirSync(join(tempRoot, ".secret"));
		writeFileSync(join(tempRoot, ".secret", "hidden.txt"), "");
		writeFileSync(join(tempRoot, "visible.txt"), "");
		writeFileSync(join(tempRoot, ".gitignore"), "ignored.txt\n");
		writeFileSync(join(tempRoot, "ignored.txt"), "");

		const def = createFindToolDefinition(tempRoot);
		const ctx = {} as Parameters<typeof def.execute>[4];
		const result = (await def.execute("call-1", { pattern: "**/*.txt" }, undefined, undefined, ctx)) as {
			content: Array<{ type: string; text?: string }>;
		};
		const lines = (result.content[0]?.text ?? "")
			.split("\n")
			.map((l) => l.trim())
			.filter(Boolean);
		expect(lines).toContain("visible.txt");
		expect(lines).toContain(".secret/hidden.txt");
		expect(lines).not.toContain("ignored.txt");
	});

	it("find surfaces a glob parse error through the Node backend", async () => {
		const def = createFindToolDefinition(tempRoot);
		const ctx = {} as Parameters<typeof def.execute>[4];
		await expect(def.execute("call-1", { pattern: "[" }, undefined, undefined, ctx)).rejects.toThrow(
			/error parsing glob/,
		);
	});

	it("grep returns results with identical output shape to ripgrep", async () => {
		const testFile = join(tempRoot, "example.txt");
		writeFileSync(testFile, "first line\nmatch line\nlast line");

		const def = createGrepToolDefinition(tempRoot);
		const ctx = {} as Parameters<typeof def.execute>[4];
		const result = (await def.execute("call-1", { pattern: "match" }, undefined, undefined, ctx)) as {
			content: Array<{ type: string; text?: string }>;
		};
		expect(result.content[0]?.text).toContain("example.txt:2: match line");
	});

	it("grep honors context and limit through the Node backend", async () => {
		const testFile = join(tempRoot, "context.txt");
		writeFileSync(testFile, ["before", "match one", "after", "middle", "match two", "after two"].join("\n"));

		const def = createGrepToolDefinition(tempRoot);
		const ctx = {} as Parameters<typeof def.execute>[4];
		const result = (await def.execute(
			"call-1",
			{ pattern: "match", limit: 1, context: 1 },
			undefined,
			undefined,
			ctx,
		)) as {
			content: Array<{ type: string; text?: string }>;
		};
		const output = result.content[0]?.text ?? "";
		expect(output).toContain("context.txt-1- before");
		expect(output).toContain("context.txt:2: match one");
		expect(output).toContain("context.txt-3- after");
		expect(output).toContain("[1 matches limit reached. Use limit=2 for more, or refine pattern]");
		expect(output).not.toContain("match two");
	});
});

describe("walkCandidatePaths determinism", () => {
	it("yields sorted, absolute paths for a small tree", async () => {
		writeFileSync(join(tempRoot, "b.txt"), "");
		writeFileSync(join(tempRoot, "a.txt"), "");
		mkdirSync(join(tempRoot, "dir"));
		writeFileSync(join(tempRoot, "dir", "c.txt"), "");
		const entries = await walkCandidatePaths(tempRoot);
		const rels = entries.map((e) => e.path.slice(tempRoot.length + 1));
		expect(rels).toEqual(["a.txt", "b.txt", "dir", "dir/c.txt"]);
	});
});
