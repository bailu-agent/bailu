import { expect } from "vitest";
import { describeEval } from "vitest-evals";
import { createBailuCodingAgentHarness } from "./bailu-harness.ts";

const bailuCodingAgentHarness = createBailuCodingAgentHarness({ noTools: "all" });

describeEval("Bailu Coding Agent smoke", { harness: bailuCodingAgentHarness }, (it) => {
	it("runs a basic prompt end to end", async ({ run }) => {
		const result = await run("What's the capital of France? Respond with only the city name.");

		expect(result.output.trim()).toBe("Paris");
		expect(result.errors).toEqual([]);
		expect(result.usage.provider).toBe(process.env.BAILU_PROVIDER);
		expect(result.usage.model).toBe(process.env.BAILU_MODEL);
		expect(result.usage.totalTokens).toBeGreaterThan(0);
	});
});
