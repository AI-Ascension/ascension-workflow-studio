#!/usr/bin/env python3
"""Read-only integrity and seed-fixture validation, not product acceptance."""
from __future__ import annotations
import argparse
import importlib.metadata
import json
from pathlib import Path
import re
import sys
import tomllib
from urllib.parse import unquote

from package_checks import (CheckError, check_fixture, check_layout, check_manifest,
                            check_policy, check_schema, check_traceability, load,
                            safe_path, schema_errors, sha256)


def verify(root: Path, *, check_inventory: bool = True) -> dict[str, object]:
    if importlib.metadata.version('jsonschema') != '4.26.0':
        raise CheckError('use jsonschema==4.26.0 from tools/requirements.txt')
    counts: dict[str, object] = {}
    json_count = 0
    toml_count = 0
    schema_count = 0
    for path in sorted(root.rglob('*')):
        if path.is_symlink():
            raise CheckError('package contains a symlink')
        if not path.is_file() or '__pycache__' in path.parts:
            continue
        if path.suffix == '.json':
            data = load(root, path.relative_to(root).as_posix())
            json_count += 1
            if path.name.endswith('.schema.json') or path.name == 'agent-attestation.schema.json':
                check_schema(data)
                schema_count += 1
        elif path.suffix == '.toml':
            tomllib.loads(path.read_text(encoding='utf-8'))
            toml_count += 1
    counts.update(json_files=json_count, toml_files=toml_count, schemas=schema_count)
    counts.update(check_traceability(root))
    check_policy(load(root, 'config/orchestration-policy.json'))
    config = tomllib.loads((root / 'config/codex.fragment.toml').read_text())
    if config['agents']['default_subagent_model'] != 'gpt-5.6-luna' or config['agents']['default_subagent_reasoning_effort'] != 'max':
        raise CheckError('TOML descendant defaults mismatch')
    attestation = load(root, 'templates/agent-attestation.template.json')
    if schema_errors(attestation, load(root, 'orchestration/agent-attestation.schema.json')):
        raise CheckError('invalid not-run attestation template')
    index = load(root, 'examples/fixture-index.json')
    for item in index['fixtures']:
        check_fixture(root, item)
    for item in index['reference_validations']:
        if schema_errors(load(root, item['path']), load(root, item['schema'])):
            raise CheckError('copied Phase-1 seed fixture invalid')
    first, moved = [load(root, path) for path in index['layout_only_pair']]
    if first['binding'] != moved['binding'] or first['nodes'] == moved['nodes']:
        raise CheckError('layout-only pair did not retain identical semantic binding')
    counts.update(studio_fixtures=len(index['fixtures']), reference_fixtures=len(index['reference_validations']))
    provenance = load(root, 'sources/reference-provenance.json')
    for item in provenance['files']:
        if sha256(safe_path(root, item['package_path'])) != item['sha256']:
            raise CheckError('reference bytes changed')
    counts['reference_copies'] = len(provenance['files'])
    checked_links = 0
    for path in root.rglob('*.md'):
        if 'reference/phase1' in path.relative_to(root).as_posix():
            continue  # Exact historical excerpt links may refer to the full original archive.
        for target in re.findall(r'(?<!!)\[[^\]\n]+\]\(([^)\s]+)\)', path.read_text(encoding='utf-8')):
            if '://' in target or target.startswith(('#', 'mailto:')):
                continue
            target = unquote(target.split('#', 1)[0])
            resolved = (path.parent / target).resolve()
            if not resolved.is_relative_to(root.resolve()) or not resolved.exists():
                raise CheckError(f'missing/outside local Markdown target in {path.name}: {target}')
            checked_links += 1
    counts['local_markdown_links'] = checked_links
    ops = load(root, 'contracts/operation-needs.json')['operations']
    if len({row['logical_name'] for row in ops}) != len(ops) or any(row['actual_route'] is not None for row in ops):
        raise CheckError('logical operation map falsely implies resolved routes')
    counts['logical_operations'] = len(ops)
    if check_inventory:
        counts['files_in_archive_root'] = check_manifest(root)
    counts['scope'] = 'package integrity and synthetic seed checks only; product not implemented or tested'
    return counts


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument('--preflight', action='store_true', help='Build-time checks before inventory exists; not a full package pass')
    args = parser.parse_args()
    try:
        result = verify(args.root.resolve(), check_inventory=not args.preflight)
    except (CheckError, OSError, KeyError, ValueError, ImportError, importlib.metadata.PackageNotFoundError) as exc:
        print(f'PACKAGE CHECK FAILED: {exc}', file=sys.stderr)
        return 1
    print(json.dumps({'status': 'preflight_pass' if args.preflight else 'pass', 'checks': result}, indent=2))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
