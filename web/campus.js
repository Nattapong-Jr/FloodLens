'use strict';
(() => {
  const el = id => document.getElementById(id);
  const stamp = value => new Date(value).toLocaleString('th-TH', {timeZone: 'Asia/Bangkok'});
  const format = text => text.normalize('NFKC').trim().toLocaleLowerCase();
  const SIX_HOURS = 6 * 60 * 60 * 1000;
  let reports = [], map, markers, loadFailed = false;

  function waiting(report) {
    return Date.now() - Date.parse(report.confirmed_at ?? report.created_at) >= SIX_HOURS;
  }

  function drawMap(points) {
    const target = el('campusMap');
    target.hidden = !points.length || typeof L === 'undefined';
    if (target.hidden) {
      markers?.clearLayers();
      return;
    }
    if (!map) {
      map = L.map(target, {scrollWheelZoom: false}).setView([13.73,100.78],13);
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
      }).addTo(map);
      markers = L.layerGroup().addTo(map);
    }
    markers.clearLayers();
    for (const report of points) {
      const label = document.createElement('span');
      label.textContent = report.location + (waiting(report) ? ' · รออัปเดต' : '');
      L.circleMarker([report.latitude, report.longitude], {
        radius: 8, color: '#fff', weight: 2, fillOpacity: .95,
        fillColor: waiting(report) ? '#748594' : '#087f8c'
      }).addTo(markers).bindPopup(label);
    }
    map.invalidateSize();
    map.fitBounds(points.map(row => [row.latitude, row.longitude]), {padding:[25,25], maxZoom:15});
  }

  function render() {
    const query = format(el('campusSearch').value);
    const matches = reports.filter(row => format(row.location + ' ' + row.description).includes(query));
    const list = el('campusReports');
    list.replaceChildren();
    for (const report of matches) {
      const item = document.createElement('li');
      const title = document.createElement('strong');
      title.textContent = report.location + (waiting(report) ? ' · รออัปเดต' : '');
      item.append(title);
      const description = document.createElement('p');
      description.textContent = report.description;
      item.append(description);
      const metadata = document.createElement('p');
      metadata.textContent = [
        (report.reporter || 'ไม่ระบุชื่อ') + ' · รายงานเมื่อ ' + stamp(report.created_at),
        report.confirmed_at ? 'ยืนยันล่าสุด ' + stamp(report.confirmed_at) : 'ยังไม่ยืนยัน',
        report.latitude === null && 'ไม่มีพิกัดแผนที่'
      ].filter(Boolean).join(' · ');
      item.append(metadata);
      list.append(item);
    }
    const points = matches.filter(row => Number.isFinite(row.latitude) && Number.isFinite(row.longitude));
    el('campusStatus').textContent = loadFailed ? 'โหลดรายงานล่าสุดไม่ได้'
      : matches.length ? `พบ ${matches.length} รายการ${points.length && typeof L === 'undefined' ? ' · โหลดแผนที่ไม่ได้' : ''}`
      : reports.length ? 'ไม่มีรายงานตรงกับคำค้น' : 'ยังไม่มีรายงานใกล้ สจล.';
    drawMap(points);
  }

  async function load() {
    el('campusRefresh').disabled = true;
    el('campusStatus').textContent = 'กำลังโหลดรายงาน…';
    try {
      const response = await fetch('/api/reports/campus');
      if (!response.ok) throw Error('Could not load reports');
      reports = (await response.json()).reports;
      loadFailed = false;
    } catch {
      loadFailed = true;
    } finally {
      el('campusRefresh').disabled = false;
    }
    render();
  }
  el('campusSearch').oninput = render;
  el('campusRefresh').onclick = load;
  load();
})();
