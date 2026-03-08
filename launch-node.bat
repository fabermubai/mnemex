@echo off
cd /d "%~dp0"

set PEER_STORE=mnemex-admin
set MSB_STORE=mnemex-msb
set NODE_FLAGS=--peer-store-name %PEER_STORE% --msb-store-name %MSB_STORE% --subnet-channel mnemex-v1 --subnet-bootstrap f52062456f3826bad7846a0cf65f47a32e84d545d28eb907e90fa021bb50efb0 --sc-bridge 1 --sc-bridge-port 49222 --sc-bridge-token mnemex-dev-token-2026 --require-payment 1 --cortex-channels "cortex-crypto,cortex-dev,cortex-general,cortex-trac" --enable-skills 1 --sc-bridge-cli 1

REM First launch detection: keypair missing → interactive setup
if not exist "stores\%PEER_STORE%\db\keypair.json" (
  echo First launch — interactive setup required.
  pear run . -- %NODE_FLAGS% --setup-only
  echo.
  echo Setup complete. Starting Mnemex in background...
)

REM Start in a minimized window (persists after this console closes)
start "Mnemex" /min cmd /c "pear run . -- %NODE_FLAGS% > mnemex.log 2>&1"
echo Mnemex started in background. Logs: mnemex.log
exit /b
