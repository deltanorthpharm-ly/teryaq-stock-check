@echo off
cd /d E:\Test_Almohaseb_Old\teryaq-stock-check

if not exist ".output\server\index.mjs" (
  echo Production build not found. Run npm.cmd run build first.
  exit /b 1
)

npm.cmd run start:prod
