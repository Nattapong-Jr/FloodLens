'use strict';
const $ = id => document.getElementById(id);
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
  const payload = {
    need: $('need').value, people: $('people').valueAsNumber, landmark: $('landmark').value,
    details: $('details').value, contact: $('contact').value, ...coordinates
  };
  $('submit').disabled = true;
  $('status').textContent = 'กำลังส่งคำขอ…';
  try {
    const response = await fetch('/api/help', {
      method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(payload)
    });
    const data = await response.json();
    if (!response.ok) throw Error(data.error);
    $('status').textContent = `ระบบได้รับคำขอแล้ว (${data.id}) · ยังไม่มีผู้รับเรื่อง`;
    $('trackingLink').href = '/track#' + data.id;
    $('trackingLink').hidden = false;
    $('helpForm').reset();
    $('clearLocation').click();
  } catch (error) {
    $('status').textContent = 'ยังยืนยันการส่งไม่ได้ กรุณาลองอีกครั้ง';
  } finally {
    $('submit').disabled = false;
  }
};
