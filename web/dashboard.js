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
function plotMap(target,points,wind=false) {
  target.replaceChildren();
  const usable=points.filter(p=>Number.isFinite(p.latitude)&&Number.isFinite(p.longitude));
  if(!usable.length){text('p','ยังไม่มีข้อมูลพิกัดที่ใช้ได้',target);return;}
  const all=[...usable,{latitude:13.73,longitude:100.78}];
  let loX=Math.min(...all.map(p=>p.longitude))-.025,hiX=Math.max(...all.map(p=>p.longitude))+.025;
  let loY=Math.min(...all.map(p=>p.latitude))-.025,hiY=Math.max(...all.map(p=>p.latitude))+.025;
  const w=800,h=wind?340:390,L=58,R=30,T=30,B=40;
  // Equal approximate kilometre scale for latitude and longitude near Bangkok.
  const cos=Math.cos(13.73*Math.PI/180), span=Math.max((hiX-loX)*cos/(w-L-R),(hiY-loY)/(h-T-B));
  const midX=(loX+hiX)/2,midY=(loY+hiY)/2;
  loX=midX-span*(w-L-R)/cos/2;hiX=midX+span*(w-L-R)/cos/2;
  loY=midY-span*(h-T-B)/2;hiY=midY+span*(h-T-B)/2;
  const x=v=>L+(v-loX)/(hiX-loX)*(w-L-R),y=v=>T+(hiY-v)/(hiY-loY)*(h-T-B);
  const svg=svgNode('svg',{viewBox:`0 0 ${w} ${h}`,role:'img','aria-label':wind?'ทิศลมพยากรณ์หลายพื้นที่':'ตำแหน่งสถานีตามละติจูดและลองจิจูด'},target);
  svgNode('rect',{x:L,y:T,width:w-L-R,height:h-T-B,fill:'#0a1b29',stroke:'#294256'},svg);
  for(let i=0;i<=4;i++){const xx=L+(w-L-R)*i/4,yy=T+(h-T-B)*i/4;
    svgNode('line',{x1:xx,x2:xx,y1:T,y2:h-B,stroke:'#20384b'},svg);
    svgNode('line',{x1:L,x2:w-R,y1:yy,y2:yy,stroke:'#20384b'},svg);
    svgText(svg,xx,h-16,(loX+(hiX-loX)*i/4).toFixed(2)+'°E',{'text-anchor':'middle'});
    svgText(svg,2,yy+4,(hiY-(hiY-loY)*i/4).toFixed(2)+'°N');}
  svgText(svg,w-30,16,'N ↑',{'text-anchor':'end',fill:'#60e4e4'});
  for(const p of usable){const cx=x(p.longitude),cy=y(p.latitude);
    if(wind){
      const r=p.weather;
      if(r&&r.wind_to_deg!==null&&r.wind_speed_kmh!==null&&r.wind_speed_kmh>0){
        const rad=r.wind_to_deg*Math.PI/180,dx=Math.sin(rad)*25,dy=-Math.cos(rad)*25;
        svgNode('line',{x1:cx-dx/2,y1:cy-dy/2,x2:cx+dx,y2:cy+dy,stroke:'#60e4e4','stroke-width':3},svg);
        const ex=cx+dx,ey=cy+dy;svgNode('polygon',{points:`${ex},${ey} ${ex-Math.sin(rad-.5)*10},${ey+Math.cos(rad-.5)*10} ${ex-Math.sin(rad+.5)*10},${ey+Math.cos(rad+.5)*10}`,fill:'#60e4e4'},svg);
      }else svgNode('circle',{cx,cy,r:5,fill:r?.wind_speed_kmh===0?'#60e4e4':'#8095a7'},svg);
      svgText(svg,cx,cy+38,p.name,{'text-anchor':'middle',fill:'#dcebf7'});
    }else{
      const point=svgNode('circle',{cx,cy,r:6,fill:p.stale?'#6f8293':'#60e4e4',stroke:'#071420','stroke-width':2,
        tabindex:0,role:'button','aria-label':`${p.name}: ${p.value} ${units[feed]}`},svg);
      svgNode('title',{},point).textContent=`${p.name} · ${p.value} ${units[feed]} · ${fmt(p.timestamp)}`;
      point.addEventListener('click',()=>choose(p));point.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();choose(p);}});
    }
  }
  if(!wind){const cx=x(100.78),cy=y(13.73);svgNode('path',{d:`M ${cx} ${cy-9} L ${cx+9} ${cy} L ${cx} ${cy+9} L ${cx-9} ${cy} Z`,fill:'none',stroke:'#f5c56b','stroke-width':2},svg);svgText(svg,cx+12,cy-10,'KMITL',{fill:'#f5c56b'});}
}
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
async function choose(station){selected={...station,feed};el('detailTitle').textContent=station.name||station.station_id;
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
function renderWeather(){
  const f=snapshot?.feeds.forecast;el('weatherStatus').textContent=status(f);const points=f?.locations??[];
  const times=(f?.rows??[]).map(r=>r.timestamp),old=el('weatherHour').value;el('weatherHour').replaceChildren();times.forEach(t=>{const o=text('option',fmt(t),el('weatherHour'));o.value=t;});if(times.includes(old))el('weatherHour').value=old;
  const chosen=el('weatherHour').value;el('weatherRows').replaceChildren();const mapped=[];
  points.forEach(p=>{const r=p.rows.find(r=>r.timestamp===chosen);tableRow(el('weatherRows'),[p.name,num(r?.precipitation_mm,1),num(r?.probability_pct,0),num(r?.wind_speed_kmh,1),num(r?.wind_gusts_kmh,1),r?.wind_from_deg!=null?num(r.wind_from_deg,0)+'°':'—']);mapped.push({...p,weather:r});});
  plotMap(el('windMap'),mapped,true);seriesChart(el('forecastChart'),f?.rows??[],'precipitation_mm',true);
}
async function refresh(){
  if(busy)return;busy=true;el('refresh').disabled=true;el('updated').textContent='กำลังอ่านข้อมูลที่เก็บล่าสุด…';
  try{const res=await fetch('/api/live?scope=regional');if(!res.ok)throw Error('HTTP '+res.status);snapshot=await res.json();render();el('updated').textContent='อ่านเมื่อ '+fmt(new Date());
    if(selected)await loadHistory();
  }catch(e){snapshot=null;for(const id of ['waterCount','flowCount','forecastTotal','archiveCount'])el(id).textContent='—';el('updated').textContent='โหลดไม่ได้: '+e.message;el('stations').replaceChildren();el('geo').replaceChildren();el('weatherRows').replaceChildren();el('windMap').replaceChildren();el('forecastChart').replaceChildren();el('feedStatus').textContent='ข้อมูลไม่พร้อมใช้งาน';el('collector').textContent='ติดต่อเซิร์ฟเวอร์ไม่ได้';}
  finally{busy=false;el('refresh').disabled=false;}}
el('feedTabs').querySelectorAll('button').forEach(button=>button.onclick=()=>{feed=button.dataset.feed;el('feedTabs').querySelectorAll('button').forEach(b=>b.classList.toggle('active',b===button));if(snapshot)renderStations();});
['scope','fresh'].forEach(id=>el(id).onchange=render);el('search').oninput=render;el('hours').onchange=loadHistory;el('weatherHour').onchange=renderWeather;el('refresh').onclick=refresh;
el('stormToggle').onclick=()=>{const open=el('stormPanel').classList.toggle('hidden')===false;if(open&&!el('stormFrame').getAttribute('src'))el('stormFrame').src='https://www.tmd.go.th/StromTrack';el('stormToggle').textContent=open?'ปิดภาพเส้นทางพายุ':'เปิดภาพเส้นทางพายุจาก TMD';};
el('export').onclick=()=>{if(!selected||!history.length)return;const fields=['timestamp','station_id','name','value','unit','source'];
  const quote=v=>'"'+String(v??'').replace(/^[=+@-]/,"'$&").replaceAll('"','""')+'"';
  const blob=new Blob(['\ufeff'+[fields.join(','),...history.map(r=>fields.map(k=>quote(r[k])).join(','))].join('\r\n')],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`floodlens-${selected.feed}-history.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
refresh();setInterval(refresh,30000);
