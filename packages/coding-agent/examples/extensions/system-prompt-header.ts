/**
 * Displays a status widget showing the system prompt length.
 *
 * Demonstrates ctx.getSystemPrompt() for accessing the effective system prompt.
 */
import type { ExtensionAPI } from "@bailu/coding-agent";

export default function (bailu: ExtensionAPI) {
	bailu.on("agent_start", (_event, ctx) => {
		const prompt = ctx.getSystemPrompt();
		ctx.ui.setStatus("system-prompt", `System: ${prompt.length} chars`);
	});

	bailu.on("session_shutdown", (_event, ctx) => {
		ctx.ui.setStatus("system-prompt", undefined);
	});
}
