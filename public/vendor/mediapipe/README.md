# MediaPipe 얼굴 랜드마크 (자체 포함)

시선 추적을 외부 CDN 없이 이 서버에서 제공하려고 넣은 파일이다. 웹캠 영상은 브라우저 안에서만 처리한다.

| 파일 | 출처 | 라이선스 |
| --- | --- | --- |
| `vision_bundle.mjs`, `wasm/vision_wasm_internal.{js,wasm}` | npm `@mediapipe/tasks-vision@0.10.14` (SIMD 빌드만 포함, 소스맵 줄 제거) | Apache-2.0 |
| `face_landmarker.task` | `https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task` | Apache-2.0 |

SIMD를 지원하지 않는 브라우저에서는 시선 추적만 '사용 불가'로 표시하고 나머지 기능은 그대로 쓴다.
