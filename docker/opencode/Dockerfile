FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends git bash curl ca-certificates ripgrep procps \
 && rm -rf /var/lib/apt/lists/*
RUN npm i -g opencode-ai && npm cache clean --force
RUN git config --system --add safe.directory /workspace \
 && mkdir -p /config /workspace && chown node:node /config /workspace
ENV XDG_DATA_HOME=/config/data XDG_CONFIG_HOME=/config/config XDG_STATE_HOME=/config/state \
    GIT_AUTHOR_NAME=opencode GIT_AUTHOR_EMAIL=opencode@localhost \
    GIT_COMMITTER_NAME=opencode GIT_COMMITTER_EMAIL=opencode@localhost
COPY --chmod=755 entrypoint.sh /entrypoint.sh
USER node
WORKDIR /workspace
ENTRYPOINT ["/entrypoint.sh"]
CMD ["sleep","infinity"]
