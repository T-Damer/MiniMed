import gzip
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from urllib.parse import quote

spec = importlib.util.spec_from_file_location('builder', Path(__file__).with_name('build-definition-corpus.py'))
assert spec is not None and spec.loader is not None
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)


class CorpusTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.source = {'schemaVersion': 1, 'license': 'CC-BY-SA-4.0', 'sourceProject': 'ru.wiktionary.org', 'sha256': 'a' * 64, 'retrievedAt': '2026-09-16T00:00:00Z', 'attribution': 'Fixture contributors', 'url': 'https://kaikki.org/dictionary/downloads/ru/ru-extract.jsonl.gz'}
        self.row = {'id': 'ruwikt.' + 'b' * 24, 'word': 'Тест', 'partOfSpeech': 'noun', 'glosses': ['Первая дефиниция.', 'Вторая дефиниция.'], 'subjects': ['medicine'], 'sourceSha256': 'sha256:' + 'a' * 64, 'recordSha256': 'sha256:' + 'c' * 64, 'sourceLine': 17, 'senseIndex': 0, 'sourceUrl': 'https://ru.wiktionary.org/wiki/' + quote('Тест', safe='')}

    def run_build(self, rows=None, expected=1):
        source = self.root / 'source.json'
        source.write_text(json.dumps(self.source), encoding='utf-8')
        senses = self.root / 'senses.jsonl.gz'
        with gzip.open(senses, 'wt', encoding='utf-8') as stream:
            for row in rows if rows is not None else [self.row]:
                stream.write(json.dumps(row, ensure_ascii=False) + '\n')
        return builder.build(senses, source, expected_senses=expected)

    def test_preserves_glosses_identity_and_provenance(self):
        catalog, report = self.run_build()
        row = catalog['terms'][0]
        self.assertEqual(row['definition'], '\n'.join(self.row['glosses']))
        self.assertEqual(row['id'], self.row['id'])
        self.assertEqual(report['suppliedRussianGlosses'], 2)
        self.assertEqual(row['references'][0]['source'], catalog['sources'][0]['id'])
        self.assertEqual(row['references'][0]['recordSha256'], self.row['recordSha256'])
        self.assertEqual(catalog['textKind'], 'source-gloss')
        self.assertEqual(catalog['reviewStatus'], 'requires-review')
        self.assertEqual(row['aliases'], [])

    def test_deterministic_and_numeric_source_deduplication(self):
        second = {**self.row, 'id': 'ruwikt.' + 'd' * 24}
        a, report = self.run_build([self.row, second], 2)
        b, _ = self.run_build([second, self.row], 2)
        self.assertEqual(a['terms'], b['terms'])
        self.assertEqual(len(a['sources']), 1)
        self.assertEqual(report['distinctNames'], 1)
        self.assertEqual(report['senses'], 2)

    def test_refuses_duplicate_senses(self):
        with self.assertRaises(ValueError): self.run_build([self.row, self.row], 2)

    def test_refuses_wrong_snapshot(self):
        self.row['sourceSha256'] = 'sha256:' + 'e' * 64
        with self.assertRaises(ValueError): self.run_build()

    def test_refuses_missing_definitions(self):
        self.row['glosses'] = []
        with self.assertRaises(ValueError): self.run_build()

    def test_refuses_wrong_source_page(self):
        self.row['sourceUrl'] = 'https://example.com/'
        with self.assertRaises(ValueError): self.run_build()

    def test_refuses_unadmitted_subject(self):
        self.row['subjects'] = ['unrelated']
        with self.assertRaises(ValueError): self.run_build()

    def test_refuses_unknown_rights(self):
        self.source['license'] = 'unknown'
        with self.assertRaises(ValueError): self.run_build()

    def test_refuses_partial_count(self):
        with self.assertRaises(ValueError): self.run_build(expected=6939)

    def test_marks_cross_reference_without_inventing_expansion(self):
        self.row['glosses'] = ['то же, что другой термин']
        catalog, report = self.run_build()
        self.assertEqual(catalog['terms'][0]['definitionKind'], 'cross-reference')
        self.assertEqual(report['crossReferenceLikeSenses'], 1)
        self.assertEqual(catalog['terms'][0]['definition'], self.row['glosses'][0])

    def test_refuses_boolean_line_number(self):
        self.row['sourceLine'] = True
        with self.assertRaises(ValueError): self.run_build()


if __name__ == '__main__':
    unittest.main()
