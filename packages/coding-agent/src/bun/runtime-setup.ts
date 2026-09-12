import { bedrockProviderModule } from "@bailu/ai/bedrock-provider";
import { registerBunOAuthFlows } from "@bailu/ai/bun-oauth";
import { setBedrockProviderModule } from "@bailu/ai/compat";
import { APP_NAME } from "../config.ts";

process.title = APP_NAME;
process.emitWarning = (() => {}) as typeof process.emitWarning;
registerBunOAuthFlows();
setBedrockProviderModule(bedrockProviderModule);
