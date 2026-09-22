"""Small author-written execution probe, NOT a clinical or independent retrieval benchmark.

Run in a dedicated environment, not the app's dependency graph. The source catalog is
public repository material. Patient/user documents must never be supplied to this probe.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import random
import resource
import sys
import time

REPO = 'convaiinnovations/laya-multilingual'
SDK_COMMIT = 'c7527708f9f5220c669d8aa385077cd28d04708a'


def hashes(root: Path) -> dict[str, str]:
    result = {}
    for path in sorted(root.rglob('*')):
        if path.is_file() and '.cache' not in path.parts:
            with path.open('rb') as handle:
                result[path.relative_to(root).as_posix()] = hashlib.file_digest(handle, 'sha256').hexdigest()
    return result


def acquire(destination: Path, revision: str | None) -> dict:
    from huggingface_hub import HfApi, snapshot_download
    info = HfApi(token=False).model_info(REPO, revision=revision, files_metadata=True)
    selected = [s for s in info.siblings if s.rfilename in {'model.safetensors', 'rl_agent_config.json', 'encoder/config.json'}
                or (s.rfilename.startswith('tokenizer/') and s.rfilename.endswith(('.json', '.txt', '.model')))]
    total = sum(s.size or 0 for s in selected)
    if not info.sha or total > 2 * 1024**3 or total < 100 * 1024**2:
        raise ValueError('Unexpected multilingual checkpoint size/revision')
    names = [s.rfilename for s in selected]
    snapshot_download(REPO, revision=info.sha, allow_patterns=names,
                      local_dir=str(destination), token=False, max_workers=2)
    for sibling in selected:
        path = destination / sibling.rfilename
        if not path.is_file() or (sibling.size is not None and path.stat().st_size != sibling.size):
            raise ValueError('Downloaded checkpoint size mismatch')
        if sibling.lfs and sibling.lfs.sha256:
            with path.open('rb') as handle:
                if hashlib.file_digest(handle, 'sha256').hexdigest() != sibling.lfs.sha256:
                    raise ValueError('Downloaded checkpoint digest mismatch')
    return {'repository': REPO, 'revision': info.sha, 'downloadedBytes': total,
            'sdkCommit': SDK_COMMIT, 'filesBeforeLoad': hashes(destination)}


def probes(catalog: dict) -> list[dict]:
    entries = {row['id'].removeprefix('draft.definition.'): row for row in catalog['terms']}
    reverse = [
        ('anosmia', 'Не чувствует ни запах кофе, ни запах духов.', ['anosmia', 'hyposmia', 'dysphagia', 'aphasia']),
        ('hyposmia', 'Запахи различает, но они стали гораздо слабее.', ['anosmia', 'hyposmia', 'dysphagia', 'aphasia']),
        ('dysphagia', 'Пища и жидкость проглатываются с большим трудом.', ['dysphagia', 'aphasia', 'apraxia', 'atrophy']),
        ('aphasia', 'После повреждения мозга нарушились понимание речи, чтение и письмо.', ['aphasia', 'apraxia', 'dementia', 'dysphagia']),
        ('apraxia', 'Не может выполнить ранее освоенную последовательность действий при одевании.', ['apraxia', 'aphasia', 'dementia', 'atrophy']),
        ('depersonalization', 'Собственные чувства и мысли переживаются чужими, будто изменилось собственное я.', ['depersonalization', 'derealization', 'illusion', 'delusional-mood']),
        ('derealization', 'Знакомые предметы вокруг кажутся ненастоящими, словно декорации.', ['depersonalization', 'derealization', 'illusion', 'delusional-mood']),
        ('fixation-amnesia', 'Не удерживает в памяти только что произошедшие события.', ['fixation-amnesia', 'anterograde-amnesia', 'cryptomnesia', 'ecmnesia']),
    ]
    result = []
    for index, (target, query, candidates) in enumerate(reverse):
        random.Random(2300 + index).shuffle(candidates)
        options = {f'v{i}': entries[name]['title'] + ': ' + entries[name]['definition'] for i, name in enumerate(candidates)}
        expected = f'v{candidates.index(target)}'
        result.append({'id': f'definition-{index+1}', 'family': 'definition-choice', 'state': query,
                       'instructions': 'Какое приведённое определение лучше соответствует описанию? Выберите по текстам вариантов, не ставьте диагноз.',
                       'criteria': options, 'expected': expected,
                       'sourceIds': [entries[n]['id'] for n in candidates]})
    support_options = {'yes': 'Утверждение явно подтверждается приведённым текстом.',
                       'no': 'Утверждение прямо противоречит приведённому тексту.',
                       'unknown': 'В приведённом тексте недостаточно сведений.'}
    claims = [
        ('anosmia', 'Запахи не ощущаются.', 'yes'),
        ('anosmia', 'Обоняние полностью сохранено.', 'no'),
        ('anosmia', 'Нарушение продолжается ровно три дня.', 'unknown'),
        ('fixation-amnesia', 'Только что произошедшее не удерживается в памяти.', 'yes'),
        ('fixation-amnesia', 'Текущие события запоминаются без нарушений.', 'no'),
        ('fixation-amnesia', 'Пациенту четыре года.', 'unknown'),
    ]
    for index, (key, claim, expected) in enumerate(claims):
        result.append({'id': f'evidence-{index+1}', 'family': 'evidence-support',
                       'state': {'source': entries[key]['definition'], 'claim': claim},
                       'instructions': 'Подтверждает ли только приведённый источник утверждение? Не добавляйте внешние знания.',
                       'criteria': support_options, 'expected': expected, 'sourceIds': [entries[key]['id']]})
    for index, (state, expected) in enumerate([
        ('Пациент сообщает: сейчас мне трудно глотать пищу.', 'yes'),
        ('Пациент отрицает затруднение глотания, ест свободно.', 'no'),
        ('У матери пациента затруднено глотание. О глотании самого пациента сведений нет.', 'unknown'),
        ('Год назад пациент испытывал затруднения при глотании. Сейчас ест свободно, симптом прошёл.', 'no'),
    ]):
        result.append({'id': f'case-language-{index+1}', 'family': 'negation-subject-time',
                       'state': state, 'instructions': 'Есть ли в тексте подтверждение затруднения глотания у самого пациента сейчас?',
                       'criteria': support_options, 'expected': expected, 'sourceIds': []})
    return result


def run(model_path: Path, catalog_path: Path, acquired: dict) -> dict:
    os.environ.update({'HF_HUB_OFFLINE': '1', 'TRANSFORMERS_OFFLINE': '1', 'HF_HUB_DISABLE_TELEMETRY': '1', 'USE_TF': '0', 'USE_FLAX': '0', 'TOKENIZERS_PARALLELISM': 'false'})
    network_attempts = 0
    def guard(event, _):
        nonlocal network_attempts
        if event in {'socket.connect', 'socket.getaddrinfo'}:
            network_attempts += 1
            raise RuntimeError('Inference must not make network requests')
    sys.addaudithook(guard)
    import torch
    import laya
    from laya.common import build_sequence, serialize_state, render_options
    torch.set_num_threads(2)
    torch.manual_seed(23)
    started = time.perf_counter()
    agent = laya.load(str(model_path.resolve()), device='cpu')
    load_seconds = time.perf_counter() - started
    raw = catalog_path.read_bytes()
    cases = probes(json.loads(raw))
    dataset_hash = hashlib.sha256(json.dumps(cases, ensure_ascii=False, sort_keys=True).encode()).hexdigest()
    outcomes = []
    for case in cases:
        predictions = []
        for reverse in (False, True):
            criteria = dict(reversed(list(case['criteria'].items()))) if reverse else dict(case['criteria'])
            question = {'type': 'choice', 'instructions': case['instructions'], 'criteria': criteria}
            internal = {'t': 'choice', 'ins': case['instructions'], 'crit': criteria}
            limit = int(agent.cfg.get('max_len', 1024))
            head_limit = int(agent.cfg.get('head_max_len', 256))
            # Reject any loss of input, question or options instead of allowing silent truncation.
            enc = lambda value: agent.tok(value, add_special_tokens=False)['input_ids']
            options = render_options(internal)
            option_ids = [enc(' ' + opt.replace(agent.tok.mask_token, ' ')) for opt in options]
            header_ids = enc('choice question: ' + case['instructions'].replace(agent.tok.mask_token, ' '))
            if any(len(ids) > 48 for ids in option_ids) or len(header_ids) + sum(len(ids)+1 for ids in option_ids) > head_limit:
                raise ValueError('Probe exceeds the question/options budget')
            state_ids = enc(serialize_state(case['state']).replace(agent.tok.mask_token, ' '))
            ids, markers = build_sequence(agent.tok, case['state'], internal, max_len=limit, head_max_len=head_limit)
            if len(ids) != 4 + len(header_ids) + sum(len(v)+1 for v in option_ids) + len(state_ids) or len(markers) != len(options):
                raise ValueError('Probe was truncated or option markers were lost')
            start = time.perf_counter()
            answer = agent.predict(case['state'], {'probe': question})['answers']['probe']
            elapsed = (time.perf_counter() - start) * 1000
            predictions.append({'choice': answer['choice'], 'confidence': answer['confidence'],
                                'probabilities': answer['probabilities'], 'latencyMs': elapsed, 'tokens': len(ids)})
        outcomes.append({'id': case['id'], 'family': case['family'], 'expected': case['expected'],
                         'correct': predictions[0]['choice'] == case['expected'],
                         'orderChanged': predictions[0]['choice'] != predictions[1]['choice'],
                         'predictions': predictions, 'sourceIds': case['sourceIds']})
    families = {}
    for family in sorted({row['family'] for row in outcomes}):
        rows = [row for row in outcomes if row['family'] == family]
        families[family] = {'total': len(rows), 'correct': sum(row['correct'] for row in rows),
                            'orderChanges': sum(row['orderChanged'] for row in rows)}
    return {'status': 'executed', 'model': acquired, 'filesAfterLoad': hashes(model_path),
            'sourceCatalogSha256': hashlib.sha256(raw).hexdigest(), 'probeDatasetSha256': dataset_hash,
            'families': families, 'outcomes': outcomes, 'networkAttemptsDuringInference': network_attempts,
            'modelLoadSeconds': load_seconds, 'maxProcessRssKiB': resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
            'parameters': sum(p.numel() for p in agent.model.parameters()), 'device': str(agent.device),
            'runtime': {p: importlib.metadata.version(p) for p in ['laya', 'torch', 'transformers', 'huggingface-hub', 'safetensors', 'numpy']},
            'boundary': '18 authored probes / 36 executions with reversed options. Source-derived draft definitions, small fixed candidate pools, no training or tuning. Not an independent clinical benchmark, full-corpus retrieval/reranking comparison, quantized/browser/mobile run, or proof of citation correctness. No patient data. No application integration.'}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--model-dir', type=Path, required=True)
    parser.add_argument('--catalog', type=Path, required=True)
    parser.add_argument('--report', type=Path, required=True)
    parser.add_argument('--revision')
    args = parser.parse_args()
    args.report.parent.mkdir(parents=True, exist_ok=True)
    try:
        acquired = acquire(args.model_dir, args.revision)
        result = run(args.model_dir, args.catalog, acquired)
    except Exception as exc:
        result = {'status': 'failed', 'errorType': type(exc).__name__, 'error': str(exc)[:800],
                  'boundary': 'No successful model evaluation is claimed.'}
        args.report.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
        raise
    args.report.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({'status': result['status'], 'families': result['families'],
                      'modelRevision': result['model']['revision']}, ensure_ascii=False))


if __name__ == '__main__':
    main()
