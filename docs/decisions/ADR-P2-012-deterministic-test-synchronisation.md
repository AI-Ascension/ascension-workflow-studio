# ADR-P2-012: Tests synchronise on settled conditions, never on elapsed time

Status: accepted.

## Context

The unit suite was not reliably green on an untouched `main`. A full
`npm test -- --run --pool=threads --maxWorkers=1` run failed a varying subset of
tests in `App.test.tsx`, `DesignerView.test.tsx`, and
`ContextOwnerCatalogPanel.test.tsx`, and consecutive runs of the same commit
minutes apart failed different tests (`ascension-workflow-studio#222`).

Two independent defects produced that signature. Both are recorded here because
the second one is not visible from the first test's failure alone.

## Decision

### 1. A test must not depend on a fixed flush catching its dependencies

`openDesigner()` used `await act(async () => {})` to settle the first render
before querying for the `JSON mode` control. That drains whatever happens to be
scheduled; it does not wait for the condition the helper actually needs. Under
parallel load the relevant effect had not run, `getByRole` threw, and the test
failed on a *missing element* rather than on the behaviour it was written to
check.

Helpers now wait for the settled condition they depend on
(`await screen.findByRole(...)`), so the assertion's subject is present before it
is asserted on.

Fake timers are enabled **after** that condition is reached, never before.
Waiting on a condition that only a real event loop can satisfy, under a fake
clock, is the same class of mistake in the other direction: it hangs rather than
races.

### 2. A test must not amplify one failure into the rest of the file

When the first slow test in a file exceeded the 5s budget, the remaining tests
in that file failed too, with `Unable to find ... "JSON mode"` and an empty
`<body>`. The abort lands while React's effect queue is still draining, so the
container is unmounted but the pending flush is not; the next test then renders
into a torn-down tree.

One failing test therefore reported as four, and the reported failure pointed at
the *victim* rather than the cause. Every timeout in this suite is now well
inside the budget (worst case 2.1s of 5s), so the amplification no longer occurs.

### 3. Remove avoidable cost rather than raise the budget

`testTimeout` is unchanged. No retry, `repeat`, or lengthened timeout was added,
because those would mask the recurrence rather than remove it. The cost was cut
at three measured points:

- `userEvent.setup()` defaults to a real-time `delay` between dispatched
  events. Every interaction paid an `await setTimeout` no assertion depends on;
  `delay: null` removes it with identical event semantics. `App.test.tsx` went
  from 3915ms worst case to 1522ms.
- The isolated-rendering assertion issued seven `queryByRole` calls. Each
  re-walks every element, so the cost was seven full-DOM scans (505ms measured)
  where one pass suffices (15ms). It now reads the names from a single
  `queryAllByRole` and asserts against that set.
- Mounting under real timers and switching to fake timers afterwards lets the
  real render settle once instead of being re-driven by the fake clock.

Worst case across the three named files fell from 6578ms to 2977ms.

### 4. A cheaper query must not quietly narrow what is asserted

`queryByRole` matches on the *accessible* name, which is `aria-label` or
`title` when present and only otherwise the contents. A bulk pass that reads
`textContent` is therefore not the same assertion: a control relabelled via
`aria-label` would be silently missed, and the guard would keep passing while
no longer checking what the seven original queries checked.

The bulk pass resolves each name the same way, and separately asserts that
resolution equals the contents for every button present. If a control ever
gains an overriding label, that guard fails loudly instead of the assertion
weakening in place. The guard was verified live: introducing an `aria-label`
divergence makes it throw, where a `textContent`-only check would not notice.

## Consequences

The suite is deterministic on the documented invocation. A future test that
needs a condition settled must wait for that condition; a fixed sleep is a
defect, not a style choice. If a test's real work approaches the budget, the fix
is to remove cost as above — not to raise `testTimeout`.

These assertions are unchanged in meaning: no assertion was weakened, and no
timeout was lengthened. `delay: null` was checked in both directions (restoring
the default delay leaves all 8 tests passing), confirming it changes cost, not
behaviour. The single-pass assertion was mutation-tested — inverting it fails
the test — and the accessible-name guard was checked against an introduced
`aria-label` divergence, which it catches.
