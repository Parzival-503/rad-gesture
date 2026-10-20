// Finds old tools still running that would fight RadGesture for its keys:
// the old Kando-based RadGesture (Ctrl+CapsLock) and the standalone
// RadProofread / RadOneLiner / Lung-RADS scripts. Rad Optimizer and
// RadStopwatch are expected to run and are never flagged.

const { execFile } = require('child_process');
const path = require('path');

const PS = [
  '-NoProfile', '-NonInteractive', '-Command',
  "Get-CimInstance Win32_Process | Where-Object { $_.Name -match '^(AutoHotkey.*|radgesture|kando)\\.exe$' } | " +
    'Select-Object ProcessId, Name, ExecutablePath, CommandLine | ConvertTo-Json -Compress',
];

// Pure part, tested: which of these processes are conflicts?
function classify(procs, { selfExe, selfPids = [] }) {
  const list = Array.isArray(procs) ? procs : procs ? [procs] : [];
  const norm = (p) => String(p || '').toLowerCase();
  const out = [];
  for (const p of list) {
    if (selfPids.includes(p.ProcessId)) continue;
    const name = norm(p.Name);
    const cmd = norm(p.CommandLine);
    if (name === 'radgesture.exe' || name === 'kando.exe') {
      if (selfExe && norm(p.ExecutablePath) === norm(selfExe)) continue;
      // Electron runs several radgesture.exe processes; one entry per install is enough.
      if (out.some((o) => o.kind === 'old-radgesture' && norm(o.path) === norm(p.ExecutablePath))) continue;
      out.push({ kind: 'old-radgesture', pid: p.ProcessId, path: p.ExecutablePath, label: 'Old RadGesture (Kando)', keys: 'Ctrl+CapsLock' });
      continue;
    }
    if (!name.startsWith('autohotkey')) continue;
    const m = cmd.match(/([^"\\/]+\.ahk)/g);
    const script = m ? m[m.length - 1] : '';
    if (/radgesturehelper\.ahk/.test(script)) continue; // ours (fallback mode)
    if (/radproofread\.ahk/.test(script)) out.push({ kind: 'script', pid: p.ProcessId, label: 'RadProofread (standalone)', keys: 'Ctrl+Alt+Q', script });
    else if (/radoneliner\.ahk/.test(script)) out.push({ kind: 'script', pid: p.ProcessId, label: 'RadOneLiner (standalone)', keys: 'Ctrl+Alt+U', script });
    else if (/lung/.test(script) && !/optimizer|stopwatch/.test(script)) out.push({ kind: 'script', pid: p.ProcessId, label: `Lung-RADS (standalone: ${script})`, keys: 'Alt+Shift+L', script });
  }
  return out;
}

function scan({ selfExe, selfPids }) {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') return resolve([]);
    execFile('powershell.exe', PS, { windowsHide: true, timeout: 15000 }, (err, stdout) => {
      if (err || !stdout.trim()) return resolve([]);
      try {
        resolve(classify(JSON.parse(stdout), { selfExe, selfPids }));
      } catch (_) {
        resolve([]);
      }
    });
  });
}

function closeAll(items) {
  return Promise.all(
    items.map(
      (c) => new Promise((r) => execFile('taskkill', ['/PID', String(c.pid), '/T', '/F'], { windowsHide: true }, () => r()))
    )
  );
}

module.exports = { classify, scan, closeAll, _path: path };
