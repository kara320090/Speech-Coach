# E2E 입력 자료

흐름에서 업로드하거나 붙여 넣는 입력 자료(강의 PDF·이미지·CSV·긴 글 등)를 이 폴더에 커밋한다.
주최 측 실행은 저장소에 있는 것만으로 흐름을 재현한다. 내 컴퓨터에만 있는 파일, 인터넷 주소에서 내려받는 파일,
실행할 때마다 생성하는 임의 자료에 기대면 주최 측 실행에서 같은 흐름이 돌지 않는다.

- 실제 흐름에 쓰는 크기·형식의 자료를 둔다. 빈 파일이나 의미 없는 자료로 결과를 확인하지 않는다.
- 저작권·개인정보 문제가 없는 자료만 둔다. 실존 인물의 개인정보는 넣지 않는다.
- 파일 하나는 10MB 이하로 둔다.

spec에서는 spec 파일 위치를 기준으로 경로를 만든다. `__dirname`을 쓰므로 `e2e/package.json`에 `"type": "module"`을 넣지 않는다.

```ts
import path from "node:path"

// 화면의 '자료 올리기' 버튼으로 고른다(파일 선택 창 대신 setInputFiles)
await page
  .getByLabel("자료 올리기")
  .setInputFiles(path.join(__dirname, "../fixtures/lecture-03.pdf"))
await page.getByRole("button", { name: "업로드" }).click()
await expect(page.getByRole("listitem").filter({ hasText: "lecture-03.pdf" })).toBeVisible()
```

`blank-30s.webm`: 320×240 단색 JPEG 프레임 600장을 20fps VP8로 인코딩한 30초 합성 영상(소리·얼굴 없음, 18KB). Playwright 번들 FFmpeg의 image2pipe/mjpeg→libvpx로 생성했다. 실제 인물 자료가 아니며 모델 미검출·영상 탐색 테스트용이다. measurements.spec.ts의 성공 시계열은 별도 가짜 blendshape 모델을 사용한다.
