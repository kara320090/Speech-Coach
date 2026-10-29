FROM node:22-bookworm-slim
# CPU inference runs inside the evaluator's container; no PC agent, GPU or provider key is required.
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-venv ca-certificates curl libgomp1 libcurl4 && rm -rf /var/lib/apt/lists/*
COPY local-ai/requirements.txt /tmp/speech-coach-requirements.txt
RUN python3 -m venv /opt/speech-coach/venv && /opt/speech-coach/venv/bin/pip install --no-cache-dir -r /tmp/speech-coach-requirements.txt
COPY local-ai/fetch_models.py /tmp/fetch_models.py
# The same pinned, hash-verified weights are also distributed in GitHub Releases.
# Official upstream downloads need no token when this private repository is built by the evaluator.
RUN python3 /tmp/fetch_models.py --dir /opt/speech-coach/models
RUN curl -fL --retry 3 https://github.com/ggml-org/llama.cpp/releases/download/b11960/llama-b11960-bin-ubuntu-x64.tar.gz -o /tmp/llama.tar.gz && echo '31cc3a6bc638ac6c48dc4b1b74888f1eaadf3d14227c1e5f67daf9a49541d97a  /tmp/llama.tar.gz' | sha256sum -c - && mkdir /opt/llama && tar -xzf /tmp/llama.tar.gz --strip-components=1 -C /opt/llama && rm /tmp/llama.tar.gz
ENV LD_LIBRARY_PATH=/opt/llama
RUN /opt/llama/llama-server --version
WORKDIR /app
# 대본 파일 읽기(/api/scripts/import)에 쓰는 패키지를 잠금 파일 그대로 설치한다.
# 선택 패키지(pdfjs-dist의 그림 그리기용 @napi-rs/canvas)는 글자 꺼내기에 필요 없어서 넣지 않는다.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --omit=optional --no-audit --no-fund && npm cache clean --force
COPY server.js ./
COPY server ./server
COPY public ./public
COPY local-ai ./local-ai
# 서버가 /__health의 releaseId로 응답하는 값. 주최 측 실행과 CI가 commit SHA를 넣는다.
ARG RELEASE_ID=dev
ENV RELEASE_ID=$RELEASE_ID
ENV PORT=3000
ENV AI_RUNTIME_CONFIG=/app/local-ai/runtime.docker.json
ENV AI_EXECUTION_MODE=managed
ENV HF_HUB_OFFLINE=1
ENV HF_HUB_DISABLE_TELEMETRY=1
EXPOSE 3000
USER node
CMD ["node", "local-ai/start.mjs"]
