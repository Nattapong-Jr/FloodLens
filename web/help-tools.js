'use strict';
const $ = id => document.getElementById(id);
const date = value => new Date(value).toLocaleString('th-TH');
const labels = {received: 'ระบบได้รับคำขอแล้ว', accepted: 'มีผู้รับเรื่องแล้ว', closed: 'ปิดเคสแล้ว'};
const needs = {evacuation: 'ออกจากพื้นที่', supplies: 'อาหาร น้ำ หรือของจำเป็น',
  medical: 'ความช่วยเหลือทางการแพทย์', other: 'อื่น ๆ'};

async function api(path, token, data) {
  const headers = {Authorization: 'Bearer ' + token};
  const options = {headers, cache: 'no-store'};
  if (data) {
    headers['Content-Type'] = 'application/json';
    options.method = 'POST';
    options.body = JSON.stringify(data);
  }
  const response = await fetch(path, options);
  const result = await response.json();
  if (!response.ok) throw Error(result.error);
  return result;
}

async function track() {
  const token = location.hash.slice(1);
  if (!/^[a-f0-9]{32}$/.test(token)) {
    $('progress').textContent = 'กรุณาเปิดลิงก์ติดตามที่ได้รับหลังส่งคำขอ';
    return;
  }
  $('reload').disabled = true;
  try {
    const row = await api('/api/help/status', token);
    $('progress').textContent = [labels[row.status], `ส่งเมื่อ ${date(row.created_at)}`,
      row.accepted_at && `รับเรื่องเมื่อ ${date(row.accepted_at)}`,
      row.closed_at && `ปิดเคสเมื่อ ${date(row.closed_at)}`].filter(Boolean).join('\n');
  } catch (error) {
    $('progress').textContent = 'ตรวจสถานะไม่ได้ · ' + error.message;
  } finally {
    $('reload').disabled = false;
  }
}

function add(parent, tag, content) {
  const node = document.createElement(tag);
  node.textContent = content;
  parent.append(node);
  return node;
}

function actionForm(card, token, row, action, title, key, label, maxLength, value = '') {
  const form = add(card, 'form', '');
  const field = add(add(form, 'label', label), key === 'outcome' ? 'textarea' : 'input', '');
  field.value = value;
  field.required = true;
  field.maxLength = maxLength;
  const button = add(form, 'button', title);
  button.type = 'submit';
  form.onsubmit = async event => {
    event.preventDefault();
    button.disabled = true;
    try {
      await api('/api/help/queue', token, {id: row.id, action, [key]: field.value});
      await loadQueue(token);
    } catch (error) {
      $('queueStatus').textContent = 'บันทึกไม่สำเร็จ · ' + error.message;
    } finally {
      button.disabled = false;
    }
  };
}

function renderCase(row, token) {
  const card = add($('queue'), 'article', '');
  add(card, 'h2', `${needs[row.need]} · ${row.people} คน`);
  add(card, 'p', `${labels[row.closed_at ? 'closed' : row.accepted_at ? 'accepted' : 'received']} · ${date(row.created_at)}`);
  add(card, 'p', `จุดสังเกต: ${row.landmark}`);
  if (row.details) add(card, 'p', row.details);
  if (row.contact) add(card, 'p', `ติดต่อ: ${row.contact}`);
  if (row.latitude !== null) add(card, 'p', `พิกัด: ${row.latitude}, ${row.longitude}`);
  if (row.accepted_at) add(card, 'p', `ผู้รับผิดชอบ: ${row.assignee} · รับเรื่องเมื่อ ${date(row.accepted_at)}`);
  if (row.closed_at) {
    add(card, 'p', `ปิดเคสเมื่อ ${date(row.closed_at)}\nผลการดำเนินงาน: ${row.outcome}`);
  } else if (row.accepted_at) {
    actionForm(card, token, row, 'assign', 'มอบหมายงาน', 'assignee', 'ผู้รับผิดชอบ', 100, row.assignee);
    actionForm(card, token, row, 'close', 'บันทึกผลและปิดเคส', 'outcome', 'ผลการดำเนินงาน', 2000);
  } else {
    actionForm(card, token, row, 'accept', 'รับเรื่อง', 'assignee', 'ชื่อผู้รับผิดชอบ', 100);
  }
}

let queueLoad = 0;
async function loadQueue(token) {
  const request = ++queueLoad;
  $('queue').replaceChildren();
  $('queueStatus').textContent = 'กำลังโหลดคิว…';
  try {
    const result = await api('/api/help/queue', token);
    if (request !== queueLoad) return;
    result.requests.forEach(row => renderCase(row, token));
    $('verification').hidden = false;
    $('queueStatus').textContent = result.requests.length ? `คิวทั้งหมด ${result.requests.length} รายการ` : 'ยังไม่มีคำขอ';
  } catch (error) {
    if (request === queueLoad) $('queueStatus').textContent = 'เปิดคิวไม่ได้ · ' + error.message;
  }
}

async function reviewReports(token) {
  const reports = $('reviewList');
  reports.replaceChildren();
  try {
    const result = await api('/api/reports/campus', token);
    $('reviewStatus').textContent = result.reports.length ? '' : 'ยังไม่มีรายงาน';
    for (const row of result.reports) {
      const card = add(reports, 'article', '');
      add(card, 'h3', row.location);
      add(card, 'p', row.description);
      add(card, 'p', row.confirmed_at ? 'ยืนยันล่าสุด ' + date(row.confirmed_at) : 'ยังไม่ยืนยัน');
      const photo = add(card, 'a', 'เปิดภาพรายงาน');
      photo.href = '/api/reports/' + row.id + '/photo';
      photo.target = '_blank';
      photo.rel = 'noopener';
      const button = add(card, 'button', 'ยืนยันสถานการณ์ ณ ตอนนี้');
      button.type = 'button';
      button.onclick = async () => {
        button.disabled = true;
        try {
          await api('/api/reports/confirm', token, {id: row.id});
          await reviewReports(token);
        } catch (error) {
          $('reviewStatus').textContent = 'ยืนยันไม่ได้ · ' + error.message;
        } finally {
          button.disabled = false;
        }
      };
    }
  } catch (error) {
    $('reviewStatus').textContent = 'โหลดรายงานไม่ได้ · ' + error.message;
  }
}

if ($('progress')) {
  $('reload').onclick = track;
  window.addEventListener('hashchange', track);
  track();
} else {
  let coordinatorToken = '';
  $('reviewReports').onclick = () => reviewReports(coordinatorToken);
  $('refreshQueue').onclick = () => loadQueue(coordinatorToken);
  $('queueLogin').onsubmit = event => {
    event.preventDefault();
    coordinatorToken = $('key').value.trim();
    $('verification').hidden = true;
    $('reviewList').replaceChildren();
    loadQueue(coordinatorToken);
    $('refreshQueue').hidden = false;
    $('key').value = '';
  };
}
