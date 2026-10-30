"""Validate submission structure and prohibited test shortcuts without calling AI."""
from pathlib import Path
import re
import yaml

ROOT = Path(__file__).resolve().parents[1]
problem = yaml.safe_load((ROOT/'docs/problem.yaml').read_text(encoding='utf-8'))
document = yaml.safe_load((ROOT/'docs/scenarios.yaml').read_text(encoding='utf-8'))
assert document['platform'] in ('desktop', 'mobile', 'both')
assert isinstance(document['platformReason'], str) and document['platformReason'].strip()
scenarios = document['scenarios']
assert 3 <= len(scenarios) <= 8
ids = [s['id'] for s in scenarios]
assert len(set(ids)) == len(ids)
bad = re.compile(r'\btest\.(?:skip|fixme|only)\b|\bpage\.route\s*\(|\broute\.fulfill\s*\(|routeFromHAR|routeFromHar|routeWebSocket|addInitScript|\btry\s*\{|\bcatch\s*\(')
conditional_return = re.compile(r'\bif\s*\([^;]*?\)\s*(?:\{[^{}]*?)?\breturn\b', re.S)
for scenario in scenarios:
    assert re.fullmatch(r'S[1-9]\d*', scenario['id'])
    assert isinstance(scenario['title'], str) and 1 <= len(scenario['title']) <= 120
    assert 1 <= len(scenario['steps']) <= 12
    assert all(isinstance(s, str) and s.strip() for s in scenario['steps'])
    assert isinstance(scenario['expected'], str) and scenario['expected'].strip()
    spec = ROOT/'e2e/scenarios'/f"{scenario['id']}.spec.ts"
    text = spec.read_text(encoding='utf-8')
    code = re.sub(r'^\s*//.*$', '', text, flags=re.M)
    assert not bad.search(code), f'Prohibited shortcut in {spec.name}'
    assert not conditional_return.search(code), f'Conditional early exit in {spec.name}'
    visits = re.findall(r'page\.goto\(([^\n;]*)', code)
    assert len(visits) <= 1, f'Only the initial navigation is allowed: {spec.name}'
    assert not re.search(r'page\.goto\([\"\x27]/(?:import|studio|coach)\.', code), f'Enter through homepage menus: {spec.name}'
    assert not re.search(r'https?://(?:localhost|127\.0\.0\.1)', code), f'Absolute app URL: {spec.name}'
assert {p.stem for p in (ROOT/'e2e/scenarios').glob('S*.spec.ts')} == {f'{sid}.spec' for sid in ids}
assert all(set(source) == {'id','url','title','claim'} for source in problem['sources'])
assert len({s['id'] for s in problem['sources']}) == len(problem['sources'])
assert all(s['url'].startswith('https://') and s['claim'].strip() for s in problem['sources'])
assert not {'F8','F15'} & {f['id'] for f in problem['features']}
assert all(not re.search(r'보장하지|판정하지|미검증|확정하지|개발 예정', f['done']) for f in problem['features'])
assert {'S1','S4','S8','S9'} <= set(ids), 'Every chosen solution path needs an end-to-end scenario'
compose = yaml.safe_load((ROOT/'docker-compose.yml').read_text(encoding='utf-8'))['services']['app']
assert '3000:3000' in compose['ports']
assert compose['environment']['AI_GATEWAY_API_KEY'] == '${AI_GATEWAY_API_KEY:-}'
assert compose['environment']['AI_PROVIDER'] == '${AI_PROVIDER:-gateway}'
docker = (ROOT/'Dockerfile').read_text(encoding='utf-8')
assert 'FROM node:22-alpine' in docker and 'local-ai/start.mjs' not in docker
print(f'Validated {len(problem["features"])} features, {len(problem["sources"])} sources, {len(scenarios)} scenarios and test rules')
