@echo off
cd /d "%~dp0"

set PEER_STORE=mnemex-node
set MSB_STORE=mnemex-msb
set FLAGS=--peer-store-name %PEER_STORE% --msb-store-name %MSB_STORE% --subnet-channel mnemex-v1 --subnet-bootstrap a5c9c46671b936fb15be80f7d89a093c99053104d58efc0b8369eb9207fd82cf --sc-bridge 1 --sc-bridge-port 49222 --sc-bridge-token mnemex-dev-token-2026 --require-payment 1 --cortex-channels cortex-crypto,cortex-dev,cortex-general,cortex-trac --enable-skills 1 --sc-bridge-cli 1

REM First launch: open a visible terminal for interactive seed + nick setup, wait for it to finish
if not exist "stores\%PEER_STORE%\db\keypair.json" (
  echo First launch — a setup window will open. Enter your seed phrase and nick there.
  start "Mnemex Setup" /wait cmd /c "cd /d "%~dp0" && pear run . -- %FLAGS% --setup-only && echo. && echo Setup complete. Press any key to close. && pause >nul"
  echo Setup done. Starting Mnemex in background...
)

REM Start as a hidden background process (persists after this window closes)
powershell -Command "Start-Process -FilePath ($env:APPDATA + '\npm\pear.cmd') -ArgumentList ('run . -- ' + '%FLAGS%') -WorkingDirectory '%~dp0' -WindowStyle Hidden"
echo Mnemex started in background.
exit
