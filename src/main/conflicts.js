// Finds old tools still running that would fight RadGesture for its keys:
// the old Kando-based RadGesture (Ctrl+CapsLock), the standalone
// RadProofread / RadOneLiner scripts, and Rad Optimizer (as a
// script or compiled .exe) once its functions run from RadGesture's library
// with their keyboard shortcuts on.

const { execFile } = require('child_process');
const path = require('path');

const PS = [
  '-NoProfile', '-NonInteractive', '-Command',
  "Get-CimInstance Win32_Process | Where-Object { $_.Name -match '^(AutoHotkey.*|radgesture|kando|.*optimizer.*)\\.exe$' } | " +
    'Select-Object ProcessId, Name, ExecutablePath, CommandLine | ConvertTo-Json -Compress',
];

// Pure part, tested: which of these processes are conflicts?
const OPTIMIZER_KEYS = 'Ctrl+Alt+1-6 / D / O / P ..., Alt+Shift+E / T / C / S';

function classify(procs, { selfExe, selfPids = [], libraryOn = false }) {
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
    const optimizerLabel = 'Rad Optimizer (its functions are now in RadGesture: Settings > Functions)';
    if (!name.startsWith('autohotkey')) {
      // A compiled Rad Optimizer (Rad_Optimizer_<date>.exe).
      if (libraryOn && /optimizer/.test(name)) out.push({ kind: 'script', pid: p.ProcessId, label: optimizerLabel, keys: OPTIMIZER_KEYS, script: p.Name, optimizer: true });
      continue;
    }
    const m = cmd.match(/([^"\\/]+\.ahk)/g);
    const script = m ? m[m.length - 1] : '';
    if (/optimizer/.test(script)) {
      if (libraryOn) out.push({ kind: 'script', pid: p.ProcessId, label: optimizerLabel, keys: OPTIMIZER_KEYS, script, optimizer: true });
      continue;
    }
    if (/radgesturehelper\.ahk/.test(script)) continue; // ours (fallback mode)
    if (/radproofread\.ahk/.test(script)) out.push({ kind: 'script', pid: p.ProcessId, label: 'RadProofread (standalone)', keys: 'Ctrl+Alt+Q', script });
    else if (/radoneliner\.ahk/.test(script)) out.push({ kind: 'script', pid: p.ProcessId, label: 'RadOneLiner (standalone)', keys: 'Ctrl+Alt+U', script });
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
