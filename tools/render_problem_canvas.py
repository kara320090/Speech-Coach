"""Render the paper canvas from the submission YAML; --check verifies it is current."""
from pathlib import Path
import argparse
import yaml

ROOT = Path(__file__).resolve().parents[1]

def render(data):
    out = ['# 문제 정의 캔버스 — 앞면·뒷면', '', '원자료는 [problem.yaml](problem.yaml)이다. 이 문서는 `python tools/render_problem_canvas.py`로 생성한다. 해석 범위·처리 위치는 [decisions.md](decisions.md), 검사 연결은 [traceability.md](traceability.md)를 따른다.', '', '## 앞면', '', '### 한 문장 문제 정의', '', data['statement'], '']
    canvas = data['canvas']
    for label, key in [('① 상황', 'context'), ('② 고객', 'customer'), ('③ 근본 문제', 'root_problem')]:
        out += [f'### {label}', '', canvas[key], '']
    out += ['### ④ 영향', '', '**그때 한 말·기분:** ' + canvas['impact']['feeling'], '', '**잃은 시간·기회:** ' + canvas['impact']['measurable'], '', '### ⑤ 현재 대안 · ⑥ 남는 불편과 우리 해법', '']
    for i, item in enumerate(canvas['alternatives'], 1):
        out += [f'#### A{i}', '', '**현재 방법:** ' + item['how_used'], '', '**남는 불편:** ' + item['shortcoming'], '', '**우리 해법:** ' + item['why_ours'], '']
    out += ['## 뒷면', '', '### 1. 관찰 정황', '']
    for item in data['personas']:
        out += [f"**{item['id']} — 대상:** {item['description']}", '', '**출처:** ' + item['source'], '']
    for item in data['experiences']:
        out += [f"#### {item['id']} — 경험", '']
        for label, key in [('언제', 'when'), ('무슨 일', 'what_happened'), ('어떻게 버텼나', 'workaround'), ('그때 기분', 'feeling'), ('직접 인용', 'quote'), ('출처', 'source')]:
            out += [f'**{label}:** {item[key] if item[key] is not None else "미기록"}', '']
    out += ['### 2. 5 Whys', '', '**증상:** ' + data['five_whys']['symptom'], '']
    out += [f'{i}. {why}' for i, why in enumerate(data['five_whys']['whys'], 1)] + ['', '### 3. 해법 경로', '']
    for i, path in enumerate(data['solution_paths'], 1):
        out += [f"#### 경로 {i} — {path['status']}", '', path['path'], '', '**이유:** ' + path['reason'], '']
    out += ['### 4. 통찰', '']
    for label, key in [('관찰', 'claim'), ('근거', 'evidence'), ('무엇을 만들기로 했나', 'design_decision')]:
        out += [f'**{label}:** ' + data['insight'][key], '']
    out += ['## 출처', '']
    for source in data['sources']:
        out += [f"### {source['id']} — [{source['title']}]({source['url']})", '', source['claim'], '']
    out += ['기존 조사 메모·직접 조작 범위는 [source-records.md](source-records.md)에 보존한다.', '', '## 현재 기능 명세', '']
    for feature in data['features']:
        out += [f"### {feature['id']} — {feature['name']}", '', '**입력:** ' + feature['input'], '', '**출력:** ' + feature['output'], '', '**완료 조건:** ' + feature['done'], '']
    return '\n'.join(out)

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    document = render(yaml.safe_load((ROOT/'docs/problem.yaml').read_text(encoding='utf-8')))
    target = ROOT/'docs/problem-canvas.md'
    if args.check:
        if not target.exists() or target.read_text(encoding='utf-8') != document:
            raise SystemExit('problem-canvas.md must be regenerated from problem.yaml')
    else:
        target.write_text(document, encoding='utf-8')
    print('Problem canvas matches submission YAML')
