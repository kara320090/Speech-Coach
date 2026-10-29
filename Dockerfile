FROM node:22-alpine
WORKDIR /app
# 대본 파일 읽기(/api/scripts/import)에 쓰는 패키지를 잠금 파일 그대로 설치한다.
# 선택 패키지(pdfjs-dist의 그림 그리기용 @napi-rs/canvas)는 글자 꺼내기에 필요 없어서 넣지 않는다.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --omit=optional --no-audit --no-fund && npm cache clean --force
COPY server.js ./
COPY server ./server
COPY public ./public
# 서버가 /__health의 releaseId로 응답하는 값. 주최 측 실행과 CI가 commit SHA를 넣는다.
ARG RELEASE_ID=dev
ENV RELEASE_ID=$RELEASE_ID
ENV PORT=3000
EXPOSE 3000
USER node
CMD ["node", "server.js"]
