'use strict';
const el = id => document.getElementById(id);
const names = {water:'ระดับน้ำ', rain:'ฝนสะสม 24 ชม.', flow:'อัตราการไหล', forecast:'พยากรณ์'};
const units = {water:'ม.รทก.', rain:'มม./24 ชม.', flow:'ลบ.ม./วินาที'};
const fmt = t => t ? new Date(t).toLocaleString('th-TH',{timeZone:'Asia/Bangkok'}) : 'ยังไม่มี';
const num = (v, digits=2) => typeof v === 'number' && Number.isFinite(v) ? v.toFixed(digits) : '—';
const text = (tag, value, parent, cls) => {const n=document.createElement(tag);n.textContent=value;if(cls)n.className=cls;if(parent)parent.append(n);return n;};
let snapshot=null, feed='water', selected=null, history=[], busy=false, historyRequest=0;
function rowsFor(key) {
  const q=el('search').value.trim().toLocaleLowerCase(), radius=el('scope').value==='local'?10:150;
  return (snapshot?.feeds[key]?.rows??[]).filter(r=>r.distance_km<=radius&&(!el('fresh').checked||!r.stale)&&
    [r.name,r.station_code,r.river,r.basin,r.province,r.district].join(' ').toLocaleLowerCase().includes(q));
}
function status(f) {
  if(!f)return 'ยังไม่มี feed นี้ — รีสตาร์ทเซิร์ฟเวอร์หลังอัปเดตโค้ด';
  if(f.status==='pending')return 'กำลังรอดึงข้อมูลรอบแรก…';
  if(f.status==='error')return 'ต้นทางไม่พร้อม: '+f.error;
  return (f.status==='empty'?'ไม่พบระเบียนที่ใช้ได้':'ดึงเมื่อ '+fmt(f.fetched_at))+
    (f.cache_stale?' · สำเนาเก่าเกิน 15 นาที':'')+(f.rejected?' · ข้ามระเบียนไม่สมบูรณ์ '+f.rejected:'');
}
function tableRow(target, values) {
  const tr=document.createElement('tr');values.forEach(v=>text('td',v??'—',tr));target.append(tr);return tr;
}
const svgNS='http://www.w3.org/2000/svg';
function svgNode(tag,attrs={},parent){const n=document.createElementNS(svgNS,tag);for(const [k,v] of Object.entries(attrs))n.setAttribute(k,String(v));if(parent)parent.append(n);return n;}
function svgText(svg,x,y,value,attrs={}){const n=svgNode('text',{x,y,fill:'#a0b7ca','font-size':11,...attrs},svg);n.textContent=value;return n;}
// Keep the station map alive across polling so the user's zoom is preserved.
let stationMap=null, stationLayer=null, stationTiles=null, mapFilter=null;
const stationMarkers=new Map();
function clearStationMap(){
  if(stationLayer)stationLayer.clearLayers();
  stationMarkers.clear();
  if(stationMap)stationMap.closePopup();
}
function plotMap(target,points){
  const note=el('mapStatus');
  if(typeof L==='undefined'){
    target.replaceChildren();
    text('p','โหลดแผนที่ไม่สำเร็จ กรุณาตรวจอินเทอร์เน็ตแล้วโหลดหน้าใหม่ ยังเลือกสถานีจากตารางด้านล่างได้',target);
    return;
  }
  if(!stationMap){
    target.replaceChildren();
    stationMap=L.map(target,{scrollWheelZoom:false}).setView([13.73,100.78],12);
    stationTiles=L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{
      maxZoom:19,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(stationMap);
    stationTiles.on('tileerror',()=>{note.textContent='โหลดภาพแผนที่บางส่วนไม่ได้ ตรวจอินเทอร์เน็ต หรือเลือกสถานีจากตารางด้านล่าง';});
    stationLayer=L.layerGroup().addTo(stationMap);
    L.circleMarker([13.73,100.78],{radius:10,color:'#7b4b00',fillColor:'#ffd166',fillOpacity:1,weight:3})
      .addTo(stationMap).bindTooltip('KMITL — จุดอ้างอิง',{permanent:true,direction:'top'});
  }
  clearStationMap();
  const usable=points.filter(p=>Number.isFinite(p.latitude)&&Number.isFinite(p.longitude)&&Math.abs(p.latitude)<=90&&Math.abs(p.longitude)<=180);
  const key=feed;
  for(const p of usable){
    const content=document.createElement('div');
    text('strong',p.name||p.station_id,content);
    text('p',names[key]+': '+num(p.value)+' '+units[key],content);
    text('p',(p.stale?'ข้อมูลเก่า — ':'วัดเมื่อ ')+fmt(p.timestamp),content);
    const button=text('button','ดูประวัติสถานี',content,'map-history');
    button.onclick=()=>{feed=key;choose(p);};
    const marker=L.circleMarker([p.latitude,p.longitude],{radius:8,color:'#ffffff',weight:2,
      fillColor:p.stale?'#748594':'#087f8c',fillOpacity:.95}).addTo(stationLayer).bindPopup(content);
    // A marker click also updates the existing history panel.
    marker.on('click',()=>choose(p));
    stationMarkers.set(p.station_id,marker);
  }
  note.textContent=usable.length?'ลากเพื่อเลื่อน · กด + / − เพื่อซูม · กดจุดเพื่อดูค่าและประวัติ':'ไม่พบสถานีตามตัวกรอง ลองเปลี่ยนพื้นที่หรือคำค้น';
  const filter=JSON.stringify([el('scope').value,el('search').value,el('fresh').checked]);
  if(mapFilter!==filter){
    stationMap.fitBounds([[13.73,100.78],...usable.map(p=>[p.latitude,p.longitude])],{padding:[30,30],maxZoom:13});
    mapFilter=filter;
  }
  stationMap.invalidateSize();
}
el('mapHome').onclick=()=>{if(stationMap)stationMap.setView([13.73,100.78],13);};
el('mapFit').onclick=()=>{mapFilter=null;if(snapshot)renderStations();};
function seriesChart(target,rows,key,bars=false){
  target.replaceChildren();const valid=rows.filter(r=>Number.isFinite(r[key]));
  if(!valid.length){text('p','ยังไม่มีข้อมูลสำหรับกราฟ',target);return;}
  const w=850,h=210,L=60,R=18,T=20,B=38;let low=Math.min(...valid.map(r=>r[key])),high=Math.max(...valid.map(r=>r[key]));
  if(bars)low=Math.min(0,low);if(low===high){low-=.05;high+=.05;}
  const a=Date.parse(rows[0].timestamp),b=Date.parse(rows.at(-1).timestamp),x=t=>L+(Date.parse(t)-a)/(b-a||1)*(w-L-R),y=v=>T+(high-v)/(high-low)*(h-T-B);
  const svg=svgNode('svg',{viewBox:`0 0 ${w} ${h}`,role:'img','aria-label':bars?'ปริมาณฝนตามเวลา':'ค่าตรวจวัดตามเวลา'},target);
  for(let i=0;i<=4;i++){const v=low+(high-low)*i/4,yy=y(v);svgNode('line',{x1:L,x2:w-R,y1:yy,y2:yy,stroke:'#294256'},svg);svgText(svg,0,yy+4,num(v));}
  let prev=null;
  for(const r of rows){if(!Number.isFinite(r[key])){prev=null;continue;}const cx=x(r.timestamp),cy=y(r[key]);
    if(bars)svgNode('line',{x1:cx,x2:cx,y1:y(0),y2:cy,stroke:'#60e4e4','stroke-width':6},svg);
    else{if(prev&&Date.parse(r.timestamp)-Date.parse(prev.timestamp)<=3*3600000)svgNode('line',{x1:x(prev.timestamp),y1:y(prev[key]),x2:cx,y2:cy,stroke:'#60e4e4','stroke-width':2},svg);svgNode('circle',{cx,cy,r:3,fill:'#60e4e4'},svg);prev=r;}}
  svgText(svg,L,h-10,fmt(rows[0].timestamp));svgText(svg,w-R,h-10,fmt(rows.at(-1).timestamp),{'text-anchor':'end'});
}
function render(){
  if(!snapshot)return;
  const system=snapshot.system;
  el('collector').textContent=!system?'ต้องรีสตาร์ทเซิร์ฟเวอร์':system.collecting?'กำลังเก็บข้อมูล':system.collector_running?'ตัวเก็บข้อมูลทำงาน':'ตัวเก็บข้อมูลหยุด';
  el('archiveCount').textContent=system?.observation_count?.toLocaleString()??'—';
  el('archiveMeta').textContent=system?.first_observation_epoch?'เริ่มข้อมูล '+fmt(system.first_observation_epoch*1000):'ยังไม่มีข้อมูลตรวจวัดที่เก็บสำเร็จ';
  for(const key of ['water','flow']){const rows=rowsFor(key);el(key+'Count').textContent=rows.length;el(key+'Meta').textContent=`ข้อมูลเก่า ${rows.filter(r=>r.stale).length} สถานี · ตามตัวกรองปัจจุบัน`;}
  const forecast=snapshot.feeds.forecast, upcoming=(forecast?.rows??[]).filter(r=>Date.parse(r.timestamp)>Date.now()&&Date.parse(r.timestamp)<=Date.now()+86400000);
  const complete=upcoming.length===24&&upcoming.every(r=>r.precipitation_mm!==null);
  el('forecastTotal').textContent=complete?num(upcoming.reduce((s,r)=>s+r.precipitation_mm,0),1)+' มม.':'—';
  el('forecastMeta').textContent=forecast?.cache_stale?'สำเนาพยากรณ์เก่า — ตรวจเวลาต้นทาง':complete?'24 ช่วงชั่วโมง · แบบจำลอง':'ข้อมูลยังไม่ครบ 24 ชั่วโมง';
  renderStations();renderWeather();
  el('systemStatus').textContent=system?`รอบล่าสุด ${fmt(system.last_attempt)} · ตั้งรอบ ${system.poll_seconds} วินาที · ${system.last_error??'ไม่มีข้อผิดพลาดภายในตัวเก็บข้อมูล'}`:'ยังไม่ได้เปิดเซิร์ฟเวอร์รุ่นเก็บประวัติ';
  el('feedHealth').replaceChildren();for(const [key,f] of Object.entries(snapshot.feeds))text('p',names[key]+': '+status(f),el('feedHealth'),f.status==='error'||f.cache_stale?'error':'muted');
}
function renderStations(){
  const f=snapshot?.feeds[feed],rows=rowsFor(feed);el('feedStatus').textContent=status(f);el('feedStatus').className=f?.status==='error'||f?.cache_stale?'error':'muted';
  el('tableTitle').textContent='สถานี'+names[feed]+' · '+rows.length+' จุด';el('unitHead').textContent=units[feed];
  el('tableNote').textContent=feed==='flow'?'ค่าบวก/ลบเป็นสัญญาณตามจุดอ้างอิงสถานี ยังไม่แปลเป็นทิศเหนือ/ใต้ และห้ามรวมเป็นน้ำเข้าพื้นที่':feed==='rain'?'ค่าฝนสะสม 24 ชั่วโมงล่าสุด ห้ามรวมข้ามสถานีหรือรวมช่วงสะสมที่ซ้อนกัน':'แนวโน้มคำนวณจากสองค่าล่าสุดที่ห่างกันไม่เกิน 3 ชม. ไม่ใช่การทำนายระดับน้ำ';
  el('stations').replaceChildren();
  rows.forEach(r=>{const rate=r.trend?num(r.trend.per_hour)+(feed==='water'?' ม./ชม.':' (ลบ.ม./วินาที)/ชม.'):'ยังไม่มีคู่ข้อมูล';
    const tr=tableRow(el('stations'),['',[r.district,r.province].filter(Boolean).join(' / '),num(r.distance_km)+' กม.',num(r.value),rate,fmt(r.timestamp),r.stale?'ข้อมูลเก่า / เวลาผิดปกติ':'อายุไม่เกิน 3 ชม.']);
    const button=text('button',r.name||r.station_id,tr.firstChild,'station-button');button.onclick=()=>choose(r);text('small',r.river||r.station_code||'',tr.firstChild);});
  plotMap(el('geo'),rows);
}
async function choose(station){
  if(stationMap){const marker=stationMarkers.get(station.station_id);if(marker){stationMap.panTo([station.latitude,station.longitude]);marker.openPopup();}}
  selected={...station,feed};el('detailTitle').textContent=station.name||station.station_id;
  el('detailMeta').textContent=[station.station_code,station.agency,station.river,station.basin].filter(Boolean).join(' · ')+` · ล่าสุด ${num(station.value)} ${units[feed]} (${fmt(station.timestamp)})`;
  el('stationMap').classList.remove('hidden');el('stationMap').href=`https://www.openstreetmap.org/?mlat=${station.latitude}&mlon=${station.longitude}#map=15/${station.latitude}/${station.longitude}`;
  await loadHistory();}
async function loadHistory(){
  if(!selected)return;const seq=++historyRequest;el('historyStatus').textContent='กำลังอ่านประวัติ…';el('export').disabled=true;
  try{const qs=new URLSearchParams({feed:selected.feed,station_id:selected.station_id,hours:el('hours').value}),res=await fetch('/api/history?'+qs);
    if(!res.ok)throw Error('HTTP '+res.status);const data=await res.json();if(seq!==historyRequest)return;
    history=data.rows;el('historyStatus').textContent=`เก็บได้ ${history.length} จุดในช่วงที่เลือก`+(history.length<2?' · ต้องรอข้อมูลตรวจวัดเวลาถัดไปเพื่อดูการเปลี่ยนแปลง':'');
    seriesChart(el('historyChart'),history,'value');el('export').disabled=!history.length;
    el('historyStats').replaceChildren();if(history.length){const values=history.map(r=>r.value);text('p',`ต่ำสุด ${num(Math.min(...values))} · สูงสุด ${num(Math.max(...values))} ${units[selected.feed]}`,el('historyStats'));}
  }catch(e){if(seq!==historyRequest)return;history=[];el('historyStatus').textContent='อ่านประวัติไม่ได้: '+e.message;el('historyChart').replaceChildren();el('historyStats').replaceChildren();}}
const weatherNames={kmitl:'KMITL / ลาดกระบัง',pathum:'ปทุมธานี',ayutthaya:'อยุธยา',chachoengsao:'ฉะเชิงเทรา',bangkok:'กรุงเทพฯ ชั้นใน',
  'KMITL':'KMITL / ลาดกระบัง','KMITL / Lat Krabang':'KMITL / ลาดกระบัง','Pathum Thani':'ปทุมธานี','Ayutthaya':'อยุธยา','Chachoengsao':'ฉะเชิงเทรา','Central Bangkok':'กรุงเทพฯ ชั้นใน'};
const weatherName=p=>weatherNames[p.id]??weatherNames[p.name]??p.name??'จุดพยากรณ์';
const weatherMetric=(v,unit,digits=1)=>Number.isFinite(v)?num(v,digits)+unit:'ไม่มีข้อมูล';
function windDescription(r){
  if(!Number.isFinite(r?.wind_speed_kmh))return 'ไม่มีข้อมูลความเร็วลม';
  if(r.wind_speed_kmh===0)return 'ลมสงบ';
  const to=Number.isFinite(r.wind_to_deg)?r.wind_to_deg:Number.isFinite(r.wind_from_deg)?r.wind_from_deg+180:null;
  if(to===null)return 'ลม '+num(r.wind_speed_kmh,1)+' กม./ชม. (ไม่มีข้อมูลทิศ)';
  const directions=['เหนือ','ตะวันออกเฉียงเหนือ','ตะวันออก','ตะวันออกเฉียงใต้','ใต้','ตะวันตกเฉียงใต้','ตะวันตก','ตะวันตกเฉียงเหนือ'];
  return 'พัดไปทาง'+directions[Math.round(((to%360+360)%360)/45)%8]+' · '+num(r.wind_speed_kmh,1)+' กม./ชม.';
}
function rainDescription(r){
  if(!Number.isFinite(r?.precipitation_mm))return 'ไม่มีข้อมูลฝนในชั่วโมงนี้';
  return r.precipitation_mm===0?'ไม่คาดว่ามีฝนในชั่วโมงนี้':'คาดว่ามีฝน '+num(r.precipitation_mm,2)+' มม. ในชั่วโมงนี้';
}
let weatherMap=null,weatherLayer=null,weatherExtent=null;
function clearWeather(){
  if(weatherLayer)weatherLayer.clearLayers();
  if(weatherMap)weatherMap.closePopup();
  el('weatherCards').replaceChildren();
  el('weatherSummary').textContent='ยังไม่มีข้อมูลพยากรณ์ให้แสดง';
  el('weatherMapStatus').textContent='';
}
function renderWeatherMap(points){
  const target=el('windMap'),note=el('weatherMapStatus');
  if(typeof L==='undefined'){
    target.replaceChildren();text('p','โหลดแผนที่ไม่ได้ อ่านฝนและลมจากการ์ดด้านล่างได้ หรือโหลดหน้าใหม่เมื่อเชื่อมต่ออินเทอร์เน็ต',target);return;
  }
  if(!weatherMap){
    target.replaceChildren();weatherMap=L.map(target,{scrollWheelZoom:false}).setView([13.9,100.7],9);
    const tiles=L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,
      attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'}).addTo(weatherMap);
    tiles.on('tileerror',()=>{note.textContent='โหลดภาพแผนที่บางส่วนไม่ได้ ยังอ่านค่าจากการ์ดแต่ละพื้นที่ได้';});
    weatherLayer=L.layerGroup().addTo(weatherMap);
  }
  weatherLayer.clearLayers();weatherMap.closePopup();
  const usable=points.filter(p=>Number.isFinite(p.latitude)&&Number.isFinite(p.longitude)&&Math.abs(p.latitude)<=90&&Math.abs(p.longitude)<=180);
  for(const p of usable){
    const r=p.weather,label=document.createElement('div');
    text('strong',weatherName(p),label);
    text('div',Number.isFinite(r?.precipitation_mm)?'ฝน '+num(r.precipitation_mm,2)+' มม.':'ไม่มีข้อมูลฝน',label);
    const content=document.createElement('div');
    text('strong',weatherName(p),content);text('p',rainDescription(r),content);text('p',windDescription(r),content);
    text('p','เวลาพยากรณ์ '+fmt(el('weatherHour').value),content);
    text('p','โอกาสฝน '+weatherMetric(r?.probability_pct,'%',0)+' · ลมกระโชก '+weatherMetric(r?.wind_gusts_kmh,' กม./ชม.'),content);
    const color=!Number.isFinite(r?.precipitation_mm)?'#748594':r.precipitation_mm>0?'#2563eb':'#087f8c';
    const marker=L.circleMarker([p.latitude,p.longitude],{radius:10,weight:2,color:'#fff',fillColor:color,fillOpacity:1})
      .addTo(weatherLayer).bindTooltip(label,{permanent:true,direction:'top',offset:[0,-10],className:'weather-label'}).bindPopup(content);
    const card=el('weatherCards').children[points.indexOf(p)];
    if(card){card.firstChild.disabled=false;card.firstChild.onclick=()=>{weatherMap.panTo([p.latitude,p.longitude]);marker.openPopup();};}
  }
  const extent=JSON.stringify(usable.map(p=>[p.latitude,p.longitude]));
  if(usable.length&&extent!==weatherExtent){weatherMap.fitBounds(usable.map(p=>[p.latitude,p.longitude]),{padding:[70,70],maxZoom:11});weatherExtent=extent;}
  weatherMap.invalidateSize();
}
function renderWeather(){
  const f=snapshot?.feeds.forecast;el('weatherStatus').textContent=status(f);clearWeather();
  // Ignore cached rows if a feed explicitly failed; never present them as current.
  const usable=f&&['ok','empty'].includes(f.status),points=usable?(f.locations??[]):[];
  const times=[...new Set([...(usable?f.rows??[]:[]),...points.flatMap(p=>p.rows??[])].map(r=>r.timestamp))].sort((a,b)=>Date.parse(a)-Date.parse(b));
  const old=el('weatherHour').value;el('weatherHour').replaceChildren();
  times.forEach(t=>{const o=text('option',fmt(t),el('weatherHour'));o.value=t;});if(times.includes(old))el('weatherHour').value=old;
  const chosen=el('weatherHour').value;el('weatherRows').replaceChildren();
  const mapped=points.map(p=>({...p,weather:(p.rows??[]).find(r=>r.timestamp===chosen)}));
  if(chosen){
    el('weatherSummary').textContent=(f.cache_stale?'ข้อมูลพยากรณ์เก่า — ':'พยากรณ์สำหรับ ')+fmt(chosen)+' · อ่านฝนและทิศที่ลมพัดไปจากแต่ละพื้นที่ด้านล่าง';
  }else el('weatherSummary').textContent='ยังไม่มีข้อมูลพยากรณ์ในช่วงนี้';
  mapped.forEach(p=>{
    const r=p.weather,card=text('article','',el('weatherCards'),'weather-card');
    text('button',weatherName(p),card,'weather-place').disabled=true;
    text('div',Number.isFinite(r?.precipitation_mm)?num(r.precipitation_mm,2)+' มม.':'ไม่มีข้อมูลฝน',card,'weather-rain');
    text('p',rainDescription(r),card);text('p','โอกาสฝน '+weatherMetric(r?.probability_pct,'%',0),card);
    text('p',windDescription(r),card,'weather-wind');
    text('small','ลมกระโชก '+weatherMetric(r?.wind_gusts_kmh,' กม./ชม.'),card);
    tableRow(el('weatherRows'),[weatherName(p),num(r?.precipitation_mm,2),num(r?.probability_pct,0),num(r?.wind_speed_kmh,1),num(r?.wind_gusts_kmh,1),windDescription(r)]);
  });
  renderWeatherMap(mapped);seriesChart(el('forecastChart'),usable?f.rows??[]:[],'precipitation_mm',true);
}
async function refresh(){
  if(busy)return;busy=true;el('refresh').disabled=true;el('updated').textContent='กำลังอ่านข้อมูลที่เก็บล่าสุด…';
  try{const res=await fetch('/api/live?scope=regional');if(!res.ok)throw Error('HTTP '+res.status);snapshot=await res.json();render();el('updated').textContent='อ่านเมื่อ '+fmt(new Date());
    if(selected)await loadHistory();
  }catch(e){snapshot=null;for(const id of ['waterCount','flowCount','forecastTotal','archiveCount'])el(id).textContent='—';el('updated').textContent='โหลดไม่ได้: '+e.message;el('stations').replaceChildren();clearStationMap();el('weatherRows').replaceChildren();clearWeather();el('weatherHour').replaceChildren();el('forecastChart').replaceChildren();el('feedStatus').textContent='ข้อมูลไม่พร้อมใช้งาน';el('collector').textContent='ติดต่อเซิร์ฟเวอร์ไม่ได้';}
  finally{busy=false;el('refresh').disabled=false;}}
el('feedTabs').querySelectorAll('button').forEach(button=>button.onclick=()=>{feed=button.dataset.feed;el('feedTabs').querySelectorAll('button').forEach(b=>b.classList.toggle('active',b===button));if(snapshot)renderStations();});
['scope','fresh'].forEach(id=>el(id).onchange=render);el('search').oninput=render;el('hours').onchange=loadHistory;el('weatherHour').onchange=renderWeather;el('refresh').onclick=refresh;
el('stormToggle').onclick=()=>{const open=el('stormPanel').classList.toggle('hidden')===false;if(open&&!el('stormFrame').getAttribute('src'))el('stormFrame').src='https://www.tmd.go.th/StromTrack';el('stormToggle').textContent=open?'ปิดภาพเส้นทางพายุ':'เปิดภาพเส้นทางพายุจาก TMD';};
el('export').onclick=()=>{if(!selected||!history.length)return;const fields=['timestamp','station_id','name','value','unit','source'];
  const quote=v=>'"'+String(v??'').replace(/^[=+@-]/,"'$&").replaceAll('"','""')+'"';
  const blob=new Blob(['\ufeff'+[fields.join(','),...history.map(r=>fields.map(k=>quote(r[k])).join(','))].join('\r\n')],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`floodlens-${selected.feed}-history.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
refresh();setInterval(refresh,30000);
