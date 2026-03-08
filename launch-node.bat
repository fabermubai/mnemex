@echo off
cd /d F:\Mnemex

set NODE_FLAGS=--peer-store-name mnemex-admin --msb-store-name mnemex-msb --sc-bridge 1 --sc-bridge-port 49222 --sc-bridge-token mnemex-dev-token-2026 --require-payment 1 --cortex-channels "cortex-crypto,cortex-dev,cortex-general,cortex-trac" --enable-skills 1 --sc-bridge-cli 1

REM First launch detection: keypair missing → interactive setup
if not exist "stores\mnemex-admin\db\keypair.json" (
  echo First launch — interactive setup required.
  node index.js %NODE_FLAGS% --setup-only
  echo.
  echo Setup complete. Starting Mnemex in background...
)

REM Start in background, redirect logs to mnemex.log
start /B node index.js %NODE_FLAGS% > mnemex.log 2>&1
echo Mnemex started in background. Logs: mnemex.log
exit /b
