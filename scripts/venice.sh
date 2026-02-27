#!/usr/bin/env bash
set -e

# Ensure logs directory exists
mkdir -p logs

# Check if proxy is already running
if lsof -i :4001 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Venice proxy already running on port 4001"
else
  # Verify Venice API key is set
  if [ -z "$VENICE_API_KEY" ]; then
    # Try loading from .env
    if [ -f .env ]; then
      VENICE_API_KEY=$(grep '^VENICE_API_KEY=' .env 2>/dev/null | cut -d= -f2)
      export VENICE_API_KEY
    fi
    if [ -z "$VENICE_API_KEY" ]; then
      echo ""
      echo "ERROR: No Venice API key found."
      echo ""
      echo "Run with:  VENICE_API_KEY=your-key npm run venice"
      echo "Get a key: https://venice.ai/settings/api"
      echo ""
      exit 1
    fi
  fi

  # Start the proxy
  echo "Starting Venice proxy..."
  nohup npx tsx proxy/venice-proxy.ts > logs/venice-proxy.log 2>&1 &
  PROXY_PID=$!

  # Wait for proxy to be ready (up to 15 seconds)
  for i in $(seq 1 15); do
    if lsof -i :4001 -sTCP:LISTEN >/dev/null 2>&1; then
      echo "Venice proxy ready on port 4001"
      break
    fi
    # Check if proxy process died
    if ! kill -0 $PROXY_PID 2>/dev/null; then
      echo ""
      echo "ERROR: Proxy failed to start. Check logs/venice-proxy.log:"
      echo ""
      tail -20 logs/venice-proxy.log 2>/dev/null
      echo ""
      exit 1
    fi
    sleep 1
  done

  # Final check
  if ! lsof -i :4001 -sTCP:LISTEN >/dev/null 2>&1; then
    echo ""
    echo "ERROR: Proxy didn't start after 15 seconds. Check logs/venice-proxy.log:"
    echo ""
    tail -20 logs/venice-proxy.log 2>/dev/null
    echo ""
    exit 1
  fi
fi

# Launch Claude Code through the proxy
exec env ANTHROPIC_BASE_URL=http://localhost:4001 ANTHROPIC_API_KEY=venice-proxy claude --model zai-org-glm-5
