FROM node:22-alpine
WORKDIR /app
COPY package.json server.js ./
COPY public ./public
# 서버가 /__health의 releaseId로 응답하는 값. 주최 측 실행과 CI가 commit SHA를 넣는다.
ARG RELEASE_ID=dev
ENV RELEASE_ID=$RELEASE_ID
ENV PORT=3000
EXPOSE 3000
USER node
CMD ["node", "server.js"]
