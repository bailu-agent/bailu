# Development

See [AGENTS.md](https://github.com/earendil-works/pi/blob/main/AGENTS.md) for additional guidelines.

## Setup

```bash
git clone https://github.com/earendil-works/pi
cd bailu
npm install
npm run build
```

Run from source:

```bash
/path/to/bailu/bailu-test.sh
```

The script can be run from any directory. Bailu keeps the caller's current working directory.

### Experimental remote harness

The remote harness server/client integration is development-only. Run it from the repository with:

```bash
BAILU_EXPERIMENTAL=1 ./bailu-test.sh server
BAILU_EXPERIMENTAL=1 ./bailu-test.sh client
```

`BAILU_SERVER_DIR` overrides the server profile and socket directory (default: `~/.bailu/server`). `BAILU_SERVER_ID` selects the logical server ID when `--server-id` is omitted.

The `client` and `experimental/plugin` package subpaths resolve only under the `source` condition in a checkout. Their implementations and the server/client commands are excluded from npm packages and standalone binaries. `bailu-client`, `bailu-protocol`, and `bailu-server` are development dependencies of coding-agent, not runtime dependencies. The local SDK and stdio RPC API are unchanged.

## Forking / Rebranding

Configure via `package.json`:

```json
{
  "piConfig": {
    "name": "bailu",
    "configDir": ".bailu"
  }
}
```

Change `name`, `configDir`, and `bin` field for your fork. Affects CLI banner, config paths, and environment variable names.

## Path Resolution

Three execution modes: npm install, standalone binary, tsx from source.

**Always use `src/config.ts`** for package assets:

```typescript
import { getPackageDir, getThemesDir } from "./config.js";
```

Never use `__dirname` directly for package assets.

## Debug Command

`/debug` (hidden) writes to `~/.bailu/agent/bailu-debug.log`:
- Rendered TUI lines with ANSI codes
- Last messages sent to the LLM

## Testing

```bash
./test.sh                         # Run non-LLM tests (no API keys needed)
npm test                          # Run all tests
npm test -- test/specific.test.ts # Run specific test
```

### Published package smoke test

After building, run `npm run check:package-install`. It packs the public packages and installs only coding-agent as a direct dependency in a temporary directory outside the repository. Local tarball overrides select declared transitive dependencies without installing development-only packages. The check verifies SDK imports and CLI startup without credentials or model requests.

`npm run check` also checks runtime dependency declarations and rejects excluded development sources pulled into a package's build through imports.

## Project Structure

```
packages/
  ai/           # LLM provider abstraction
  agent/        # Agent loop and message types  
  tui/          # Terminal UI components
  coding-agent/ # CLI and interactive mode
```
