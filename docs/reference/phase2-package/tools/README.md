# Package verification tools

These tools validate this instruction archive and deliberately synthetic fixtures.
They are not Studio implementation code, a game simulator, an execution kernel,
or evidence that the future product passes its acceptance requirements.

Use Python 3.11 or later and the package-only dependency:

```text
python -m pip install -r tools/requirements.txt
python tools/verify_package.py
python -m unittest discover -s tools -p 'test_*.py' -v
```

Dependency installation is explicit; no script downloads code or contacts a service.
The check itself is offline and read-only. Run it from the extracted package root.
`--preflight` is a packaging-only partial check that skips the not-yet-created
manifest; a preflight pass does not qualify as full archive verification.

The manifest binds every payload file except the manifest and `SHA256SUMS` itself.
`SHA256SUMS` additionally binds the manifest. An external ZIP checksum binds the
archive including `SHA256SUMS`. These are integrity checks, not author signatures.
A local Python `__pycache__` created by running tests is excluded from payload
inventory. The distributed ZIP contains no bytecode caches or unrelated files.

Negative fixtures pass only by failing at their declared layer. The display fold
is intentionally small and fixture-specific; actual snapshot/cursor and filtering
semantics must come from the admitted Phase-1 service. It cannot choose a node,
advance a workflow, dispatch a command, call a provider, or mutate a game.

The current task, requirement, acceptance and agent records remain unexecuted.
Use separate execution evidence in the eventual implementation repository. Editing
this delivered package after extraction intentionally invalidates its manifest;
keep the original immutable and create working ledgers elsewhere.
