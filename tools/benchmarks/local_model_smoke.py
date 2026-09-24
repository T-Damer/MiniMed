"""Real CPU execution check, deliberately not a medical accuracy benchmark."""
import json
from pathlib import Path
import resource
import time

from local_reranker import CpuScorer, REVISION, disable_network, rank


def main():
    root = Path(__file__).resolve().parents[2]
    candidates = []
    for index, name in enumerate(('kandinsky-clerambault', 'voskresensky-shirt', 'capillary-refill')):
        source = (root / 'content/definition-pilot' / f'{name}.md').read_text()
        definition = source.split('# Определение\n', 1)[1].split('# Уточнение', 1)[0]
        definition = '\n'.join(line for line in definition.splitlines() if not line.startswith('<!--')).strip()
        candidates.append({'id': f'candidate-{index}', 'text': definition})
    disable_network()
    started = time.perf_counter()
    scorer = CpuScorer(root / '.cache/minimed/ru-reranker')
    load_ms = (time.perf_counter() - started) * 1000
    request = {'query': 'переживание постороннего воздействия на собственные психические процессы',
               'analysisMode': 'clinical', 'candidates': candidates}
    first = rank(request, scorer)
    second = rank(request, scorer)
    assert first['status'] == second['status'] == 'observe', 'Real model inference failed'
    assert first['experimentalIds'] == second['experimentalIds'], 'Non-deterministic eval order'
    assert not first['applied'] and first['orderedIds'] == [row['id'] for row in candidates]
    print('REAL_OFFLINE_CPU_SMOKE', json.dumps({'revision': REVISION, 'loadMs': load_ms,
        'firstInferenceMs': first['inferenceMs'], 'warmInferenceMs': second['inferenceMs'],
        'parameters': sum(p.numel() for p in scorer.model.parameters()),
        'peakRssKiBOnLinux': resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
        'candidateCount': len(candidates), 'networkAuditEnabled': True,
        'meaning': 'execution only, no accuracy claim'}))


if __name__ == '__main__':
    main()
