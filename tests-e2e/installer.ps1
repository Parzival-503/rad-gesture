# Installer / uninstaller test on the Windows build machine.
# Sina hit "RadGesture cannot be closed. Please close it manually" both when
# installing over a running copy and when uninstalling. This runs both while
# the app (and its helper) are running, with the silent installer, where
# that dialog's default answer is Cancel, so a failure shows as "did not
# finish" instead of hanging.
$ErrorActionPreference = 'Continue'
$setup = (Resolve-Path 'dist\RadGesture-Setup.exe').Path
$dir = Join-Path $env:LOCALAPPDATA 'Programs\RadGesture'
$exe = Join-Path $dir 'RadGesture.exe'
$fail = 0
function Check($name, $ok, $detail = '') {
  if ($ok) { Write-Host "PASS  $name  $detail" } else { Write-Host "FAIL  $name  $detail"; $script:fail++ }
}
function Ours { Get-CimInstance Win32_Process | ? { $_.Path -and $_.Path.StartsWith($dir, 'CurrentCultureIgnoreCase') } | % { "$($_.ProcessId) $($_.Path)" } }
function RunFor($file, $argList, $secs) {
  $p = Start-Process -FilePath $file -ArgumentList $argList -PassThru
  if (-not $p.WaitForExit($secs * 1000)) { $p.Kill(); return 'timeout' }
  return $p.ExitCode
}

# 1. Fresh install.
$r = RunFor $setup '/S' 120
Check 'fresh install' (Test-Path $exe) "exit=$r"

# 2. Start it; wait for the helper too.
Start-Process $exe
Start-Sleep 8
$running = @(Ours)
Write-Host "running from the install folder:`n  $($running -join "`n  ")"
Check 'app and helper running' ($running.Count -ge 2)

# 3. Install again over the running copy.
$before = (Get-Item $exe).LastWriteTimeUtc
Start-Sleep 2
(Get-Item $exe).LastWriteTimeUtc = [datetime]'2000-01-01'
$r = RunFor $setup '/S' 120
$after = (Get-Item $exe -ErrorAction SilentlyContinue).LastWriteTimeUtc
Check 'install over a running copy finishes' ($r -eq 0 -and $after -gt [datetime]'2001-01-01') "exit=$r left: $(@(Ours) -join ' | ')"

# 4. Start it again, then uninstall while it runs.
Start-Process $exe
Start-Sleep 8
$un = Join-Path $dir 'Uninstall RadGesture.exe'
$r = RunFor $un '/S' 120
Start-Sleep 5
Check 'uninstall while running removes it' (-not (Test-Path $exe)) "exit=$r left: $(@(Ours) -join ' | ')"
Check 'nothing left running' (@(Ours).Count -eq 0) "$(@(Ours) -join ' | ')"

if ($fail) { exit 1 }
