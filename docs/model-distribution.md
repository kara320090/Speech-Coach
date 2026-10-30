# GitHub 모델 배포와 별도 자체 실행

기본 채점 Docker는 경량 Node 서버와 실제 Gateway를 사용한다. 아래 대형 모델 이미지는 별도 운영·검사용이며 기본 `docker compose up` 경로와 구분한다.

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

## 별도 자체 모델 Docker

```sh
docker build -f Dockerfile.selfhosted -t speech-coach-selfhosted .
docker run --rm -p 3000:3000 speech-coach-selfhosted
```

이 별도 이미지는 Node·Qwen·faster-whisper를 함께 실행한다. GPU·운영 PC·에이전트·외부 AI 키 없이 CPU로 코칭과 전사를 수행한다. 두 추론 서버는 컨테이너 내부 loopback에서만 열고 외부에는 3000 포트만 제공한다. `GET /api/model-status`의 provider는 local, runtime.mode는 managed다.

이미지 빌드 때 고정 revision과 SHA-256으로 원본 공개 저장소에서 동일 가중치를 받는다. private Release를 읽기 위한 토큰을 이미지나 채점 환경에 요구하지 않기 위한 경로다. 모델 파일은 완성된 이미지에 포함되고, 컨테이너 시작·실제 추론 중에는 모델을 다운로드하거나 외부 AI로 대체하지 않는다. 첫 빌드에는 인터넷과 약 2.65GB의 모델 다운로드, 이미지 저장 공간이 필요하다. 실행에는 모델과 작업 메모리를 확보해야 하며 CPU 속도에 따라 지연이 달라진다.

공개 사이트는 서버에 설정한 공급자를 사용한다. local 운영 모드는 Vercel→Render→운영 PC 경로를 유지하며, gateway 모드는 서버 전용 Gateway 키로 처리한다. 기본 제출 흐름의 실제 AI 검사는 주최 측 키를 사용한다.

## 시나리오와 실제 검사

현재 제출은 S1–S6·S8·S9의 8개이며 [추적표](traceability.md)를 따른다. S5·S8은 실제 Gateway 텍스트, S6는 실제 파일 음성 전사와 로컬 영상 분석을 검사한다. 자체 모델용 기존 S5–S7은 `e2e/selfhosted/`의 별도 검사로 보존한다.

현재 GitHub Actions는 기본 경량 Docker와 실제 Gateway 제출 흐름을 검사하고, 제공된 촬영 파일을 가상 장치로 재생하는 별도 증빙을 보관한다. 모델 정확도·실제 카메라 성능·학습 효과는 별도 평가 범위다.

[과거 별도 자체 모델 Docker 실행 기록](https://github.com/kara320090/Speech-Coach/actions/runs/40928210822)은 당시 모델·웹 기동과 질문·전사·화면 흐름에 대한 기록이다. 현재 기본 평가 Docker의 결과와 구분한다.
