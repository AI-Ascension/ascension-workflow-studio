"""Offline checks of this instruction package; never an application executor.

The synthetic projection helper only folds display values from fixture events.
No function can call a provider, service, repository, or game.
"""
from __future__ import annotations

import hashlib
import json
import math
from pathlib import Path, PurePosixPath
from typing import Any

MAX_JSON_BYTES = 4 * 1024 * 1024


class CheckError(ValueError):
    """A package input violates a declared check."""


def strict_json(text: str) -> Any:
    """Reject duplicate keys, nonfinite values, and overly large fixture input."""
    if len(text.encode('utf-8')) > MAX_JSON_BYTES:
        raise CheckError('JSON exceeds package input bound')

    def pairs(items: list[tuple[str, Any]]) -> dict[str, Any]:
        result: dict[str, Any] = {}
        for key, value in items:
            if key in result:
                raise CheckError(f'duplicate JSON key: {key}')
            result[key] = value
        return result

    def nonfinite(value: str) -> None:
        raise CheckError(f'nonfinite JSON number: {value}')

    def finite_float(value: str) -> float:
        number = float(value)
        if not math.isfinite(number):
            raise CheckError('nonfinite JSON exponent')
        return number

    try:
        return json.loads(text, object_pairs_hook=pairs,
                          parse_constant=nonfinite, parse_float=finite_float)
    except (json.JSONDecodeError, RecursionError) as exc:
        raise CheckError('invalid or overly nested JSON') from exc


def safe_path(root: Path, relative: str) -> Path:
    """Resolve only a non-symlink relative member inside the package."""
    if '\\' in relative or not relative or ':' in relative:
        raise CheckError('nonportable or empty package path')
    pure = PurePosixPath(relative)
    if pure.is_absolute() or '..' in pure.parts or '.' in pure.parts:
        raise CheckError('unsafe package path')
    current = root.resolve()
    for part in pure.parts:
        current = current / part
        if current.is_symlink():
            raise CheckError('symlink package member')
    resolved = current.resolve()
    if not resolved.is_relative_to(root.resolve()):
        raise CheckError('package path escaped root')
    return resolved


def load(root: Path, relative: str) -> Any:
    return strict_json(safe_path(root, relative).read_text(encoding='utf-8'))


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def check_schema(schema: dict[str, Any]) -> None:
    """Do not allow a fixture schema to fetch a remote or external reference."""
    from jsonschema import Draft202012Validator
    Draft202012Validator.check_schema(schema)

    def visit(value: Any) -> None:
        if isinstance(value, dict):
            for key, child in value.items():
                if key in ('$ref', '$dynamicRef') and not str(child).startswith('#'):
                    raise CheckError('nonlocal schema reference is not admitted')
                visit(child)
        elif isinstance(value, list):
            for child in value:
                visit(child)
    visit(schema)


def schema_errors(data: Any, schema: dict[str, Any]) -> list[str]:
    from jsonschema import Draft202012Validator
    check_schema(schema)
    return [error.message for error in Draft202012Validator(schema).iter_errors(data)]


def check_layout(layout: dict[str, Any], definition_bytes: bytes) -> None:
    """Check inert reference binding; does not compile workflow semantics."""
    definition = strict_json(definition_bytes.decode('utf-8'))
    binding = layout['binding']
    if binding['definition_artifact_sha256'] != hashlib.sha256(definition_bytes).hexdigest():
        raise CheckError('layout definition-byte digest mismatch')
    if (binding['workflow_id'], binding['revision']) != (definition['workflow_id'], definition['version']):
        raise CheckError('layout workflow identity mismatch')
    allowed = {(graph['id'], node['id']) for graph in definition['graphs'] for node in graph['nodes']}
    seen: set[tuple[str, str]] = set()
    for node in layout['nodes']:
        key = (node['graph_id'], node['node_id'])
        if key not in allowed or key in seen:
            raise CheckError('dangling or duplicate layout node')
        seen.add(key)


def check_command(command: dict[str, Any]) -> None:
    """An applied fixture revision must not regress; actual rules are owner-defined."""
    if command['view_status'] == 'applied' and command['applied_run_revision'] < command['expected_run_revision']:
        raise CheckError('command applied revision regressed')


def fold_display_fixture(data: dict[str, Any]) -> str:
    """Return a display-stream fixture outcome, not a workflow execution state."""
    snap = data['snapshot']
    sequence = snap['sequence']
    by_sequence: dict[int, dict[str, Any]] = {}
    by_id: dict[str, dict[str, Any]] = {}
    for event in data['events']:
        if any(event[key] != snap[key] for key in ('run_id', 'definition_artifact_sha256')):
            return 'binding_rejected'
        seq = event['sequence']
        prior = by_sequence.get(seq)
        same_id = by_id.get(event['event_id'])
        if (prior is not None and prior != event) or (same_id is not None and same_id != event):
            return 'conflicting_duplicate'
        if prior is not None:
            continue
        if seq != sequence + 1:
            return 'needs_resnapshot'
        by_sequence[seq] = event
        by_id[event['event_id']] = event
        sequence = seq
    return 'current'


def check_dag(tasks: list[dict[str, Any]]) -> None:
    by_id = {task['id']: task for task in tasks}
    if len(by_id) != len(tasks):
        raise CheckError('duplicate work-package ID')
    visiting: set[str] = set()
    visited: set[str] = set()

    def visit(task_id: str) -> None:
        if task_id in visiting:
            raise CheckError('task dependency cycle')
        if task_id in visited:
            return
        if task_id not in by_id:
            raise CheckError('missing task dependency')
        visiting.add(task_id)
        for dependency in by_id[task_id]['depends_on']:
            visit(dependency)
        visiting.remove(task_id)
        visited.add(task_id)
    for task_id in by_id:
        visit(task_id)


def check_policy(policy: dict[str, Any]) -> None:
    expected = {'phase': 2, 'root_depth': 0, 'maximum_descendant_depth': 3,
                'descendant_model': 'gpt-5.6-luna', 'descendant_reasoning_effort': 'max',
                'maximum_live_descendants': 12, 'obey_lower_runtime_limit': True,
                'leaf_may_spawn': False, 'silent_model_substitution': False,
                'independent_verification_required': True, 'auto_merge': False,
                'auto_deploy': False, 'phase1_assumed_implemented': True,
                'phase1_reimplementation_allowed': False,
                'direct_browser_game_actions_allowed': False,
                'mock_only_completion_allowed': False}
    for key, value in expected.items():
        if policy.get(key) != value:
            raise CheckError(f'orchestration policy mismatch: {key}')
    if policy['target_repository'] != 'AI-Ascension/ascension-workflow-studio':
        raise CheckError('incorrect Studio repository')


def check_fixture(root: Path, item: dict[str, Any]) -> None:
    try:
        data = load(root, item['path'])
    except CheckError:
        if item['expected'] == 'parse_reject':
            return
        raise
    if item['expected'] == 'parse_reject':
        raise CheckError('negative parser fixture unexpectedly parsed')
    errors = schema_errors(data, load(root, item['schema']))
    if item['expected'] == 'schema_reject':
        if not errors:
            raise CheckError('negative schema fixture unexpectedly accepted')
        return
    if errors:
        raise CheckError(f"fixture schema rejection: {item['path']}: {errors[0]}")
    try:
        if item['kind'] == 'layout':
            check_layout(data, safe_path(root, item['definition']).read_bytes())
        if item['kind'] == 'command':
            check_command(data)
    except CheckError:
        if item['expected'] == 'semantic_reject':
            return
        raise
    if item['expected'] == 'semantic_reject':
        raise CheckError('negative semantic fixture unexpectedly accepted')
    if item['kind'] == 'projection' and fold_display_fixture(data) != item['projection_outcome']:
        raise CheckError('display projection outcome mismatch')


def check_traceability(root: Path) -> dict[str, int]:
    tasks = load(root, 'orchestration/tasks.json')['tasks']
    requirements = load(root, 'quality/requirements.json')['requirements']
    cases = load(root, 'quality/acceptance-cases.json')['cases']
    faults = load(root, 'quality/fault-cases.json')['cases']
    check_dag(tasks)
    tm, rm, cm = ({row['id']: row for row in rows} for rows in (tasks, requirements, cases))
    if (len(tm), len(rm), len(cm)) != (len(tasks), len(requirements), len(cases)):
        raise CheckError('duplicate traceability ID')
    for task in tasks:
        if task['status'] != 'not_started' or not task['independent_verifier_required']:
            raise CheckError('package task falsely claims execution or omits verification')
        if (task['coordinator_depth'], task['implementation_depth']) != (2, 3):
            raise CheckError('incorrect task delegation depth')
        for path in task['specs']:
            if not safe_path(root, path).is_file():
                raise CheckError('missing task specification')
        for rid in task['requirement_ids']:
            if rid not in rm or rm[rid]['work_package'] != task['id']:
                raise CheckError('task/requirement ownership mismatch')
        for cid in task['acceptance_case_ids']:
            if cid not in cm or cm[cid]['work_package'] != task['id']:
                raise CheckError('task/acceptance ownership mismatch')
    for req in requirements:
        if not req['mandatory'] or req['status'] != 'not_started' or req['work_package'] not in tm:
            raise CheckError('invalid mandatory requirement')
        if req['id'] not in tm[req['work_package']]['requirement_ids']:
            raise CheckError('orphan requirement')
        for cid in req['acceptance_cases']:
            if cid not in cm or req['id'] not in cm[cid]['requirement_ids']:
                raise CheckError('unmapped acceptance case')
    for case in cases:
        if case['status'] != 'not_run' or case['actual_command'] is not None or case['actual_evidence_refs']:
            raise CheckError('package acceptance falsely claims execution')
        if case['id'] not in tm[case['work_package']]['acceptance_case_ids']:
            raise CheckError('orphan acceptance case')
    if len({row['id'] for row in faults}) != len(faults):
        raise CheckError('duplicate fault case')
    for fault in faults:
        if fault['status'] != 'not_run' or fault['work_package'] not in tm:
            raise CheckError('invalid fault ownership/status')
        if any(cid not in cm for cid in fault['related_acceptance_cases']):
            raise CheckError('invalid fault acceptance link')
    return {'work_packages': len(tasks), 'requirements': len(requirements),
            'acceptance_cases': len(cases), 'fault_cases': len(faults)}


def check_manifest(root: Path) -> int:
    manifest = load(root, 'PACKAGE_MANIFEST.json')
    listed = {row['path']: row for row in manifest['files']}
    actual = {p.relative_to(root).as_posix() for p in root.rglob('*') if p.is_file()
              and '__pycache__' not in p.parts and p.relative_to(root).as_posix() not in ('PACKAGE_MANIFEST.json', 'SHA256SUMS')}
    if len(listed) != len(manifest['files']) or set(listed) != actual:
        raise CheckError('manifest inventory mismatch')
    for relative, row in listed.items():
        path = safe_path(root, relative)
        if path.stat().st_size != row['size_bytes'] or sha256(path) != row['sha256']:
            raise CheckError(f'manifest digest mismatch: {relative}')
    sums = (root / 'SHA256SUMS').read_text(encoding='utf-8').splitlines()
    seen: set[str] = set()
    for line in sums:
        digest, relative = line.split('  ', 1)
        if relative in seen or sha256(safe_path(root, relative)) != digest:
            raise CheckError('checksum inventory mismatch')
        seen.add(relative)
    if seen != actual | {'PACKAGE_MANIFEST.json'}:
        raise CheckError('checksum membership mismatch')
    return len(actual) + 2
