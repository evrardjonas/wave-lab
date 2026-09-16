// Vitest runs model tests under Node, which has no `self` global (unlike a browser/worker).
// scenerystack's dev build unconditionally touches `self.phet.*` at module-evaluation time
// (see node_modules/scenerystack/src/globals.ts), so importing anything from "scenerystack/*"
// in a plain Node environment throws `ReferenceError: self is not defined` before any test
// code runs. This is a one-line polyfill - not a DOM shim - so tests stay fast, dependency-free,
// and consistent with this project's "no jsdom/happy-dom yet" testing strategy (see
// .claude/skills/scenerystack/references/multi-sim-architecture.md). Registered as a Vitest
// `setupFiles` entry so it runs before any test module is imported.
(globalThis as unknown as { self: typeof globalThis }).self = globalThis;

// scenerystack's chipper/initialize-globals module also reads `self.location.search` (for query
// parameters like `?ea`) at import time. Node has no `location` global either - stub the one field
// actually read, not a full URL/Location shim.
(globalThis as unknown as { location: { search: string } }).location ??= { search: "" };
