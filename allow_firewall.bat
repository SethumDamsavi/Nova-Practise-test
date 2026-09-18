@echo off
echo =======================================================
echo  Requesting Admin Privileges to allow Port 3000
echo =======================================================
echo.
powershell -Command "Start-Process powershell -ArgumentList '-NoProfile -ExecutionPolicy Bypass -Command \"New-NetFirewallRule -DisplayName \\\"NovoPractise Clinic Port 3000\\\" -Direction Inbound -LocalPort 3000 -Protocol TCP -Action Allow\"' -Verb RunAs"
echo Done. You can close this window now.
pause
