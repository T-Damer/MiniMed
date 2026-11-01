# The connected diary service as one image (amd64 and arm64): the bundled service, the backup job and
# the built app it serves. Built by scripts/diary-image.sh from a staging folder, not from the
# repository root: the monorepo is not needed at run time.
ARG BUN_VERSION=1.2.3
FROM oven/bun:${BUN_VERSION}-slim

WORKDIR /opt/minimed
COPY app/ app/
COPY diary-server.js diary-cli.js diary-backup.js ./
RUN mkdir -p /data /backups && chown bun:bun /data /backups

ENV DIARY_HOST=0.0.0.0 \
    DIARY_PORT=8790 \
    DIARY_DB=/data/diary.db \
    DIARY_STATIC=/opt/minimed/app \
    DIARY_BACKUP_DIR=/backups \
    TZ=Europe/Moscow

USER bun
VOLUME /data
EXPOSE 8790
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD bun -e "fetch('http://127.0.0.1:8790/api/health').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
CMD ["bun", "diary-server.js"]
