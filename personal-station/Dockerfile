FROM python:3.13-slim
WORKDIR /app
USER root
COPY vendor/wheels /tmp/zero-wheels
RUN pip install --no-cache-dir --no-index --find-links=/tmp/zero-wheels ctranslate2==4.8.4 sentencepiece==0.2.2 && rm -rf /tmp/zero-wheels
COPY models /app/models
COPY vendor/licenses /app/licenses
COPY server.py live_data.py feed_service.py feed_sources.py safe_http.py proxy_service.py translation_service.py backup_service.py ./
COPY --chmod=755 bin/mihomo ./bin/mihomo
COPY public ./public
COPY deploy ./deploy
COPY THIRD_PARTY_NOTICES.md ./THIRD_PARTY_NOTICES.md
RUN groupadd --gid 10001 station && useradd --uid 10001 --gid station --no-create-home station && mkdir /data && chown station:station /data
ENV STATION_HOST=0.0.0.0 STATION_PORT=8765 STATION_DATA_DIR=/data PYTHONDONTWRITEBYTECODE=1
USER 10001:10001
VOLUME ["/data"]
EXPOSE 8765
CMD ["python", "-u", "server.py"]
