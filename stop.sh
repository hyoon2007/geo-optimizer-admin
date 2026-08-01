#!/usr/bin/env bash
# geo-optimizer-admin BFF 종료 스크립트
# 사용법:  ./stop.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BFF_DIR="$ROOT/bff"
PID_FILE="$ROOT/.bff.pid"

PORT="$(grep -E '^\s*PORT\s*=' "$BFF_DIR/.env" 2>/dev/null | tail -1 | cut -d= -f2 | tr -d ' \r' || true)"
PORT="${PORT:-8787}"

stopped=0

# 1) PID 파일 기준 종료
if [ -f "$PID_FILE" ]; then
  PID="$(cat "$PID_FILE")"
  if kill -0 "$PID" 2>/dev/null; then
    kill "$PID" 2>/dev/null || true
    # 최대 5초 대기 후 강제 종료
    for _ in $(seq 1 25); do
      kill -0 "$PID" 2>/dev/null || break
      sleep 0.2
    done
    kill -9 "$PID" 2>/dev/null || true
    echo "🛑 서버를 종료했습니다 (PID $PID)."
    stopped=1
  fi
  rm -f "$PID_FILE"
fi

# 2) 혹시 PID 파일이 없을 때를 대비해 포트로도 정리
if lsof -ti:"$PORT" >/dev/null 2>&1; then
  lsof -ti:"$PORT" | xargs kill -9 2>/dev/null || true
  echo "🛑 포트 ${PORT}를 사용하던 프로세스를 정리했습니다."
  stopped=1
fi

if [ "$stopped" -eq 0 ]; then
  echo "ℹ️  실행 중인 서버가 없습니다."
fi
