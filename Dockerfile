FROM node:22.18.0-bookworm-slim AS web-build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY tsconfig.json ./
COPY scripts/build.mjs scripts/build.mjs
COPY web web
COPY src/chart_platform/resources src/chart_platform/resources
RUN npm run build

FROM python:3.11-slim-bookworm
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 \
    CHART_DATA_DIR=/data CHART_WEB_DIR=/app/web CHART_OCR_BINARY=/app/scripts/recognize_text_linux.py \
    PLAYWRIGHT_BROWSERS_PATH=/opt/playwright
WORKDIR /app
COPY --from=web-build /usr/local/bin/node /usr/local/bin/node
COPY --from=web-build /usr/local/lib/node_modules /usr/local/lib/node_modules
COPY --from=web-build /app/node_modules /app/node_modules
COPY --from=web-build /app/web /app/web
COPY requirements.lock pyproject.toml ./
COPY sdk sdk
COPY src src
COPY scripts/recognize_text_linux.py scripts/recognize_text_linux.py
COPY scripts/container_entrypoint.py scripts/container_entrypoint.py
RUN pip install --no-cache-dir -r requirements.lock \
    && pip install --no-cache-dir --no-deps ./sdk/python . \
    && apt-get update && apt-get install -y --no-install-recommends tesseract-ocr tesseract-ocr-chi-sim \
    && node node_modules/playwright/cli.js install --with-deps chromium \
    && rm -rf /var/lib/apt/lists/* \
    && chmod +x scripts/recognize_text_linux.py \
    && useradd -u 10001 -m chartloom && mkdir -p /data && chown chartloom /data
EXPOSE 8897
HEALTHCHECK --interval=30s --timeout=10s --start-period=20s CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8897/api/health',timeout=4); urllib.request.urlopen('http://127.0.0.1:8897/index.html',timeout=4)"
ENTRYPOINT ["python", "scripts/container_entrypoint.py"]
CMD ["--host", "0.0.0.0", "--port", "8897"]
