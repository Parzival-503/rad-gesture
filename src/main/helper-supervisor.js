// Starts the AutoHotkey helper, keeps it running, and reports how it is doing.
//
// Preferred: RadGestureHelper.exe, compiled from the .ahk by the build and
// shipped inside the app, so nothing depends on where (or whether) AutoHotkey
// is installed. Fallback: the .ahk with an installed AutoHotkey v1.1, run with
// /ErrorStdOut so a script error is captured and shown in Settings instead of
// sitting in a dialog box nobody sees.
//
// "connected" means the helper has called the hub recently (it polls every
// 750 ms), which is the only proof that Ctrl+CapsLock will actually work.

const fs = require('fs');
const path = require('path');
const { spawn, execFile } = require('child_process');

function findAutoHotkey(configured, env = process.env) {
  const roots = [env.ProgramFiles, env['ProgramFiles(x86)'], path.join(env.LOCALAPPDATA || '', 'Programs')]
    .filter(Boolean)
    .map((r) => path.join(r, 'AutoHotkey'));
  const candidates = [configured];
  for (const r of roots) {
    // AutoHotkey v2's installer keeps v1.1 in a versioned subfolder.
    try {
      for (const d of fs.readdirSync(r).filter((d) => /^v1\.1/.test(d)).sort().reverse()) {
        candidates.push(path.join(r, d, 'AutoHotkeyU64.exe'), path.join(r, d, 'AutoHotkey.exe'));
      }
    } catch (_) {}
    candidates.push(path.join(r, 'AutoHotkeyU64.exe'), path.join(r, 'AutoHotkey.exe'));
  }
  return candidates.find((c) => c && fs.existsSync(c)) || null;
}

function createSupervisor({ resourcesDir, ahkPathSetting, onChange, log = () => {} }) {
  const exePath = path.join(resourcesDir, 'RadGestureHelper.exe');
  const scriptPath = path.join(resourcesDir, 'RadGestureHelper.ahk');
  const st = {
    mode: null, // 'bundled' | 'autohotkey' | null
    pid: null,
    running: false,
    lastPoll: 0,
    lastAction: null,
    lastError: '',
    output: '',
    restarts: [],
    stopped: false,
  };
  let child = null;
  let timer = null;

  function changed() {
    onChange && onChange(status());
  }

  function status() {
    return {
      mode: st.mode,
      pid: st.pid,
      running: st.running,
      connected: Date.now() - st.lastPoll < 3000,
      lastPollAgoMs: st.lastPoll ? Date.now() - st.lastPoll : null,
      lastAction: st.lastAction,
      lastError: st.lastError,
      bundledExe: fs.existsSync(exePath),
      autoHotkey: findAutoHotkey(ahkPathSetting && ahkPathSetting()),
    };
  }

  function start() {
    if (process.platform !== 'win32') {
      st.lastError = 'The helper only runs on Windows.';
      changed();
      return;
    }
    stopChild();
    st.stopped = false;
    st.output = '';
    let cmd, args;
    if (fs.existsSync(exePath)) {
      // A build that could not compile ships AutoHotkey itself as the exe
      // (marked by RadGestureHelper.interpreter); give it the script.
      const interp = fs.existsSync(path.join(resourcesDir, 'RadGestureHelper.interpreter'));
      st.mode = 'bundled';
      cmd = exePath;
      args = interp ? ['/ErrorStdOut', scriptPath] : [];
    } else {
      const ahk = findAutoHotkey(ahkPathSetting && ahkPathSetting());
      if (!ahk) {
        st.mode = null;
        st.running = false;
        st.lastError = 'AutoHotkey v1.1 was not found, and this build has no bundled helper.';
        changed();
        return;
      }
      st.mode = 'autohotkey';
      cmd = ahk;
      args = ['/ErrorStdOut', scriptPath];
    }
    log(`starting helper: ${cmd} ${args.join(' ')}`);
    try {
      child = spawn(cmd, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      st.lastError = 'Could not start the helper: ' + e.message;
      changed();
      return;
    }
    st.pid = child.pid;
    st.running = true;
    st.lastError = '';
    const grab = (d) => {
      st.output = (st.output + d.toString()).slice(-2000);
    };
    child.stdout.on('data', grab);
    child.stderr.on('data', grab);
    child.on('error', (e) => {
      st.lastError = 'Could not start the helper: ' + e.message;
      st.running = false;
      changed();
    });
    child.on('exit', (code) => {
      st.running = false;
      st.pid = null;
      child = null;
      if (st.stopped) return changed();
      st.lastError = st.output.trim()
        ? 'The helper stopped with this message: ' + st.output.trim().slice(0, 600)
        : `The helper stopped (exit code ${code}).`;
      log(st.lastError);
      // Restart with growing pauses; give up after 5 tries in 2 minutes.
      const now = Date.now();
      st.restarts = st.restarts.filter((t) => now - t < 120000);
      if (st.restarts.length < 5) {
        st.restarts.push(now);
        const wait = [1000, 2000, 5000, 10000, 20000][st.restarts.length - 1];
        clearTimeout(timer);
        timer = setTimeout(start, wait);
      }
      changed();
    });
    changed();
  }

  function stopChild() {
    clearTimeout(timer);
    if (child) {
      const pid = child.pid;
      st.stopped = true;
      try {
        child.kill();
      } catch (_) {}
      // AutoHotkey can leave its tray icon behind if killed politely and slowly.
      if (process.platform === 'win32' && pid) execFile('taskkill', ['/PID', String(pid), '/T', '/F'], () => {});
      child = null;
    }
  }

  return {
    start,
    restart: () => {
      st.restarts = [];
      start();
    },
    stop: () => {
      st.stopped = true;
      stopChild();
    },
    status,
    notePoll() {
      const was = Date.now() - st.lastPoll < 3000;
      st.lastPoll = Date.now();
      if (!was) changed();
    },
    noteDone(action) {
      st.lastAction = { action, at: Date.now() };
      changed();
    },
  };
}

module.exports = { createSupervisor, findAutoHotkey };
