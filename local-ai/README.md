# 자체 AI 실행

## 공개 사이트의 AI 실행

공개 프론트는 Vercel, API는 Render, 모델 계산은 운영 PC에서 수행한다. 브라우저는 같은 사이트의 `/api/*`를 호출하고 Vercel이 Render로 전달한다. 운영 PC의 에이전트는 Render에 HTTPS로 연결해 작업을 받고 로컬 모델로 처리한 결과를 반환한다.

모델 준비 후 저장소 루트에서 한 번 설정한다. 각 경로는 운영 PC의 실제 파일을 지정한다.

```powershell
npm run ai:configure -- --models C:/speech-coach-models --llama C:/llama/llama-server.exe --python C:/Python/python.exe --gpu-layers 99
npm run ai:pair
```

가상환경 Python을 사용하면 그 실행 파일을 지정한다. 별도 폴더에 Python 패키지를 설치했다면 `--python-packages 경로`를 추가한다. CPU만 사용할 때 `--gpu-layers 0`을 쓴다. 모델 파일의 SHA-256을 검증하고 개인 실행 설정 `runtime.local.json`을 저장한다.

`ai:pair`는 에이전트 개인 키를 이 PC에 저장하고 공개 키 `server/agent-public-key.json`을 만든다. 공개 키가 포함된 백엔드를 배포한 뒤 다음 명령으로 실행한다.

```powershell
npm run start:agent
```

이 명령은 Qwen·전사 프로세스의 준비를 확인하고 Render에 연결한다. 개인 키·환경 파일·모델은 Git에 넣지 않는다. 각 작업은 시간 제한·취소·크기 제한을 적용하고 메모리에서만 전달하며, 모델 입력·답변·음성을 로그나 서버 DB에 보관하지 않는다. 에이전트 종료 시 모델도 함께 종료한다. 이 PC에서 에이전트를 계속 실행해야 공개 사이트의 AI가 작동한다.

운영 확인은 공개 사이트의 `/api/model-status`에서 `ready: true`, `runtime.mode: self-hosted-agent`, `runtime.transcriptionReady: true`로 한다. 로컬에서 화면까지 함께 개발할 때만 `npm start`를 사용한다. 기존 Docker 기본 웹은 `node server.js`로 실행하며 별도 모델 에이전트를 자동 설치하지 않는다.

## 모델 프로세스 관리

백엔드 실행기는 모델을 loopback에만 바인딩하고 외부 모델 다운로드 없이 시작한다. 준비 확인, 제한된 자동 재시작, 종료 처리를 제공한다. 로컬 개발의 `npm start`는 준비된 모델과 웹을 함께 띄우며, `npm run start:web`는 기본 웹만 실행한다.

외부 AI API 키와 추가 학습을 사용하지 않는다. 모델 다운로드는 최초 준비 단계에서만 수행한다. 서비스 시작 시 자동 다운로드·외부 폴백은 없다. 사용자에게 앱을 설치하게 하는 제품이 아니라 개발자/운영자가 웹 서버와 모델을 준비하는 방법이다.

## 1. 모델과 실행기 준비

Python 3.11 이상에서 저장소 밖의 모델 폴더를 지정한다. 고정 모델 파일 합계 약 2.65 GB이며 실행기·Python 의존성과 메모리는 별도 필요하다.

```powershell
python local-ai/fetch_models.py --dir C:/speech-coach-models
```

LLM: [공식 Qwen3-4B GGUF](https://huggingface.co/Qwen/Qwen3-4B-GGUF), Apache-2.0. 전사: [SYSTRAN faster-whisper-base](https://huggingface.co/Systran/faster-whisper-base), MIT. 다운로드 스크립트는 revision·SHA-256을 고정한다. 모델을 배포 패키지에 재배포할 때는 해당 LICENSE·저작권 고지·필요한 NOTICE도 함께 보존한다.

llama.cpp는 [공식 배포](https://github.com/ggml-org/llama.cpp/releases/tag/b11960)에서 운영체제에 맞게 준비한다. 실제 확인한 Windows x64 Vulkan ZIP은 `llama-b11960-bin-win-vulkan-x64.zip`, SHA-256 `bac6914b5e83523eb008c6789eaa12669f93fbc196c3b9e8237b6672323b33e9`다. 압축을 풀고 그 폴더에서 실행한다.

```powershell
./llama-server.exe -m C:/speech-coach-models/Qwen3-4B-Q4_K_M.gguf --host 127.0.0.1 --port 8088 --alias speech-coach -c 12288 -ngl 99 --reasoning off --log-disable
```

CPU에서 실행하려면 해당 실행기를 사용하고 GPU 레이어 설정을 0으로 조정한다. CPU LLM 지연은 이번 작업에서 측정하지 않았다. 실제 검증은 32 GB RAM·RTX 4060 Laptop 8 GB의 Vulkan 실행이다. 기본 모델 전체 문맥을 할당하지 않도록 `-c 12288`을 명시한다. API가 받는 입력은 대본·자료 각 2,400자, 답변 1,000자다.

## 2. 음성 전사 프로세스 (선택)

Python 가상환경에서 설치한다. Node 서버의 npm 런타임 의존성은 추가하지 않는다.

```powershell
python -m venv .venv
./.venv/Scripts/python.exe -m pip install -r local-ai/requirements.txt
$env:LOCAL_STT_MODEL_DIR='C:/speech-coach-models/faster-whisper-base'
$env:LOCAL_STT_PORT='8081'
./.venv/Scripts/python.exe local-ai/transcribe_server.py
```

현재 worker는 CPU int8·4 threads, 16kHz mono PCM WAV를 사용한다. `HF_HUB_OFFLINE=1`·`local_files_only=True`로 준비된 모델만 읽고 loopback에만 바인딩한다. 모델이 없으면 시작하지 않는다. 원문·음성·전사를 파일이나 요청 로그에 남기지 않는다. 프록시가 취소되어도 이미 시작한 CPU 추론은 bounded audio 처리를 마칠 수 있다. 자동 재다운로드하지 않는다.

## 3. Node 서버

별도 터미널에서 저장소 루트 기준으로 실행한다.

```powershell
$env:LOCAL_LLM_URL='http://127.0.0.1:8088'
$env:LOCAL_STT_URL='http://127.0.0.1:8081'
$env:LOCAL_MODEL_NAME='speech-coach'
node server.js
```

`http://localhost:3000/coach.html`에서 대본 이해 연습, `/import.html`에서 선택 전사를 사용한다. 모델 연결이 없으면 기본 타이머·로컬 녹음·파일 분석·자료 직접 편집은 유지된다. 브라우저 음성 인식은 외부 업체 처리 가능성 때문에 비활성화했다. 실시간 속도 인식은 제공하지 않으며 파일 불러오기로 전사·군말 후보를 분석한다.

보안상 Node는 `http://127.0.0.1`, `http://localhost`, `http://[::1]`의 모델 주소만 허용한다. 외부 호스트·리다이렉트·사용자 지정 목적지로 자료를 보내지 않는다. `AI_GATEWAY_API_KEY` 등 과거 외부 키는 읽지 않는다.

## 4. 배포와 한계

- 기존 Docker·Render 구성은 모델 없이 기본 웹을 검증하는 구성이다. 모델이나 GPU를 자동 설치하지 않는다.
- 컨테이너의 localhost는 개발자 PC가 아니다. 공개 배포는 Node와 추론 프로세스를 같은 운영 호스트/네트워크 네임스페이스에서 준비해야 한다. 이 공개 배포는 아직 검증하지 않았다.
- 모델은 풀이·검토 초안을 생성한다. 원문 인용은 입력에 존재하는 문구로 제한하지만 인용의 논리적 타당성·사실성을 보증하지 않는다.
- 수정에서 수치·단위가 달라지면 적용을 차단한다. 의미 검사는 일부 표현 규칙과 사용자 확인이며 완전한 의미 보존 모델이 아니다.
- 실제 사람의 발표·군말 인식 정확도, 학습 효과, 시간 절감은 미검증이다. 검증 기록은 [progress](../progress.md)에 있다.

실행기 MIT, Qwen Apache-2.0, faster-whisper MIT의 출처와 선택 이유는 [설계 문서](../docs/local-ai-design.md)에 기록했다. 공개 튜터 코드를 그대로 가져오거나 기반 모델을 추가 학습하지 않았다.
