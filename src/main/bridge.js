// Local bridge between the hub and the AutoHotkey helper.
//
// The helper owns the keyboard (Ctrl+CapsLock) and does all the typing and
// PowerScribe work; the hub owns the ring. They talk over plain HTTP on
// 127.0.0.1 only, with a shared token so no other program can drive it.
//
//   POST /show?app=<exe>  helper: trigger went down -> "ok" | "paused"
//   POST /release         helper: trigger came up -> "action:<id>" | "stay" | "none"
//   POST /cancel          helper: Esc pressed
//   GET  /poll            helper: "action:<id>" (queued) | "open" | "closed"
//                         (also the heartbeat: it proves the helper is alive)
//   POST /done?action=<id> helper: finished running an action
//   POST /proofread       helper: proofread results (JSON body) -> "ok" when shown
//   POST /proofread-toast helper: a short message for the proofread window (body)
//   POST /ui              helper: what its small windows show (JSON, t = toolbar |
//                         card | card-close | pick | pick-close | toast | toast-hide) -> "ok"
//   POST /style/learn     helper: a finished report to learn the impression style
//                         from (JSON: report, draft, source) -> "saved:<n>:<kind>" | "skip:<why>" | "off"
//   POST /style/examples  helper: the report about to get an impression (JSON: report)
//                         -> the radiologist's closest examples as prompt text, or ""
//
// Plain-text replies, because the helper is AutoHotkey v1 and has no JSON.

const http = require('http');

function createBridge({ token, onShow, onRelease, onCancel, isOpen, onPoll = () => {}, onDone = () => {}, onQuit = () => {}, onOpenSettings = () => {}, onProofread = () => 'no', onProofToast = () => {}, onStyleLearn = () => 'off', onStyleExamples = () => '', onUi = () => 'no' }) {
  const queue = [];

  const server = http.createServer(async (req, res) => {
    const reply = (code, text) => {
      res.writeHead(code, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(text);
    };
    if (req.headers['x-rg-token'] !== token) return reply(403, 'bad token');
    const url = new URL(req.url, 'http://127.0.0.1');
    // The request body, for the two that carry one (at most 2 MB).
    const body = () => new Promise((resolve, reject) => {
      let size = 0;
      const parts = [];
      req.on('data', (c) => {
        size += c.length;
        if (size > 2e6) return reject(new Error('too big'));
        parts.push(c);
      });
      req.on('end', () => resolve(Buffer.concat(parts).toString('utf8')));
      req.on('error', reject);
    });
    try {
      switch (url.pathname) {
        case '/show':
          return reply(200, (await onShow(url.searchParams.get('app') || '')) || 'ok');
        case '/release':
          return reply(200, (await onRelease()) || 'none');
        case '/cancel':
          await onCancel();
          return reply(200, 'ok');
        case '/done':
          onDone(url.searchParams.get('action') || '');
          return reply(200, 'ok');
        case '/poll':
          onPoll();
          if (queue.length) return reply(200, 'action:' + queue.shift());
          return reply(200, isOpen() ? 'open' : 'closed');
        case '/proofread': {
          if (req.method !== 'POST') return reply(405, 'POST only');
          let data;
          try {
            data = JSON.parse(await body());
          } catch (_) {
            return reply(400, 'bad json');
          }
          return reply(200, (await onProofread(data)) || 'no');
        }
        case '/proofread-toast':
          onProofToast(await body());
          return reply(200, 'ok');
        case '/ui': {
          if (req.method !== 'POST') return reply(405, 'POST only');
          let data;
          try {
            data = JSON.parse(await body());
          } catch (_) {
            return reply(400, 'bad json');
          }
          return reply(200, (await onUi(data)) || 'no');
        }
        case '/style/learn': {
          if (req.method !== 'POST') return reply(405, 'POST only');
          let data;
          try {
            data = JSON.parse(await body());
          } catch (_) {
            return reply(400, 'bad json');
          }
          return reply(200, (await onStyleLearn(data)) || 'off');
        }
        case '/style/examples': {
          if (req.method !== 'POST') return reply(405, 'POST only');
          // JSON { report } (all ASCII, as the helper sends it), or the bare text.
          const raw = await body();
          let report = raw;
          try { report = String(JSON.parse(raw).report || ''); } catch (_) { /* bare text */ }
          return reply(200, (await onStyleExamples(report)) || '');
        }
        case '/ping':
          return reply(200, 'radgesture');
        case '/open-settings':
          // The helper's own "AI settings" (tray, ring, "no key" prompt) opens
          // the Settings window instead of its old built-in box.
          onOpenSettings(url.searchParams.get('tab') || '');
          return reply(200, 'ok');
        case '/quit':
          // The installer / uninstaller asks the running copy to quit. Works
          // even when RadGesture runs as administrator and Setup doesn't,
          // where Windows refuses to let Setup close it by force.
          if (req.method !== 'POST') return reply(405, 'POST only');
          reply(200, 'bye');
          return onQuit();
        default:
          return reply(404, 'unknown');
      }
    } catch (e) {
      return reply(500, 'error: ' + e.message);
    }
  });

  return {
    server,
    // Actions picked by clicking (not by releasing the trigger) wait here
    // until the helper's next poll.
    enqueue(id) {
      queue.push(id);
    },
    pending() {
      return queue.slice();
    },
    // Try the preferred port, then the next few, so a clash never stops the hub.
    listen(port, tries = 10) {
      return new Promise((resolve, reject) => {
        const attempt = (p, left) => {
          server.once('error', (e) => {
            if (e.code === 'EADDRINUSE' && left > 0) attempt(p + 1, left - 1);
            else reject(e);
          });
          server.listen(p, '127.0.0.1', () => resolve(server.address().port));
        };
        attempt(port, tries);
      });
    },
    close() {
      return new Promise((r) => server.close(() => r()));
    },
  };
}

module.exports = { createBridge };
