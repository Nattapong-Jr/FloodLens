'use strict';
const $ = id => document.getElementById(id);
const submission = new PendingSubmission('/api/help');
let coordinates = null;

$('clearLocation').onclick = () => {
  coordinates = null;
  $('clearLocation').hidden = true;
  $('geoStatus').textContent = 'ยังไม่ได้แนบพิกัด';
};
$('locate').onclick = () => {
  if (!navigator.geolocation) {
    $('geoStatus').textContent = 'ใช้งานพิกัดไม่ได้ กรุณาระบุจุดสังเกต';
    return;
  }
  $('locate').disabled = true;
  $('geoStatus').textContent = 'กำลังขอพิกัด…';
  navigator.geolocation.getCurrentPosition(({coords}) => {
    coordinates = {latitude: coords.latitude, longitude: coords.longitude};
    $('geoStatus').textContent = 'แนบพิกัดแล้ว';
    $('locate').disabled = false;
    $('clearLocation').hidden = false;
  }, () => {
    $('clearLocation').click();
    $('geoStatus').textContent = 'เข้าถึงพิกัดไม่ได้ ส่งคำขอด้วยจุดสังเกตได้';
    $('locate').disabled = false;
  }, {timeout: 15000});
};
$('helpForm').onsubmit = async event => {
  event.preventDefault();
  if ($('submit').disabled) return;
  $('submit').disabled = true;
  $('submissionFields').disabled = true;
  $('status').textContent = 'กำลังส่งคำขอ…';
  try {
    const data = await submission.send(() => ({
      need: $('need').value, people: $('people').valueAsNumber, landmark: $('landmark').value,
      details: $('details').value, contact: $('contact').value, ...coordinates
    }));
    $('status').textContent = `ระบบได้รับคำขอแล้ว (${data.id}) · ยังไม่มีผู้รับเรื่อง`;
    $('trackingLink').href = '/track#' + data.id;
    $('trackingLink').hidden = false;
    $('helpForm').reset();
    $('clearLocation').onclick();
  } catch (error) {
    $('status').textContent = submission.pending
      ? 'ยังยืนยันการส่งไม่ได้ ข้อมูลยังอยู่ กดส่งอีกครั้งเพื่อตรวจหรือส่งคำขอเดิม'
      : error.message;
  } finally {
    $('submissionFields').disabled = Boolean(submission.pending);
    $('submit').disabled = false;
    $('submit').textContent = submission.pending ? 'ลองส่งอีกครั้ง' : 'ส่งคำขอ';
  }
};
