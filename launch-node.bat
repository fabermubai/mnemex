@echo off
cd /d F:\Mnemex
node index.js --peer-store-name mnemex-admin --msb-store-name mnemex-msb --sc-bridge 1 --sc-bridge-port 49222 --sc-bridge-token mnemex-dev-token-2026 --require-payment 1 --cortex-channels "cortex-crypto,cortex-dev,cortex-general,cortex-trac" --enable-skills 1 --sc-bridge-cli 1
pause
