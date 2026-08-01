#!/usr/bin/env bash
# geo-optimizer-admin BFF 백그라운드 시작 스크립트
# 사용법:  ./start.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BFF_DIR="$ROOT/bff"
LOG_DIR="$ROOT/logs"
PID_FILE="$ROOT/.bff.pid"
LOG_FILE="$LOG_DIR/bff.log"

# .env 의 PORT 값 읽기 (없으면 8787)
PORT="$(grep -E '^\s*PORT\s*=' "$BFF_DIR/.env" 2>/dev/null | tail -1 | cut -d= -f2 | tr -d ' \r' || true)"
PORT="${PORT:-8787}"
URL="http://localhost:${PORT}"

# 이미 실행 중인지 확인
if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
  echo "⚠️  이미 실행 중입니다 (PID $(cat "$PID_FILE"))."
  echo "🌐 접속 URL:  $URL"
  exit 0
fi
if lsof -ti:"$PORT" >/dev/null 2>&1; then
  echo "⚠️  포트 ${PORT}가 이미 사용 중입니다. 먼저 ./stop.sh 를 실행하거나 포트를 비워주세요."
  exit 1
fi

# 의존성 설치 확인
if [ ! -d "$BFF_DIR/node_modules" ]; then
  echo "📦 의존성이 없어 설치합니다 (npm install)..."
  (cd "$BFF_DIR" && npm install)
fi

mkdir -p "$LOG_DIR"

# 백그라운드 실행 (터미널을 닫아도 유지)
nohup node "$BFF_DIR/src/server.js" >> "$LOG_FILE" 2>&1 &
PID=$!
echo "$PID" > "$PID_FILE"

# 기동 확인 (최대 ~5초)
for _ in $(seq 1 25); do
  if ! kill -0 "$PID" 2>/dev/null; then
    echo "❌ 서버 시작에 실패했습니다. 로그를 확인하세요: $LOG_FILE"
    tail -n 20 "$LOG_FILE" || true
    rm -f "$PID_FILE"
    exit 1
  fi
  if curl -sf "$URL/api/health" >/dev/null 2>&1; then
    break
  fi
  sleep 0.2
done

echo "✅ geo-optimizer-admin 이 백그라운드에서 실행되었습니다 (PID $PID)."
echo "🌐 접속 URL:  $URL"
echo "🧾 로그:      $LOG_FILE"
echo "🛑 종료:      ./stop.sh"
