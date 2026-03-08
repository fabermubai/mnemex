@echo off
cd /d F:\Mnemex

set NODE_FLAGS=--peer-store-name mnemex-peer --msb-store-name mnemex-msb-peer --sc-bridge 1 --sc-bridge-port 49223 --sc-bridge-token mnemex-dev-token-2026 --require-payment 1 --cortex-channels "cortex-crypto,cortex-dev,cortex-general,cortex-trac" --enable-skills 1 --sc-bridge-cli 1

REM First launch detection: keypair missing → interactive setup
if not exist "stores\mnemex-peer\db\keypair.json" (
  echo First launch — interactive setup required.
  node index.js %NODE_FLAGS% --setup-only
  echo.
  echo Setup complete. Starting Mnemex in background...
)

REM Start in background, redirect logs to mnemex-agent2.log
start /B node index.js %NODE_FLAGS% > mnemex-agent2.log 2>&1
echo Mnemex Agent 2 started in background. Logs: mnemex-agent2.log
exit /b
