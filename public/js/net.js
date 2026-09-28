// Socket.IO wrapper: `send()` resolves with the server's acknowledgement (or an error object on timeout).
export const socket = window.io({ transports: ['websocket', 'polling'] });

export function send(event, payload = {}) {
  return new Promise((resolve) => {
    socket.timeout(8000).emit(event, payload, (error, reply) => {
      resolve(error ? { ok: false, error: 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ลองใหม่อีกครั้ง' } : reply ?? { ok: true });
    });
  });
}

export function fire(event, payload = {}) {
  socket.emit(event, payload);
}
