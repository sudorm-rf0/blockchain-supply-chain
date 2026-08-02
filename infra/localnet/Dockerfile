# Agave localnet validator for the supply-chain monorepo.
# The old solanalabs/solana:v1.18 image cannot execute sbfv3 programs built by
# Anchor 0.31 + Solana 2.x, so we build a pinned Agave image instead.

# Downloader stage uses the alpine base's busybox (no apt needed).
FROM node:20-alpine AS downloader

ARG AGAVE_VERSION=4.1.2

RUN set -eux; \
    wget -q -O /tmp/solana-release.tar.bz2 \
      "https://github.com/anza-xyz/agave/releases/download/v${AGAVE_VERSION}/solana-release-x86_64-unknown-linux-gnu.tar.bz2"; \
    mkdir -p /opt/solana; \
    tar -xjf /tmp/solana-release.tar.bz2 -C /opt/solana --strip-components=1; \
    rm /tmp/solana-release.tar.bz2; \
    test -x /opt/solana/bin/solana-test-validator

FROM debian:bookworm-slim

COPY --from=downloader /opt/solana /opt/solana
ENV PATH="/opt/solana/bin:$PATH"
WORKDIR /var/solana
EXPOSE 8899 8900 9900 8001 8002 8003

CMD ["solana-test-validator", "--ledger", "/var/solana/ledger"]
