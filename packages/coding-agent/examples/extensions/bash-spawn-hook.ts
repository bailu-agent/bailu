/**
 * Bash Spawn Hook Example
 *
 * Adjusts command, cwd, and env before execution.
 *
 * Usage:
 *   bailu -e ./bash-spawn-hook.ts
 */

import type { ExtensionAPI } from "@bailu/coding-agent";
import { createBashTool } from "@bailu/coding-agent";

export default function (bailu: ExtensionAPI) {
	const cwd = process.cwd();

	const bashTool = createBashTool(cwd, {
		spawnHook: ({ command, cwd, env }) => ({
			command: `source ~/.profile\n${command}`,
			cwd,
			env: { ...env, BAILU_SPAWN_HOOK: "1" },
		}),
	});

	bailu.registerTool({
		...bashTool,
		execute: async (id, params, signal, onUpdate, _ctx) => {
			return bashTool.execute(id, params, signal, onUpdate);
		},
	});
}
