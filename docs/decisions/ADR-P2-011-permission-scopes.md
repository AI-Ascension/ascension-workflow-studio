# ADR-P2-011: Treat permissions as independent capability scopes

Status: accepted for Phase 2.

The Studio treats inspection, authoring, publication, operation, and browser
session access as separate owner-authorized capabilities. A visible control is
enabled only when the admitted capability and current object state allow it;
the harness still checks every request. Fixture mode is explicitly local
evidence and never grants live authority.

Bearer material stays in memory for the current tab. Logout or a capability
loss clears the client projection and stops new subscriptions; an already
accepted harness command remains owned by the harness and is not cancelled by
closing the browser.
