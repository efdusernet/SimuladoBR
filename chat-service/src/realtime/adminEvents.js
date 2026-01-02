const { EventEmitter } = require('events');

const adminEvents = new EventEmitter();
adminEvents.setMaxListeners(0);

function emitAdminRefresh(payload) {
  adminEvents.emit('refresh', {
    ts: Date.now(),
    ...(payload && typeof payload === 'object' ? payload : {}),
  });
}

module.exports = { adminEvents, emitAdminRefresh };
