# 우리 팀 진행 기록

Agent가 서비스 저장소 루트의 `progress.md`로 복사해 이어 쓴다(`docs/` 아래에 두지 않는다). 필수 제출 양식을 대신하는 문서가 아니다. 비밀번호·토큰·팀 로그인 코드는 적지 않는다.

## 현재 상태

- 실제 서비스 저장소 폴더: https://github.com/kara320090/Speech-Coach (기본 브랜치 main). 학생 PC 저장 공간 부족으로 로컬 clone 없이 GitHub 웹 화면으로 파일을 올림
- 현재 단계 / 다음 행동: 학생 지시(2026-10-29)로 문서 갱신 → 구현 → 검증을 한 번에 진행함. 다음: GitHub Actions 결과·공개 배포(Vercel, 학생 로그인 필요)·학생 확인 사항 정리
- 학생에게 확인할 내용: ① 실제 발표 종료 시간·감점 여부(미확인, 단정 안 함) ② 10시간에 포함된 "여러 준비 활동"의 구체 내용(학생이 말하지 않아 "대사 암기 등 발표 준비"로만 기록) ③ docs/scenarios.yaml의 platform=desktop은 Agent가 학생이 말한 연습 장면(집·빈 강의실, 웹캠 녹화)에서 정한 값이라 학생 확인 필요 ④ 2026-10-29 방향 변경(해법 경로 2도 구현)은 종이 원본이 아니라 이때 새로 정한 결정임
- 제한: 실제 마이크·웹캠·브라우저 음성 인식 서비스로는 검증하지 못함(가짜 장치·가짜 SpeechRecognition으로만 검증). docker daemon이 없는 작업 공간이라 Dockerfile 빌드는 직접 확인하지 못함(GitHub Actions 결과로 확인 필요). 서비스 AI API(AI_GATEWAY_API_KEY)는 쓰지 않음

## 1. GitHub 준비

- [x] 기존 저장소·브랜치·remote와 로그인 확인 (기존 저장소 없음, GitHub 계정 kara320090)
- [x] 학생과 저장소 이름 합의 (답을 받기 전에는 생성하지 않음) — "Speech Coach" → GitHub 규칙상 Speech-Coach
- [x] 팀의 private 레포 생성 또는 기존 레포 확인 (README 포함 생성, 팀원 yeankong·hsch14·healer-tanker·novoodi 초대 — 수락 대기)
- [x] loopthon-bot 앱을 팀 레포에 설치 (https://github.com/apps/loopthon-bot/installations/new, 팀 레포만 선택)
- [x] 팀 코드로 대시보드 API 로그인(`data.teamId`), 레포 URL을 HTTP로 저장(`data.team.repoUrl`) 확인. 팀 코드로는 화면에 들어갈 수 없음
- [ ] 사이트에 등록한 레포를 실제 작업 폴더로 clone, remote·기본 브랜치 확인 — 미완: 학생 PC 명령 실행 환경은 공간 확보 후 시작됐지만 그 환경의 네트워크가 GitHub 접속을 막고 D:\guide 폴더 연결에 실패함. Agent 작업 공간에는 GitHub 로그인이 없음. 파일은 GitHub 웹 업로드로 올리고 기본 브랜치 main은 웹에서 확인
- [x] .gitignore / .env.example / README 준비(`.env`·`node_modules/`·`.next/`·`dist/`·`build/` 제외, 큰 데이터 파일 커밋 안 함. 파일이 너무 많으면 저장소를 읽지 못함)
- [x] 준비 파일 commit/push 확인 (GitHub 웹 업로드로 main에 commit)
- [x] 앱 설치 후 읽기 권한 확인 (5분 자동 재확인, 즉시 확인은 같은 레포 URL 다시 저장)
- 저장소 URL / 기본 브랜치 / commit SHA: https://github.com/kara320090/Speech-Coach / main / 준비 파일 commit 73b1463a8cb1fc2a5fa90f627e37a4c3c17cecc3
- 사이트 등록 결과 / loopthon-bot 설치·접근 상태: 2026-10-29 레포 URL 저장 ok, 앱 설치 후 재검사 check.result = ok (repoAccessOk true)

## 2. 문제정의 기록 → 문제 다지기 → 해법 찾기 → 기능 명세

- [x] 종이 기록 수령(학생이 채팅에 옮겨 적거나 사진 첨부)
- [x] problem.example.yaml을 참고해 docs/problem.yaml 작성 (근본 문제는 학생 결정으로 앞면 ③ 문장, 뒷면 문장은 파일 주석에 보존)
- [x] 원문 의도와 불명확한 내용 확인, 없는 근거는 빈칸 유지 (why_ours·P1 source·E1 workaround/feeling/quote·features 비움)
- [ ] 2-A 문제 다지기: 캔버스 칸을 질문으로 다짐(Agent가 해법·후보·예시 답을 먼저 내지 않음, 학생 답이 없는 칸은 "학생 답 대기")
- [x] 팀원 경험을 언제·어떤 장면·어떻게 대응했는지까지 experiences에 기록 (E1 보강, 학생 확인 후 push)
- [ ] 외부 자료는 열리는 URL을 sources에 그대로 적고 원문이 주장을 직접 뒷받침하는지 확인, 출처 없는 수치 없음
- [ ] 문제가 '우리 기능이 없어서'가 아니라 실제 상황·행동으로 서술됐는지 확인
- [ ] 2-B 해법 찾기: 학생이 낸 해법과 결정을 solution_paths에, 기존 대안 대신 이 해법이어야 하는 이유를 학생 말로 why_ours에 작성
- [x] 2-C features에 학생이 고른 해법의 기능별 입력·결과·완료 조건 작성 — F1~F6 (2026-10-29)
- [x] YAML 문법 검사, 등록된 레포의 기본 브랜치에 docs/problem.yaml push (commit d8dd37f8adbf885953d0c4d4fa083037751427fc)
- [x] 학생이 개인 로그인으로 우리 팀 → 문제 정의를 열어 캔버스 표시 확인(Agent는 화면을 열 수 없음, 약 1분 캐시) — 2026-10-29 학생이 화면 내용을 보내 줌, 파일과 일치
- [ ] 핵심 사용자 흐름·기능별 동작 규칙·완료 조건·제외 범위를 팀과 확인
- [x] 로그인 필요 여부와 역할 이름(흐름 account·docker 시드 계정 역할 이름으로 씀) 결정 — 로그인 없음(Agent 판단, 학생 확인 필요)
- [ ] 첫 화면에서 알려 줄 것(로그인하지 않은 사람이 `/`에서 볼 서비스 이름·하는 일)을 학생과 정함
- [x] 주 사용 플랫폼(desktop·mobile·both)과 실제 사용 장면에 근거한 platformReason 작성 — desktop(Agent 판단, 학생 확인 필요)
- [x] 사용자 핵심 흐름 3~8개를 scenarios.example.yaml 참고해 docs/scenarios.yaml에 작성(steps는 화면의 메뉴·버튼 이름으로 한 줄에 한 동작, 로그인 흐름은 account 지정), YAML 파서로 형식 확인 후 기본 브랜치 push — S1~S4, 로컬 Playwright 통과
- [x] 서비스의 AI 호출 필요 여부 확인 — 현재 AI 호출 없음(브라우저 안 처리)
- [x] README 등 기존 문서에 확인된 구현 설계 기록, 기본 브랜치 push — README에 기록
- 문제정의·구현 설계 링크 / commit SHA / 확인할 빈칸: https://github.com/kara320090/Speech-Coach/blob/main/docs/problem.yaml / d8dd37f8adbf885953d0c4d4fa083037751427fc / why_ours, P1 source, E1 workaround·feeling·quote, five_whys.symptom, features

## 3. 최소 화면 docker 실행·CI·첫 배포

- [x] 설계에 맞는 최소 화면과 서버 실행 구성 준비, Dockerfile 작성(빌드는 Dockerfile에서 끝내고 시작 명령은 서버 실행만) — 화면·서버·Dockerfile 작성, 로컬 node 실행으로 검증, docker 빌드는 이 작업 공간에서 못 해 GitHub Actions 확인 대기
- [ ] docker-compose.example.yml을 docker-compose.yml로 복사: app·db, app만 ports "3000:3000", 앱은 컨테이너 안 3000에서 받음, 앱 설정에 localhost:3000 같은 절대 주소 없음
- [ ] app 말고는 ports·container_name이 없고, 어느 서비스에도 env_file 없음
- [ ] 환경변수 이름 그대로(RELEASE_ID·SEED_USER_*·AI_GATEWAY_API_KEY), 시드 계정 값은 `${}` 없이 직접 적음
- [ ] 빈 DB에서 `docker compose up --build`만으로 앱·시드 데이터가 2분 안에 뜸(docker를 못 쓰면 GitHub Actions 결과로 확인)
- [ ] README 설치·빌드·실행 안내와 환경변수 표(이름·용도·설정 위치)
- [ ] GET /__health가 인증·리다이렉트 없이 200 응답(docker 앱·배포 둘 다, Next.js는 app/%5F%5Fhealth), 실제 배포 commit을 releaseId로 제공
- [ ] 공개 HTTPS URL 첫 배포(발표용, 배포용 DB는 학생 확인 후 무료 등급)
- [ ] CI 실제 검사(workflows/scenarios.yml 복사)와 성공 뒤 자동 배포 연결, 실제 push로 확인
- [ ] Agent가 대시보드 배포 URL 저장, UP·배포 commit 일치 확인
- 배포 URL / CI·배포 링크 / 첫 배포 commit SHA:

## 4. 서비스 AI API 설정 (필요할 때만)

- 해당 여부 / 선택한 Gateway 지원 모델:
- [ ] 모든 지원 모델을 자유롭게 사용하며 권장 목록은 추천용임을 확인
- [ ] 팀 전체 누적 $10 한도와 현재 사용액·남은 예산·선택 모델 단가 확인
- [ ] 학생이 자료 → API 키에서 키가 없으면 직접 발급 후 복사, Agent는 키를 발급·조회하지 않음
- [ ] 서버가 환경변수 AI_GATEWAY_API_KEY에서 키를 읽음(주최 측 실행도 이 이름으로 키를 넣음), docker-compose.yml app에 `AI_GATEWAY_API_KEY: ${AI_GATEWAY_API_KEY:-}`
- [ ] 학생이 AI_GATEWAY_API_KEY를 로컬·배포 환경과 GitHub Secrets에 직접 설정, .env.example에는 이름만 기록
- [ ] 서버에서 Gateway 호출, 접근 제한·예산 부족·지연·실패 처리
- [ ] 팀 예산 안의 작은 실제 요청으로 연결 확인
- 키 값을 제외한 설정·연결 확인 결과 / 준비 대기 사항:

## 5. 핵심 기능 구현

- [ ] (로그인이 있으면) 회원가입·로그인·로그아웃·역할별 권한 검사 구현, 아이디/비밀번호로 바로 로그인 가능
- [ ] 로그인하지 않은 사람이 `/`를 열면 서비스 이름과 하는 일이 보임(`/`를 로그인 화면으로 보내거나 로그인 칸만 두지 않음)
- [ ] 핵심 입력 → 실제 처리 → 결과 → 다음 행동 구현
- [ ] features의 동작 규칙·완료 조건과 대조, 새 기능은 features에 먼저 추가
- [ ] 화면 다듬기(문구·배치·빈 화면 안내·시각)는 학생이 정한 방향 안에서 Agent가 만들어 보여 주고 학생이 고름
- [ ] docs/scenarios.yaml의 메뉴·버튼 이름이 실제 화면과 같은지 확인, 화면 이름을 바꾸면 흐름·spec도 같은 commit에서 수정
- [ ] 로그인 전에는 로그인 필요 화면이 열리지 않음, 없는 주소는 404(500 아님), 주 사용 플랫폼 화면 폭에서 깨지지 않음
- [ ] 실패 처리와 의미 있는 테스트, 실행한 검사 결과 기록
- [ ] 의미 있는 변경 commit/push, CI·자동 배포 결과 확인
- 완료한 과업 / 검사 결과 / 남은 구현:

## 6. 흐름 E2E

- [x] 키트 e2e/를 저장소 e2e/로 복사, platform에 맞는 project만 남김 — desktop만
- [x] 흐름마다 e2e/scenarios/<id>.spec.ts 하나(id와 같은 파일 이름), 파일마다 test 하나 — S1~S4
- [ ] steps를 같은 순서의 화면 조작으로 spec 본문에 옮김(API 호출 없음), 다른 역할 단계는 새 창(context)으로 로그인, 회원가입 이메일은 실행마다 다르게
- [ ] page.goto는 창마다 처음 한 번만(로그인 화면으로 가는 goto만 예외), 회원가입은 첫 화면에서 눌러 가거나 회원가입 주소 하나만, 도우미 함수는 test보다 위에
- [ ] 마지막에 expected 결과를 expect로 확인(화면이 열렸는지만 보지 않음)
- [ ] test.skip·test.fixme·test.only·조건부 return·실패를 삼키는 try/catch 없음
- [ ] page.route·route.fulfill·routeFromHAR·routeWebSocket·addInitScript·화면 글자를 바꾸는 page.evaluate 없음
- [ ] 흐름에 필요한 선행 데이터는 앱 시드로, 업로드 자료는 e2e/fixtures/에 커밋, 앞 흐름이 만든 데이터에 기대지 않음
- [ ] AI 기능은 실제 응답을 기다려 확인, 흐름 하나가 로컬에서 1분 안
- [ ] viewport를 spec에서 바꾸지 않음, platform의 화면(both면 둘 다)에서 통과
- [ ] globalSetup·storageState 등 playwright.config.ts에만 있는 설정에 기대지 않음
- [ ] `docker compose down -v`, `docker compose up -d --build` 뒤 `npx playwright test`로 모든 흐름 통과
- 흐름별 E2E 결과(통과 / 실패 단계와 이유):

## 7. 최종 검증

- [ ] 실제 배포에서 인증·핵심 과업·대표 실패 동작과 환경변수 확인
- [ ] 빈 DB의 docker 앱에서 platform 화면으로 모든 흐름 E2E 통과, spec이 steps·expected 그대로인지 다시 읽음, 프로젝트 검사, 비밀값 노출 확인
- [ ] 최종 기본 브랜치 push, 해당 commit의 CI 성공·자동 배포 확인
- [ ] 같은 배포 URL을 다시 저장해 대시보드 UP·최종 배포 commit 일치 확인
- [ ] 학생이 자료 → 제출 요건 화면에서 노란 줄이 없다고 확인
- [ ] 문제정의·구현 설계·최종 결과 링크와 미확인 사항 보고
- 검사 결과 / CI·배포 링크 / 최종 commit SHA:
- 흐름별 E2E 결과(통과 / 실패 단계와 이유):
- 배포 URL:
- 아직 못 한 일 / 제한 / 다음 행동:
