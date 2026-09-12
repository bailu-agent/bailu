import { describe, expect, it } from "vitest";
import { getBailuUserAgent } from "../src/utils/bailu-user-agent.ts";

describe("getBailuUserAgent", () => {
	it("formats the user agent expected by pi.dev", () => {
		const runtime = process.versions.bun ? `bun/${process.versions.bun}` : `node/${process.version}`;
		const userAgent = getBailuUserAgent("1.2.3");

		expect(userAgent).toBe(`bailu/1.2.3 (${process.platform}; ${runtime}; ${process.arch})`);
		expect(userAgent).toMatch(/^bailu\/[^\s()]+ \([^;()]+;\s*[^;()]+;\s*[^()]+\)$/);
	});
});
