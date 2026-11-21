FROM ghcr.io/astral-sh/uv:python3.13-bookworm-slim AS api
ENV UV_PROJECT_ENVIRONMENT=/opt/venv UV_LINK_MODE=copy PYTHONUNBUFFERED=1
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY scripts/install-curl-impersonate.sh /tmp/install-curl-impersonate.sh
RUN sh /tmp/install-curl-impersonate.sh && rm /tmp/install-curl-impersonate.sh
WORKDIR /app/ingest
COPY ingest/pyproject.toml ingest/uv.lock ./
RUN uv sync --locked --no-dev --no-install-project
COPY ingest/src ./src
RUN uv sync --locked --no-dev
ENTRYPOINT ["uv", "run", "--no-sync", "showtimes-ingest"]

FROM api AS checks
RUN uv sync --locked
COPY ingest/tests ./tests
RUN uv run ruff check . && uv run ruff format --check . \
    && uv run python -m unittest discover -s tests -v

FROM api AS runtime
# Only the three existing browser providers need WebKit. Cineworld and Curzon
# use the lightweight api stage unchanged, with no JavaScript execution.
RUN uv run --no-sync playwright install --with-deps webkit
