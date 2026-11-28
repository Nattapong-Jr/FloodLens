'use strict';
(async () => {
  try {
    const response = await fetch('/api/help/coverage');
    if (!response.ok) return;
    const {coverage} = await response.json();
    if (!coverage) return;
    document.getElementById('availability').textContent =
      `ทีมรับเรื่อง: ${coverage.team} · เวลาเฝ้าคิว: ${coverage.hours} · ติดต่อ: ${coverage.contact} ช่วงนอกเวลาที่ระบุไม่มีการเฝ้าคิว ระบบไม่ยืนยันว่ามีเจ้าหน้าที่ออนไลน์`;
  } catch {
    // Keep the default unconfirmed coverage notice.
  }
})();
