import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { basename, join, relative } from "node:path";
import {
	type RunnerTestCase,
	recordArtifact,
	type TestArtifact,
	type TestArtifactBase,
	type TestAttachment,
} from "vitest";
import type { HarnessRun } from "vitest-evals/harness";

export const BAILU_SESSION_SNAPSHOT_ARTIFACT = "bailuSessionJsonl";

const evalSessionArtifactKey = Symbol("bailu-evals-session-artifact");
const evalSourceArtifactKey = Symbol("bailu-evals-source-artifact");

interface BailuSessionAttachment extends TestAttachment {
	name: "session.jsonl";
	contentType: "application/jsonl";
	body: string;
	bodyEncoding: "utf-8";
}

export interface SourceAttachment extends TestAttachment {
	name: string;
	contentType: string;
	body: string;
	bodyEncoding: "utf-8";
}

interface BailuSessionArtifact extends TestArtifactBase {
	type: "@bailu/evals:session";
	runId: string;
	attachments: [BailuSessionAttachment] | [];
}

interface SourceArtifact extends TestArtifactBase {
	type: "@bailu/evals:source";
	runId: string;
	attachments: [SourceAttachment] | [];
}

declare module "vitest" {
	interface TestArtifactRegistry {
		[evalSessionArtifactKey]: BailuSessionArtifact;
		[evalSourceArtifactKey]: SourceArtifact;
	}
}

export async function recordEvalSessionArtifact(
	task: Readonly<RunnerTestCase>,
	run: Pick<HarnessRun, "artifacts">,
): Promise<void> {
	const runId = run.artifacts?.runId;
	const session = run.artifacts?.[BAILU_SESSION_SNAPSHOT_ARTIFACT];
	if (session === undefined) return;
	if (typeof runId !== "string" || typeof session !== "string") {
		throw new TypeError("Bailu eval session artifact metadata is invalid.");
	}
	await recordArtifact(task, {
		type: "@bailu/evals:session",
		runId,
		attachments: [
			{
				name: "session.jsonl",
				contentType: "application/jsonl",
				body: session,
				bodyEncoding: "utf-8",
			},
		],
	});
}

export async function recordEvalSourceArtifact(
	task: Readonly<RunnerTestCase>,
	runId: string,
	attachment: SourceAttachment,
): Promise<void> {
	await recordArtifact(task, {
		type: "@bailu/evals:source",
		runId,
		attachments: [attachment],
	});
}

export async function persistEvalArtifactReferences(
	artifacts: ReadonlyArray<TestArtifact>,
	runId: string,
	artifactDirectory: string,
): Promise<Array<{ name: string; path: string }>> {
	const references: Array<{ name: string; path: string }> = [];
	for (const artifact of artifacts) {
		if (
			(artifact.type !== "@bailu/evals:session" && artifact.type !== "@bailu/evals:source") ||
			artifact.runId !== runId
		) {
			continue;
		}
		const category = artifact.type === "@bailu/evals:session" ? "sessions" : "sources";
		for (const attachment of artifact.attachments) {
			const name = basename(attachment.name);
			if (name !== attachment.name) throw new TypeError(`Invalid eval artifact name: ${attachment.name}`);
			const directory = join(artifactDirectory, category, createHash("sha256").update(runId).digest("hex"));
			await mkdir(directory, { recursive: true, mode: 0o700 });
			const path = join(directory, name);
			await writeFile(path, attachment.body, { encoding: "utf8", mode: 0o600 });
			references.push({ name, path: relative(artifactDirectory, path) });
		}
	}
	return references;
}
