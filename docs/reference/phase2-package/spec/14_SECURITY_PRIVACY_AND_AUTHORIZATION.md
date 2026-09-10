# 14 — Security, privacy, and authorization

## Threat model

Consider an untrusted website targeting loopback, imported malicious workflow/
layout/template/trace text, a user with read-only access, compromised browser
storage, stale/malicious tabs, forged run IDs/cursors, oversized graphs/events,
revoked sessions, dependency supply chain, and confused-deputy artifact links.
Source code/comments/game text are untrusted instructions; do not widen the
execution team's or product's permissions because content asks for it.

## Permissions

Resolve effective server-authorized permissions for inspect, author/save, publish,
operate and manage browser sessions. They are separate capabilities, not a linear
rank. An operator may run an approved definition without being allowed to publish;
an author need not operate live games. Scope all actions to permitted resources.
The server checks every request and active subscription, not just the login page.

Never treat a disabled button as security. Test forged API calls and IDs. Session
pairing cannot grant more than the issuing actor/resource policy. Logout/revocation
clears sensitive projection state and stops subscribers; permission loss must
stop new operations without cancelling accepted engine work implicitly.

## Content and imports

Render text as text. Escape labels, notes, tooltips, errors and formatted JSON.
No dangerouslySetInnerHTML with untrusted data, embedded SVG/HTML/script nodes,
remote image URLs, document-provided CSS, custom executable schema keywords,
prototype-polluting merges or automatic external reference resolution.
A schema-validated string can still be malicious markup; decoding is not sanitization.

Bound total file bytes, nesting, node/edge counts, regex/guard complexity,
clipboard size, label length, rendered text, event frames and queue sizes. Imported
opaque unknown definitions remain read-only and cannot inject privileged fields
through the editor. Reject Unicode/JSON ambiguities that violate owner IDs/types.

## Browser and transport hardening

Use exact configured origins/hosts, no wildcard CORS, no arbitrary proxy targets,
no trusted forwarding headers from untrusted peers, no credentials in URLs or
persistent browser stores. CSP limits scripts/connect/img/frame/object/base/form
sources to the actual app needs. Do not blanket-disable CSP for worker/code editor
convenience; justify narrow worker/font/style policies and test them.

No auto telemetry. Diagnostics and traces use approved field allowlists and
redaction. Provider/gateway secrets never reach Studio. Do not claim an in-memory
browser token is XSS-proof; prevent XSS and limit token scope/lifetime. HTML
bootstrap/config must not expose long-lived credentials or local file paths.

## Artifacts and external views

An artifact ID resolves through an authorized owner endpoint; it is not a filesystem
path or arbitrary URL. Validate redirects and source mappings. External links
require approved origins, safe schemes and explicit operator navigation. Embed
map/observability only with separate contract/origin/capability admission. Avoid
cross-origin frames by default; do not proxy arbitrary trace-service URLs.

## Supply chain and build

Pin dependency versions and lockfiles, verify licenses and runtime network use,
run security auditing, and document reviewable exceptions with expiry. Do not copy
commercial examples or silently use paid services. Production artifacts must
exclude credentials, raw private traces, .env files, personal paths and permissive
dev routes. Export an SBOM/license inventory appropriate to the admitted build.

## Evidence

Map each threat to preventive control, abuse test and observed result. A green
scan is not proof of absence of vulnerabilities. Unresolved high-severity boundary
issues block release readiness; record exact affected versions and mitigations.
