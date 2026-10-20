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
//
// Plain-text replies, because the helper is AutoHotkey v1 and has no JSON.

const http = require('http');

function createBridge({ token, onShow, onRelease, onCancel, isOpen, onPoll = () => {}, onDone = () => {} }) {
  const queue = [];

  const server = http.createServer(async (req, res) => {
    const reply = (code, text) => {
      res.writeHead(code, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(text);
    };
    if (req.headers['x-rg-token'] !== token) return reply(403, 'bad token');
    const url = new URL(req.url, 'http://127.0.0.1');
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
        case '/ping':
          return reply(200, 'radgesture');
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
