'use strict';
const $ = id => document.getElementById(id);
let coordinates = null, previewURL = null;
function clearCoordinates(){coordinates=null;$('clearLocation').hidden=true;$('geoStatus').textContent='ไม่ได้แนบพิกัด';}
$('clearLocation').onclick=clearCoordinates;
$('photo').onchange=()=>{
  if(previewURL)URL.revokeObjectURL(previewURL);
  const file=$('photo').files[0];$('preview').hidden=true;
  if(!file)return;
  if(!['image/jpeg','image/png'].includes(file.type)||file.size>3*1024*1024){$('photo').value='';$('status').textContent='กรุณาเลือกรูป JPEG / PNG ไม่เกิน 3 MB';return;}
  previewURL=URL.createObjectURL(file);$('preview').src=previewURL;$('preview').hidden=false;$('status').textContent='';
};
let geoRequest=0;
$('locate').onclick=()=>{
  if(!navigator.geolocation){$('geoStatus').textContent='อุปกรณ์ไม่รองรับพิกัด กรุณากรอกสถานที่';return;}
  const request=++geoRequest;$('locate').disabled=true;$('geoStatus').textContent='กำลังขอพิกัด…';
  navigator.geolocation.getCurrentPosition(pos=>{
    if(request!==geoRequest)return;
    coordinates={latitude:pos.coords.latitude,longitude:pos.coords.longitude};
    $('geoStatus').textContent=`แนบพิกัด ${coordinates.latitude.toFixed(5)}, ${coordinates.longitude.toFixed(5)} (คลาดเคลื่อนประมาณ ${Math.round(pos.coords.accuracy)} เมตร)`;
    $('clearLocation').hidden=false;$('locate').disabled=false;
  },()=>{if(request!==geoRequest)return;clearCoordinates();$('locate').disabled=false;$('geoStatus').textContent='เข้าถึงพิกัดไม่ได้ กรุณากรอกสถานที่ด้วยข้อความ';},{enableHighAccuracy:true,timeout:15000,maximumAge:0});
};
function add(parent,tag,value){const node=document.createElement(tag);node.textContent=value;parent.append(node);return node;}
const kinds={situation:'แจ้งสถานการณ์',help:'ขอความช่วยเหลือ'}, levels={low:'ทั่วไป',medium:'ควรตรวจสอบ',high:'เร่งด่วน'};
async function loadReports(){
  $('refresh').disabled=true;$('listStatus').textContent='กำลังโหลด…';
  try{
    const response=await fetch('/api/reports');if(!response.ok)throw Error('โหลดรายการไม่สำเร็จ');
    const data=await response.json();$('reports').replaceChildren();
    for(const report of data.reports){
      const card=document.createElement('article');
      const badge=add(card,'span',`${kinds[report.kind]} · ${levels[report.severity]}`);badge.className='badge '+(report.severity==='high'?'high':'');
      add(card,'h3',report.location);
      const img=document.createElement('img');img.src=report.photo_url;img.alt='ภาพสถานการณ์จากผู้แจ้ง';img.loading='lazy';img.className='report-photo';card.append(img);
      add(card,'p',report.description);add(card,'p',`${new Date(report.created_at).toLocaleString('th-TH')} · ยังไม่ยืนยัน`);
      add(card,'p',`เลขอ้างอิง: ${report.id}`);
      if(report.latitude!==null&&report.longitude!==null){const link=add(card,'a','เปิดพิกัดในแผนที่');link.href=`https://www.openstreetmap.org/?mlat=${report.latitude}&mlon=${report.longitude}#map=17/${report.latitude}/${report.longitude}`;link.target='_blank';link.rel='noopener noreferrer';}
      $('reports').append(card);
    }
    $('listStatus').textContent=data.reports.length?`แสดง ${data.reports.length} รายการ`:'ยังไม่มีรายงานในระบบ';
  }catch(error){$('listStatus').textContent='โหลดรายการไม่สำเร็จ กรุณาลองอีกครั้ง';}
  finally{$('refresh').disabled=false;}
}
$('refresh').onclick=loadReports;
$('reportForm').onsubmit=async event=>{
  event.preventDefault();if(!$('reportForm').reportValidity())return;
  const file=$('photo').files[0];if(!file||file.size>3*1024*1024)return;
  $('submit').disabled=true;$('status').textContent='กำลังบันทึก… กรุณารอสักครู่';
  try{
    const photo=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(',')[1]);reader.onerror=()=>reject(Error('อ่านรูปไม่สำเร็จ'));reader.readAsDataURL(file);});
    const response=await fetch('/api/reports',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({kind:'situation',severity:$('severity').value,location:$('location').value,reporter:$('reporter').value,description:$('description').value,photo,...(coordinates||{})})});
    const data=await response.json();if(!response.ok)throw Error(data.error||'บันทึกไม่สำเร็จ');
    $('status').textContent=`บันทึกแล้ว เลขอ้างอิง: ${data.id}\nยังไม่ได้ส่งต่อหน่วยกู้ภัย`;
    $('reportForm').reset();geoRequest++;$('locate').disabled=false;clearCoordinates();$('preview').hidden=true;
    if(previewURL){URL.revokeObjectURL(previewURL);previewURL=null;}
    await loadReports();
  }catch(error){$('status').textContent=`${error.message} — ข้อมูลในแบบฟอร์มยังอยู่ หากการเชื่อมต่อขาด ให้ตรวจรายการล่าสุดก่อนส่งซ้ำ`;}
  finally{$('submit').disabled=false;}
};
loadReports();
