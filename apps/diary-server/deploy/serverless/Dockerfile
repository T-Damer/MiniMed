# The serverless mode's image (ADR-0027): Node (crypto.argon2 needs ≥ 24.7) and one bundled file.
# Built by scripts/diary-serverless-deploy.sh from a staging folder; amd64, as Serverless Containers run.
FROM node:24.22.2-slim
WORKDIR /srv
COPY diary-serverless.mjs ./
ENV NODE_ENV=production DIARY_MODE=serverless
USER node
CMD ["node", "diary-serverless.mjs"]
