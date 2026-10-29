# 영상·소리 파일 불러오기와 자체 음성 전사

F16 파일 불러오기·전사·군말 후보와 F21 영상 측정을 제공한다. 사용자 변경 지시에 따라 AI Gateway 중계를 제거하고 직접 운영하는 faster-whisper worker로 전환했다. 외부 AI 키를 읽거나 외부 공급자로 대체하지 않는다.

## 흐름

1. `/import.html`에서 파일과 목표 시간을 고른다. 지원 여부는 브라우저의 디코딩에 달려 있으며 300 MB·30분 제한을 적용한다.
2. 소리를 브라우저에서 16kHz mono로 풀어 긴 침묵을 찾는다. 소리 없는 영상은 영상 재생·분석을 계속할 수 있다.
3. 사용자가 글자 변환을 켠 경우에만 약 20초(±5초) WAV 조각을 같은 출처 `POST /api/transcribe`로 전송한다.
4. Node는 `LOCAL_STT_URL`의 loopback `/transcribe`에 PCM WAV를 보내고 텍스트·구간을 받는다. worker는 미리 준비된 모델만 읽는다.
5. 브라우저가 속도·반복·군말 후보를 계산해 기존 결과 화면에 보여 준다. 파일·결과는 IndexedDB에 보관한다. 군말은 인식 누락·문맥 차이가 있어 실제 오류나 감정으로 단정하지 않는다.

영상·얼굴은 전송하지 않는다. 글자 변환을 끄면 소리도 브라우저 밖으로 보내지 않는다. 켜면 자체 서버에 소리가 전송되므로 브라우저에서만 처리한다고 안내하지 않는다. Node와 worker는 소리·전사를 파일이나 본문 로그에 남기지 않는다.

## 서버 규칙

| 조건 | 응답 |
| --- | --- |
| `LOCAL_STT_URL` 없음·외부 주소 | 503 not-configured |
| 4 MiB 초과 | 413 too-large |
| 16kHz mono PCM16 WAV 형식 불일치 | 415 not-wav |
| 서버 누적 길이 초과(기본 3600초) | 429 budget |
| 동시 전사 3개 초과 | 429 busy |
| 자체 worker 오류 | 502 model-error, worker 429는 429 |
| 연결·90초 제한 실패 | 502 model-unreachable |
| 응답을 읽을 수 없음 | 502, 원자료 보존 |
| 성공 | text, segments[{text,startSecond,endSecond}], language, 실제 WAV 길이, processing:self-hosted |

실패한 요청은 누적 길이를 반환한다. 요청한 음성 길이를 넘는 구간·빠진 시간·뒤집힌 구간은 버린다. 인식 시각은 발화 단어의 정확한 타임스탬프라는 보장이 없다. 브라우저는 부분 실패·취소를 안내하고 로컬 침묵 분석을 유지한다.

## 실행·배포

`LOCAL_STT_URL`, `LOCAL_STT_MODEL_DIR`, `LOCAL_STT_PORT` 설정과 설치 명령은 [자체 AI 실행](../local-ai/README.md). `AI_GATEWAY_API_KEY`·`TRANSCRIBE_MODEL`·`AI_GATEWAY_URL`은 폐기한 설정이다. 키가 있어도 외부 제공자를 부르지 않는다.

기존 Render·Docker 기본 구성에는 모델 worker가 없다. 웹과 health·타이머는 실행되지만 자체 전사를 사용하려면 같은 운영 호스트에 worker·모델을 준비해야 한다. 공개 AI 배포는 미검증이다.

## 검증 범위

전사 단위 검사를 기존 Gateway 프로토콜에서 자체 WAV worker 프로토콜로 전환해 형식·한도·오류·성공·누적 반환·구간 검증을 유지했다. 별도 미디어 브라우저 검사는 가짜 전사 응답으로 파일→결과→군말·구간 이동을 확인한다. 실제 worker에서는 준비된 모델 로딩과 합성 무음 처리를 확인했다. 실제 사람 음성의 한국어·군말 정확도는 아직 검증하지 않았다. [진행 기록](../progress.md).
