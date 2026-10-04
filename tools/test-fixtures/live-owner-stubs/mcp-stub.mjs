#!/usr/bin/env node
// Stub `sts2-mcp-server`. The stack spawns it but does not require it to speak
// MCP for the teardown behaviour under test, so it only has to stay alive
// until it is signalled.
process.on("SIGTERM", () => process.exit(0));
setInterval(() => {}, 1 << 30);
