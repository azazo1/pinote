FROM rust:1.96-bookworm AS builder

WORKDIR /build
COPY server/Cargo.toml server/Cargo.lock ./
COPY server/src ./src
COPY server/migrations ./migrations
RUN cargo build --release --locked

FROM debian:bookworm-slim AS runtime

RUN apt-get update \
    && apt-get install --no-install-recommends --yes ca-certificates curl gosu \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --uid 10001 pinote \
    && install --directory --owner pinote --group pinote /data /secrets

COPY --from=builder /build/target/release/pinote-sync-server /usr/local/bin/pinote-sync-server
COPY --chmod=755 server/docker/entrypoint.sh /usr/local/bin/pinote-entrypoint

ENV PINOTE_HOST=0.0.0.0 \
    PINOTE_PORT=8787 \
    PINOTE_DATA_DIR=/data \
    PINOTE_TOKEN_FILE=/secrets/pinote-token
EXPOSE 8787
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
    CMD curl --fail --silent http://127.0.0.1:${PINOTE_PORT}/readyz || exit 1
ENTRYPOINT ["pinote-entrypoint"]
