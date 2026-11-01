# The stack's egress guard (guard.sh): iptables only. Built by `docker compose` on the host.
FROM alpine:3.22
RUN apk add --no-cache iptables iptables-legacy
COPY guard.sh /usr/local/bin/guard.sh
ENTRYPOINT ["/bin/sh", "/usr/local/bin/guard.sh"]
