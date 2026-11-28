'use strict';

// Retry the same payload and key when a response may have been lost after saving.
class PendingSubmission {
  constructor(path) {
    this.path = path;
    this.pending = null;
  }

  async send(makePayload) {
    if (!this.pending) {
      const body = JSON.stringify(await makePayload());
      this.pending = {key: crypto.randomUUID(), body};
    }
    const {key, body} = this.pending;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch(this.path, {
        method: 'POST', headers: {'Content-Type': 'application/json', 'Idempotency-Key': key},
        body, signal: controller.signal
      });
      const receipt = await response.json();
      if (!response.ok) {
        if (response.status >= 400 && response.status < 500) this.pending = null;
        throw Error(receipt.error || 'บันทึกไม่สำเร็จ');
      }
      if (typeof receipt.id !== 'string') throw Error('ไม่ได้รับเลขอ้างอิง');
      this.pending = null;
      return receipt;
    } finally {
      clearTimeout(timeout);
    }
  }
}
