# GitHub 모델 배포와 평가용 자체 실행

실제 모델 가중치: [model-weights-v1 GitHub Release](https://github.com/kara320090/Speech-Coach/releases/tag/model-weights-v1).

| 구성 | 배포 파일 | 라이선스·출처 |
| --- | --- | --- |
| Qwen3-4B Q4_K_M | 약 2.50GB GGUF, 1GiB 이하 3개 분할 파일 | Qwen 공식 GGUF, Apache-2.0 |
| faster-whisper-base | model.bin·config·tokenizer·vocabulary·원본 모델 카드 | OpenAI Whisper base의 SYSTRAN 변환, MIT |
| 검증·고지 | model-release.json·라이선스·MODEL-NOTICE | 파일별 크기·SHA-256·분할 순서·고정 revision |

모델 원본은 추가 학습·재양자화 없이 배포한다. 분할은 전송을 위한 것으로 복원한 GGUF의 SHA-256은 원본과 같다. 공개 사전학습 가중치를 직접 실행하는 구성이며 팀이 기반 모델을 훈련했다고 표시하지 않는다. 원문 라이선스는 `local-ai/licenses/`에도 보존한다.

## GitHub에서 복원

이 저장소는 private이므로 읽기 권한이 있는 계정으로 GitHub CLI에 로그인한 상태에서 실행한다. 키·토큰을 코드에 넣지 않는다.

```sh
gh release download model-weights-v1 --repo kara320090/Speech-Coach --dir .model-download
node local-ai/restore-models.mjs --from .model-download --dir models
```

복원기는 각 파일·전체 모델 해시를 검사하고, 다른 내용의 기존 모델을 덮어쓰지 않는다. 기존 PC 실행 안내의 모델 폴더에 복원한 경로를 지정하면 된다.

## 평가용 Docker

```sh
docker compose up --build
```

`app` 컨테이너가 Node·Qwen·faster-whisper를 함께 실행한다. GPU·운영 PC·에이전트·외부 AI 키 없이 CPU로 코칭과 전사를 수행한다. 두 추론 서버는 컨테이너 내부 loopback에서만 열고 외부에는 3000 포트만 제공한다. `GET /api/model-status`의 provider는 local, runtime.mode는 managed다.

이미지 빌드 때 고정 revision과 SHA-256으로 원본 공개 저장소에서 동일 가중치를 받는다. private Release를 읽기 위한 토큰을 이미지나 채점 환경에 요구하지 않기 위한 경로다. 모델 파일은 완성된 이미지에 포함되고, 컨테이너 시작·실제 추론 중에는 모델을 다운로드하거나 외부 AI로 대체하지 않는다. 첫 빌드에는 인터넷과 약 2.65GB의 모델 다운로드, 이미지 저장 공간이 필요하다. 실행에는 모델과 작업 메모리를 확보해야 하며 CPU 속도에 따라 지연이 달라진다.

공개 사이트의 Vercel→Render→운영 PC 경로는 유지한다. Render 무료 인스턴스에 이 대형 모델을 올리는 구성으로 바꾸지 않는다. 새 대본 생성만 선택적으로 Gemini를 사용하고, 평가 핵심 8개 시나리오는 그 키를 요구하지 않는다.

## 시나리오와 실제 검사

`docs/scenarios.yaml`의 S1–S4·S5–S7·기존 S9 총 8개를 각각 같은 ID의 `e2e/scenarios/*.spec.ts`로 검사한다. S5는 실제 자체 Qwen의 쉬운 대본·버전 복원, S6은 개념·답변 검토·이력 보존, S7은 저장소의 합성 한국어 음성 파일을 실제 자체 Whisper로 전사한다. 답변 가로채기·가짜 AI 응답·test.skip을 사용하지 않는다. 카메라·마이크가 없는 환경에서는 시간·구간 흐름이 그대로 끝나며 음성은 합성 파일로 검증한다.

GitHub Actions는 Docker 기동 후 실제 모델 준비·질문 생성·한국어 전사를 확인하고 8개 화면 흐름을 검사한다. 합성 음성과 자동 검사 결과는 사람의 발화·군말·얼굴 정확도나 학습 효과 검증과 구분한다.

[실제 Docker CI](https://github.com/kara320090/Speech-Coach/actions/runs/40928210822)에서 모델·웹 기동, 자체 질문 생성·한국어 전사와 8개 화면 흐름을 모두 통과했다. 이미지 빌드 약 60초, 모델 기동 약 6초, 화면 검사 2.9분이었다.
