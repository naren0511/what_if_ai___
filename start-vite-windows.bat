@echo off
cd /d "%~dp0"
if not exist node_modules (
  echo Installing dependencies...
  npm install
)
npm run dev -- --host 127.0.0.1
pause
