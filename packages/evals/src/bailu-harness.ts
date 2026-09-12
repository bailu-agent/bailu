import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { contentText } from "@bailu/ai";
import {
	type AgentSession,
	type CreateAgentSessionOptions,
	createAgentSessionFromServices,
	createAgentSessionServices,
	ModelRuntime,
	SessionManager,
	SettingsManager,
} from "@bailu/coding-agent";
import {
	createHarness,
	type Harness,
	type HarnessContext,
	type JsonValue,
	normalizeRecord,
	type SimpleHarnessResult,
	type TranscriptEvent,
	toJsonValue,
} from "vitest-evals/harness";
import { BAILU_SESSION_SNAPSHOT_ARTIFACT } from "./vitest-evals/artifacts.ts";

export type BailuCodingAgentInput = string | Array<{ type: "prompt"; content: string } | { type: "reload" }>;

type BailuCodingAgentModelSelection = {
	provider: string;
	id: string;
};

type BailuCodingAgentHarnessOptions = {
	name?: string;
	model?: BailuCodingAgentModelSelection;
	noTools?: CreateAgentSessionOptions["noTools"];
	tools?: CreateAgentSessionOptions["tools"];
	customTools?: CreateAgentSessionOptions["customTools"];
	transformSystemPrompt?: (defaultPrompt: string) => string;
};

type BailuCodingAgentHarnessWithOutput<TOutput extends JsonValue> = BailuCodingAgentHarnessOptions & {
	output: (args: { response: string; session: AgentSession }) => TOutput | Promise<TOutput>;
};

export function resolveModelSelection(
	explicitModel: BailuCodingAgentModelSelection | undefined,
	environment: { BAILU_PROVIDER?: string; BAILU_MODEL?: string } = process.env,
): BailuCodingAgentModelSelection {
	const provider = (explicitModel?.provider ?? environment.BAILU_PROVIDER)?.trim();
	const id = (explicitModel?.id ?? environment.BAILU_MODEL)?.trim();
	if (!provider || !id) {
		throw new Error("Select a harness model explicitly or set both BAILU_PROVIDER and BAILU_MODEL as defaults.");
	}
	return { provider, id };
}

function toTranscriptEvents(messages: AgentSession["messages"]): TranscriptEvent[] {
	const events: TranscriptEvent[] = [];
	for (const message of messages) {
		if (message.role === "user") {
			events.push({ type: "message", role: "user", content: contentText(message.content) });
		} else if (message.role === "assistant") {
			const text = contentText(message.content);
			if (text) events.push({ type: "message", role: "assistant", content: text });
			for (const part of message.content) {
				if (part.type === "toolCall") {
					events.push({
						type: "tool_call",
						id: part.id,
						name: part.name,
						arguments: normalizeRecord(part.arguments),
					});
				}
			}
		} else if (message.role === "toolResult") {
			const text = contentText(message.content);
			events.push({
				type: "tool_result",
				toolCallId: message.toolCallId,
				name: message.toolName,
				content: message.content.every((part) => part.type === "text") ? text : toJsonValue(message.content),
				...(message.isError ? { error: { message: text || "Tool failed" } } : {}),
			});
		}
	}
	return events;
}

async function promptAgent(session: AgentSession, input: string, signal: AbortSignal | undefined): Promise<string> {
	signal?.throwIfAborted();
	const previousMessageCount = session.messages.length;
	await session.prompt(input);
	const assistant = session.messages
		.slice(previousMessageCount)
		.reverse()
		.find((message) => message.role === "assistant");
	if (!assistant) throw new Error("Agent run completed without an assistant message.");
	if (assistant.stopReason !== "stop" && assistant.stopReason !== "toolUse") {
		throw new Error(
			assistant.errorMessage ?? `Agent run ended with unexpected stop reason: ${assistant.stopReason}.`,
		);
	}
	const output = session.getLastAssistantText();
	if (!output && assistant.stopReason === "stop") throw new Error("Agent run produced no assistant text.");
	return output ?? "";
}

async function runBailuCodingAgent<TOutput extends JsonValue>(
	input: BailuCodingAgentInput,
	signal: AbortSignal | undefined,
	setArtifact: HarnessContext["setArtifact"],
	options: BailuCodingAgentHarnessOptions | BailuCodingAgentHarnessWithOutput<TOutput>,
): Promise<SimpleHarnessResult<string | TOutput>> {
	const startedAt = performance.now();
	signal?.throwIfAborted();
	const selection = resolveModelSelection(options.model);
	const modelRuntime = await ModelRuntime.create();
	const model = modelRuntime.getModel(selection.provider, selection.id);
	if (!model) throw new Error(`Eval model not found: ${selection.provider}/${selection.id}`);

	const root = await mkdtemp(join(tmpdir(), "bailu-eval-"));
	const cwd = join(root, "workspace");
	const agentDir = join(root, "agent");
	let transformedSystemPrompt: string | undefined;
	let sessionManager: SessionManager | undefined;
	let session: AgentSession | undefined;
	let outcome: { success: true; result: SimpleHarnessResult<string | TOutput> } | { success: false; error: unknown };
	try {
		await Promise.all([mkdir(cwd), mkdir(agentDir)]);
		const services = await createAgentSessionServices({
			cwd,
			agentDir,
			modelRuntime,
			settingsManager: SettingsManager.inMemory(),
			...(options.transformSystemPrompt
				? { resourceLoaderOptions: { systemPromptOverride: () => transformedSystemPrompt } }
				: {}),
		});
		signal?.throwIfAborted();
		sessionManager = SessionManager.create(cwd, join(root, "sessions"));
		setArtifact("runId", sessionManager.getSessionId());
		session = (
			await createAgentSessionFromServices({
				services,
				sessionManager,
				model,
				thinkingLevel: "off",
				tools: options.tools,
				noTools: options.noTools,
				customTools: options.customTools,
			})
		).session;

		const evalSession = session;
		if (options.transformSystemPrompt) {
			transformedSystemPrompt = options.transformSystemPrompt(evalSession.systemPrompt);
			if (!transformedSystemPrompt.trim()) throw new Error("Transformed eval system prompt must not be empty.");
			await evalSession.reload();
		}
		let abortPromise: Promise<void> | undefined;
		const abort = () => {
			abortPromise ??= evalSession.abort();
		};
		signal?.addEventListener("abort", abort, { once: true });
		try {
			signal?.throwIfAborted();
			if (evalSession.extensionRunner.getExtensionPaths().length !== 0) {
				throw new Error("Expected an isolated eval session to start without extensions.");
			}
			const steps = typeof input === "string" ? [{ type: "prompt" as const, content: input }] : input;
			let response: string | undefined;
			for (const step of steps) {
				if (step.type === "prompt") {
					response = await promptAgent(evalSession, step.content, signal);
				} else {
					await evalSession.reload();
				}
			}
			if (response === undefined) throw new Error("Bailu eval input must include at least one prompt step.");
			const output = "output" in options ? await options.output({ response, session: evalSession }) : response;
			const stats = evalSession.getSessionStats();
			const hasPricing = [model.cost, ...(model.cost.tiers ?? [])].some(
				({ input, output, cacheRead, cacheWrite }) => input > 0 || output > 0 || cacheRead > 0 || cacheWrite > 0,
			);
			outcome = {
				success: true,
				result: {
					output,
					events: toTranscriptEvents(evalSession.messages),
					usage: {
						provider: model.provider,
						model: model.id,
						inputTokens: stats.tokens.input,
						outputTokens: stats.tokens.output,
						totalTokens: stats.tokens.total,
						toolCalls: stats.toolCalls,
						metadata: {
							cacheReadTokens: stats.tokens.cacheRead,
							cacheWriteTokens: stats.tokens.cacheWrite,
							...(hasPricing ? { estimatedCostUsd: stats.cost } : {}),
						},
					},
				},
			};
		} finally {
			signal?.removeEventListener("abort", abort);
			if (abortPromise) await abortPromise;
		}
	} catch (error) {
		outcome = { success: false, error };
	}

	const cleanupErrors: unknown[] = [];
	if (sessionManager) {
		try {
			const sessionPath = sessionManager.getSessionFile();
			if (sessionPath && existsSync(sessionPath)) {
				setArtifact(BAILU_SESSION_SNAPSHOT_ARTIFACT, await readFile(sessionPath, "utf8"));
			}
		} catch (error) {
			cleanupErrors.push(error);
		}
	}
	try {
		session?.dispose();
	} catch (error) {
		cleanupErrors.push(error);
	}
	try {
		await rm(root, { recursive: true, force: true });
	} catch (error) {
		cleanupErrors.push(error);
	}

	if (!outcome.success) {
		if (cleanupErrors.length === 0) throw outcome.error;
		throw new AggregateError([outcome.error, ...cleanupErrors], "Agent run failed and cleanup also failed.");
	}
	if (cleanupErrors.length === 1) throw cleanupErrors[0];
	if (cleanupErrors.length > 1) throw new AggregateError(cleanupErrors, "Agent cleanup failed.");
	return {
		...outcome.result,
		timings: { totalMs: performance.now() - startedAt },
	};
}

export function createBailuCodingAgentHarness<TOutput extends JsonValue>(
	options: BailuCodingAgentHarnessWithOutput<TOutput>,
): Harness<BailuCodingAgentInput, TOutput>;
export function createBailuCodingAgentHarness(
	options?: BailuCodingAgentHarnessOptions,
): Harness<BailuCodingAgentInput, string>;
export function createBailuCodingAgentHarness<TOutput extends JsonValue>(
	options: BailuCodingAgentHarnessOptions | BailuCodingAgentHarnessWithOutput<TOutput> = {},
) {
	return createHarness<BailuCodingAgentInput, string | TOutput>({
		name: options.name ?? "bailu-coding-agent",
		run: ({ input, signal, setArtifact }) => runBailuCodingAgent(input, signal, setArtifact, options),
	});
}
