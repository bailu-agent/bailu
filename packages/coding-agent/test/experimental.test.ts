import { afterEach, describe, expect, it } from "vitest";
import { areExperimentalFeaturesEnabled } from "../src/core/experimental.ts";

describe("areExperimentalFeaturesEnabled", () => {
	const originalBailuExperimental = process.env.BAILU_EXPERIMENTAL;

	afterEach(() => {
		if (originalBailuExperimental === undefined) {
			delete process.env.BAILU_EXPERIMENTAL;
		} else {
			process.env.BAILU_EXPERIMENTAL = originalBailuExperimental;
		}
	});

	it("returns false when BAILU_EXPERIMENTAL is unset", () => {
		delete process.env.BAILU_EXPERIMENTAL;

		expect(areExperimentalFeaturesEnabled()).toBe(false);
	});

	it("returns false when BAILU_EXPERIMENTAL is empty", () => {
		process.env.BAILU_EXPERIMENTAL = "";

		expect(areExperimentalFeaturesEnabled()).toBe(false);
	});

	it("returns true when BAILU_EXPERIMENTAL is set to 1", () => {
		process.env.BAILU_EXPERIMENTAL = "1";

		expect(areExperimentalFeaturesEnabled()).toBe(true);
	});

	it("returns false when BAILU_EXPERIMENTAL is set to 0", () => {
		process.env.BAILU_EXPERIMENTAL = "0";

		expect(areExperimentalFeaturesEnabled()).toBe(false);
	});

	it("returns false when BAILU_EXPERIMENTAL is set to a non-1 value", () => {
		process.env.BAILU_EXPERIMENTAL = "true";

		expect(areExperimentalFeaturesEnabled()).toBe(false);
	});
});
