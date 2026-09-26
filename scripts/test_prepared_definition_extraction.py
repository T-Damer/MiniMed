"""Offline synthetic tests; real source counts are measured separately."""
import importlib.util
import json
import sqlite3
import tempfile
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('extractor', Path(__file__).with_name('extract_prepared_definitions.py'))
assert spec and spec.loader
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class ExtractionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.path = self.root / 'source.db'
        connection = sqlite3.connect(self.path)
        connection.executescript('''
        CREATE TABLE documents(id TEXT PRIMARY KEY,title TEXT,source_type TEXT,metadata_json TEXT,current_version_id TEXT);
        CREATE TABLE document_versions(id TEXT PRIMARY KEY,source_checksum TEXT);
        CREATE TABLE sections(id TEXT PRIMARY KEY,document_version_id TEXT,title TEXT,section_type TEXT,order_index INTEGER);
        CREATE TABLE chunks(id TEXT PRIMARY KEY,section_id TEXT,anchor TEXT,original_text TEXT,order_index INTEGER);
        INSERT INTO documents VALUES('d','Тестовый источник','medical_reference','{}','v');
        INSERT INTO document_versions VALUES('v','source-checksum');
        INSERT INTO sections VALUES('s','v','Термины и определения','definition',0);
        INSERT INTO chunks VALUES('c','s','anchor','Альфа — первое определение.\n\nБета — второе определение.',0);
        ''')
        connection.close()
        self.collector = module.Collector('fixture')

    def run_scan(self):
        before = self.path.read_bytes()
        module.scan_sqlite(self.path, self.collector, 'a' * 40)
        self.assertEqual(before, self.path.read_bytes())
        return self.collector.catalog

    def test_extracts_multiple_explicit_definitions_without_rewriting(self):
        result = self.run_scan()
        self.assertEqual([t['title'] for t in result['terms']], ['Альфа', 'Бета'])
        self.assertEqual(result['blocks'][0]['text'], 'Альфа — первое определение.')
        self.assertEqual(result['blocks'][0]['charStart'], 0)
        self.assertEqual(result['terms'][0]['coverage'], 'explicit-definition')

    def test_preserves_each_locator_and_numeric_source(self):
        result = self.run_scan()
        self.assertEqual(len(result['sources']), 1)
        self.assertTrue(all(b['source'] == 3001 and b['chunkId'] == 'c' and b['anchor'] == 'anchor' for b in result['blocks']))

    def test_excludes_pointer_content(self):
        with sqlite3.connect(self.path) as c:
            c.execute("UPDATE documents SET source_type='core_catalog_pointer'")
        self.assertEqual(self.run_scan()['terms'], [])

    def test_excludes_synthetic_source(self):
        with sqlite3.connect(self.path) as c:
            c.execute('UPDATE documents SET metadata_json=?', (json.dumps({'syntheticFixture': True}),))
        self.assertEqual(self.run_scan()['terms'], [])

    def test_does_not_invent_definition_for_narrative_mention(self):
        with sqlite3.connect(self.path) as c:
            c.execute("UPDATE sections SET title='Обсуждение',section_type='other'")
            c.execute("UPDATE chunks SET original_text='В тексте упоминается шкала Альфа, но её содержание отсутствует.'")
        result = self.run_scan()
        self.assertEqual(result['terms'], [])
        self.assertEqual(len(self.collector.mentions), 1)
        self.assertEqual(self.collector.mentions[0]['coverage'], 'mention-only')

    def test_reuses_source_blocks(self):
        first = self.collector.block(1, 'Text', 'p1')
        self.assertEqual(first, self.collector.block(1, 'Text', 'p1'))
        self.assertNotEqual(first, self.collector.block(1, 'Text', 'p2'))

    def test_rejects_conflicting_term_identity(self):
        self.collector.term('one', 'Альфа', 'term', [1])
        with self.assertRaises(ValueError):
            self.collector.term('one', 'Бета', 'term', [1])

    def test_does_not_overwrite_existing_outputs(self):
        output, report = self.root / 'output.json', self.root / 'report.json'
        self.collector.save(output, report)
        with self.assertRaises(ValueError):
            self.collector.save(output, report)

    def test_keeps_complete_instrument_section_without_scoring_invention(self):
        with sqlite3.connect(self.path) as c:
            c.execute("UPDATE sections SET title='Шкала Альфа',section_type='other'")
            c.execute("UPDATE chunks SET original_text='1. Первый пункт.\n2. Второй пункт. Оговорка источника.'")
        term = self.run_scan()['terms'][0]
        self.assertEqual(term['coverage'], 'section-excerpt')
        self.assertEqual(term['kind'], 'scale')
        self.assertNotIn('scoring', term)
        self.assertNotIn('interactiveRoute', term)

    def test_rejects_quality_assurance_as_clinical_instrument(self):
        with sqlite3.connect(self.path) as c:
            c.execute("UPDATE sections SET title='Критерии оценки качества медицинской помощи',section_type='other'")
            c.execute("UPDATE chunks SET original_text='Наличие оформленной документации.'")
        self.assertEqual(self.run_scan()['terms'], [])


if __name__ == '__main__':
    unittest.main()
