"""Tests of the package checker, not tests of the proposed Studio product."""
from __future__ import annotations
import copy
import json
from pathlib import Path
import tempfile
import unittest

from package_checks import (CheckError, check_command, check_dag, check_layout,
                            check_manifest, check_policy, check_schema,
                            fold_display_fixture, load, safe_path, schema_errors,
                            sha256, strict_json)
ROOT = Path(__file__).resolve().parents[1]


class JsonChecks(unittest.TestCase):
    def test_valid_json(self):
        self.assertEqual(strict_json('{"count": 2, "label":"map"}')['count'], 2)

    def test_duplicate_keys(self):
        with self.assertRaises(CheckError):
            strict_json('{"mode":"strict","mode":"dynamic"}')

    def test_nonfinite_constant(self):
        for value in ('NaN', 'Infinity', '-Infinity'):
            with self.subTest(value=value), self.assertRaises(CheckError):
                strict_json('{"x":'+value+'}')

    def test_overflow_exponent(self):
        with self.assertRaises(CheckError):
            strict_json('{"x":1e9999}')

    def test_malformed_json(self):
        with self.assertRaises(CheckError):
            strict_json('{')

    def test_remote_ref_forbidden(self):
        with self.assertRaises(CheckError):
            check_schema({'type':'object','$ref':'https://example.invalid/schema'})


class LayoutAndCommandChecks(unittest.TestCase):
    def setUp(self):
        self.layout = load(ROOT, 'examples/fixtures/layout-valid.json')
        self.definition = (ROOT / 'reference/phase1/examples/workflows/strict-fixture.json').read_bytes()

    def test_layout_binding(self):
        check_layout(self.layout, self.definition)

    def test_layout_movement_keeps_binding(self):
        moved = copy.deepcopy(self.layout)
        moved['nodes'][0]['x'] += 10
        check_layout(moved, self.definition)
        self.assertEqual(moved['binding'], self.layout['binding'])

    def test_layout_bad_hash(self):
        self.layout['binding']['definition_artifact_sha256'] = '0'*64
        with self.assertRaises(CheckError):
            check_layout(self.layout, self.definition)

    def test_layout_dangling_node(self):
        self.layout['nodes'][0]['node_id'] = 'missing'
        with self.assertRaises(CheckError):
            check_layout(self.layout, self.definition)

    def test_layout_duplicate(self):
        self.layout['nodes'].append(copy.deepcopy(self.layout['nodes'][0]))
        with self.assertRaises(CheckError):
            check_layout(self.layout, self.definition)

    def test_layout_rejects_authority_override(self):
        self.layout['skip_settlement'] = True
        self.assertTrue(schema_errors(self.layout, load(ROOT, 'contracts/studio-layout-v1.schema.json')))

    def test_unknown_cannot_claim_applied_revision(self):
        value = load(ROOT, 'examples/fixtures/command-unknown-valid.json')
        value['applied_run_revision'] = 7
        self.assertTrue(schema_errors(value, load(ROOT, 'contracts/command-view-v1.schema.json')))

    def test_applied_revision_cannot_regress(self):
        value = load(ROOT, 'examples/fixtures/command-applied-valid.json')
        value['applied_run_revision'] = 0
        with self.assertRaises(CheckError):
            check_command(value)


class DisplayFixtureChecks(unittest.TestCase):
    def outcome(self, name):
        return fold_display_fixture(load(ROOT, f'examples/fixtures/{name}.json'))

    def test_contiguous(self):
        self.assertEqual(self.outcome('stream-contiguous'), 'current')

    def test_duplicate_is_not_reapplied(self):
        self.assertEqual(self.outcome('stream-duplicate'), 'current')

    def test_gap_requires_resnapshot(self):
        self.assertEqual(self.outcome('stream-gap'), 'needs_resnapshot')

    def test_foreign_run_rejected(self):
        self.assertEqual(self.outcome('stream-wrong-run'), 'binding_rejected')

    def test_conflicting_duplicate_rejected(self):
        self.assertEqual(self.outcome('stream-conflicting-duplicate'), 'conflicting_duplicate')

    def test_duplicate_id_new_sequence_rejected(self):
        self.assertEqual(self.outcome('stream-duplicate-id-new-sequence'), 'conflicting_duplicate')

    def test_unretained_old_event_requires_resnapshot(self):
        self.assertEqual(self.outcome('stream-old-outside-window'), 'needs_resnapshot')

    def test_foreign_definition_rejected(self):
        self.assertEqual(self.outcome('stream-wrong-digest'), 'binding_rejected')


class OrchestrationChecks(unittest.TestCase):
    def test_task_graph_acyclic(self):
        check_dag(load(ROOT, 'orchestration/tasks.json')['tasks'])

    def test_cycle_rejected(self):
        with self.assertRaises(CheckError):
            check_dag([{'id':'a','depends_on':['b']},{'id':'b','depends_on':['a']}])

    def test_missing_dependency_rejected(self):
        with self.assertRaises(CheckError):
            check_dag([{'id':'a','depends_on':['b']}])

    def test_duplicate_task_rejected(self):
        with self.assertRaises(CheckError):
            check_dag([{'id':'a','depends_on':[]},{'id':'a','depends_on':[]}])

    def test_model_substitution_rejected(self):
        value = load(ROOT, 'config/orchestration-policy.json')
        value['descendant_model'] = 'some-other-model'
        with self.assertRaises(CheckError):
            check_policy(value)

    def test_fourth_level_rejected(self):
        value = load(ROOT, 'config/orchestration-policy.json')
        value['maximum_descendant_depth'] = 4
        with self.assertRaises(CheckError):
            check_policy(value)

    def test_no_fake_verified_attestation(self):
        value = load(ROOT, 'templates/agent-attestation.template.json')
        value['status'] = 'verified'
        self.assertTrue(schema_errors(value, load(ROOT, 'orchestration/agent-attestation.schema.json')))

    def test_leaf_cannot_spawn(self):
        value = load(ROOT, 'templates/agent-attestation.template.json')
        value.update(depth=3, may_spawn=True)
        self.assertTrue(schema_errors(value, load(ROOT, 'orchestration/agent-attestation.schema.json')))

    def test_empty_attestation_is_not_execution(self):
        value = load(ROOT, 'templates/agent-attestation.template.json')
        self.assertFalse(schema_errors(value, load(ROOT, 'orchestration/agent-attestation.schema.json')))
        self.assertEqual(value['status'], 'not_run')
        self.assertFalse(value['native_parentage_verified'])


class IntegrityChecks(unittest.TestCase):
    def test_traversal_rejected(self):
        for relative in ('../secret', '/tmp/secret', 'C:\\secret', 'tools/../../secret'):
            with self.subTest(relative=relative), self.assertRaises(CheckError):
                safe_path(ROOT, relative)

    def test_checksum_tamper_detected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            data = root / 'sample.txt'
            data.write_text('safe', encoding='utf-8')
            manifest = {'files':[{'path':'sample.txt','size_bytes':4,'sha256':sha256(data)}]}
            (root / 'PACKAGE_MANIFEST.json').write_text(json.dumps(manifest), encoding='utf-8')
            (root / 'SHA256SUMS').write_text(
                f"{sha256(data)}  sample.txt\n{sha256(root / 'PACKAGE_MANIFEST.json')}  PACKAGE_MANIFEST.json\n",
                encoding='utf-8')
            self.assertEqual(check_manifest(root), 3)
            data.write_text('evil', encoding='utf-8')
            with self.assertRaises(CheckError):
                check_manifest(root)

    def test_extra_member_detected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'PACKAGE_MANIFEST.json').write_text('{"files":[]}', encoding='utf-8')
            (root / 'unlisted.txt').write_text('extra', encoding='utf-8')
            with self.assertRaises(CheckError):
                check_manifest(root)


if __name__ == '__main__':
    unittest.main()
