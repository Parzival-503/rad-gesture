; RadGesture's own "close the running app" step for the installer and the
; uninstaller (electron-builder runs customCheckAppRunning in both).
;
; The stock step force-closes every process in the install folder and, if
; Windows refuses, shows "RadGesture cannot be closed. Please close it
; manually". Windows refuses when RadGesture runs as administrator and Setup
; does not (e.g. the installer was once started with "Run as administrator",
; so the copy it launched at the end was elevated too). So, in order:
;   1. ask the running copy to quit over its local bridge (/quit, with the
;      token from %APPDATA%\RadGesture\bridge.ini): allowed across admin/normal;
;   2. wait up to 6 s for RadGesture.exe and its helper to leave;
;   3. force-close only those two files of this install folder;
;   4. if anything is still there, say exactly what to do, then Retry.
; tests-e2e/installer.ps1 runs install-over and uninstall with the app running.

!macro customCheckAppRunning
  rgCloseLoop:
    DetailPrint "Closing RadGesture..."
    nsExec::Exec `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "& { $$d = '$INSTDIR'; $$mine = @((Join-Path $$d 'RadGesture.exe'), (Join-Path $$d 'resources\helper\RadGestureHelper.exe')); function L { @(Get-CimInstance Win32_Process | Where-Object { $$_.Path -and ($$mine -contains $$_.Path) }) }; if ((L).Count -eq 0) { exit 0 }; $$f = Join-Path $$env:APPDATA 'RadGesture\bridge.ini'; if (Test-Path $$f) { $$c = Get-Content $$f; $$p = (($$c | Where-Object { $$_ -like 'Port=*' }) -replace 'Port=', '').Trim(); $$t = (($$c | Where-Object { $$_ -like 'Token=*' }) -replace 'Token=', '').Trim(); try { Invoke-WebRequest -UseBasicParsing -Method Post -TimeoutSec 3 -Headers @{ 'x-rg-token' = $$t } -Uri ('http://127.0.0.1:' + $$p + '/quit') | Out-Null } catch {} }; for ($$i = 0; $$i -lt 20 -and (L).Count -gt 0; $$i++) { Start-Sleep -Milliseconds 300 }; L | ForEach-Object { Stop-Process -Id $$_.ProcessId -Force -ErrorAction SilentlyContinue }; Start-Sleep -Milliseconds 800; if ((L).Count -gt 0) { exit 1 } else { exit 0 } }"`
    Pop $R0
    ${if} $R0 == "error"
      ; PowerShell blocked on this PC: close them by name instead.
      nsExec::Exec `"$SYSDIR\cmd.exe" /C taskkill /F /IM RadGesture.exe /IM RadGestureHelper.exe /FI "USERNAME eq %USERNAME%"`
      Pop $R0
      Sleep 800
      StrCpy $R0 0
    ${endIf}
    ${if} $R0 == 1
      MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "RadGesture is still running and Setup is not allowed to close it (it was probably started as administrator).$\r$\n$\r$\nRight-click the RadGesture icon near the clock and choose Quit RadGesture, then click Retry." /SD IDCANCEL IDRETRY rgCloseLoop
      Quit
    ${endIf}
!macroend
