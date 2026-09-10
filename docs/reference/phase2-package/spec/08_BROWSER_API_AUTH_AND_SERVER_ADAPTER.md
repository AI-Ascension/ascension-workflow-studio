# 08 — Browser API, session admission, and server adapter

## Resolve Phase-1 operations before routes

Build a versioned operation map from actual exported API artifacts. Reuse existing
validation, registry, status, events, artifacts and commands. Add only missing
authoring/session/read-projection operations in the harness owner. No private
second protocol that bypasses its permissions or duplicates command semantics.

Required logical operations: getCompatibility; getNodeRegistry; getCapabilities;
list/getDefinitions; create/get/saveDraft; validateCandidate; publishCandidate;
startRun; getRunSnapshot; list/streamRunEvents; submit/getCommand; getArtifact;
requestOfflineReplay; create/exchange/revokeBrowserSession. Names describe needs,
not existing paths. The execution ADR supplies exact verbs/routes/status schemas.

Generated SDK types do not validate hostile runtime JSON. Decode all responses,
bound error bodies, and reject mismatched schema/server/run/digest identities.
A fetch failure never means an empty list, successful command, or valid workflow.

## Default browser authentication

Phase 1 originally planned to reject browser-origin requests [P01]. Preserve that
default outside a new opt-in same-origin Studio adapter. Default browser access
uses a short-lived **browser-scoped bearer held in memory only**, acquired through
a one-time pairing exchange issued by an already authenticated operator mechanism.
It is not a provider key, gateway token, or long-lived general management token.

An authenticated local CLI/operator API requests a pairing code for an allowed
principal, resource scope, role ceiling, exact origin and expiry. It cannot issue
permissions exceeding its own. Print the code only to the authorized interactive
operator output; never put it in logs, URLs, clipboard automatically or web HTML.
Browser exchanges it once through a bounded, rate-limited same-origin POST.
Store only a hashed code/verifier server-side where appropriate. Make one-time
consumption atomic; brute-force and replay tests are required.

Proposed initial bounds: pairing code expiry <=120 seconds; memory session idle
expiry <=15 minutes and absolute expiry <=8 hours; revocation immediate on new
requests and active streams. Set actual limits under deployment policy, not UI
constants. Renewal, if implemented, requires current permission and cannot exceed
absolute lifetime. Reload normally requires pairing again; do not store tokens
in localStorage, sessionStorage, IndexedDB, URLs, saved drafts or service workers.

## Same-origin and local hosting

Serve `/studio/` static assets and admitted relative API paths from one configured
origin. Default local mode can use an explicitly allowed `http://127.0.0.1:<port>`
or `[::1]` origin; this is not remote transport security. Remote mode is off until
an approved TLS/private-access configuration is supplied. Do not install a CA,
modify DNS, open firewall ports, or enable an external listener implicitly.

Validate exact Host/Origin against server configuration to resist hostile pages
and DNS rebinding; no wildcard CORS or arbitrary proxy destinations. Browser
write routes require the browser session and approved origin. Preserve separate
non-browser CLI auth behavior. Treat missing/null Origin and redirects with an
explicit tested policy rather than casually disabling checks [S07].

If an existing approved same-origin HttpOnly-cookie adapter is reused instead,
record the alternative ADR and enforce CSRF tokens, SameSite/Secure appropriately,
origin checks and session revocation. Do not silently combine cookie and bearer
modes or claim loopback alone authenticates callers.

## Events and browser APIs

Use authenticated fetch streaming for SSE/NDJSON when the owner provides it,
with the bearer header and bounded decoder. Do not put access tokens in an
EventSource URL. A fetch-based client must implement the chosen framing/cursor
contract explicitly; native EventSource reconnect behavior is not inherited
merely because the content type is SSE [S06]. Bounded polling is a supported
fallback over the same durable cursor, not a separate event truth source.

Server cancellation of a stream closes only the subscriber. Browser exit,
logout, token expiry, proxy failure or static adapter restart must not cancel
accepted workflow work. Authorize each resource and each write server-side.

## Static bundle and errors

Mount only a verified build directory/manifest. No arbitrary path serving,
symlink escape, hidden dotfiles, source secrets, runtime database or generated
credential directory. Use correct MIME/nosniff, constrained CSP, frame-ancestors,
referrer policy and cache rules. Cache immutable hashed assets; do not cache
session, draft, run, command or artifact responses as public data. Production
bundle excludes fixture controls and development proxies by explicit build mode.
