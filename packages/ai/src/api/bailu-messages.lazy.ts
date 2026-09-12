import type { ProviderStreams } from "../types.ts";
import { lazyApi } from "./lazy.ts";

export const bailuMessagesApi = (): ProviderStreams => lazyApi(() => import("./bailu-messages.ts"));
