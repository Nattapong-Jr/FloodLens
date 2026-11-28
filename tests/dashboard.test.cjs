// DOM contract tests with a minimal fake DOM, not a browser rendering test.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
class Element {
  constructor(tag='div'){this.tag=tag;this.children=[];this.attributes={};this._value='';this.textContent='';this.checked=false;this.disabled=false;this.classes=new Set();this.classList={add:c=>this.classes.add(c),remove:c=>this.classes.delete(c),toggle:(c,v)=>{const next=v??!this.classes.has(c);if(next)this.classes.add(c);else this.classes.delete(c);return next;}};}
  set value(v){this._value=v;}
  get value(){return this._value || (this.tag==='select'?this.children[0]?.value:'') || '';}
  append(n){this.children.push(n);}
  replaceChildren(){this.children=[];this._value='';}
  get firstChild(){return this.children[0];}
  setAttribute(k,v){this.attributes[k]=v;}
  getAttribute(k){return this.attributes[k]??null;}
  querySelectorAll(){return this.children;}
  addEventListener(k,fn){this['on'+k]=fn;}
  click(){this.onclick?.();}
}
function leafletFake(){
  const maps=[],layers=[],markers=[],tiles=[];
  const L={
    map:()=>{const m={fits:0,setView(){return this;},fitBounds(){this.fits++;return this;},invalidateSize(){},closePopup(){},panTo(){}};maps.push(m);return m;},
    tileLayer:()=>{const t={addTo(){return this;},on(k,fn){this[k]=fn;return this;}};tiles.push(t);return t;},
    layerGroup:()=>{const g={items:[],addTo(){return this;},clearLayers(){this.items=[];}};layers.push(g);return g;},
    circleMarker:(position,options)=>{const m={position,options,events:{},addTo(g){if(g.items)g.items.push(this);return this;},bindTooltip(p){this.tooltip=p;return this;},bindPopup(p){this.popup=p;return this;},on(k,fn){this.events[k]=fn;return this;},openPopup(){this.opened=true;return this;}};markers.push(m);return m;}
  };return {L,maps,layers,markers,tiles};
}
function mount(snapshot, withMap=false) {
  const html=fs.readFileSync('web/index.html','utf8'), nodes={};
  for(const match of html.matchAll(/<(\w+)[^>]*\bid="([^"]+)"/g))nodes[match[2]]=new Element(match[1]);
  nodes.scope.value='local';nodes.hours.value='48';
  for(const key of ['water','flow','rain']){const b=new Element('button');b.dataset={feed:key};nodes.feedTabs.append(b);}
  let historyCalls=0, fail=false;const leaflet=leafletFake();
  const ctx=vm.createContext({...(withMap?{L:leaflet.L}:{}),document:{getElementById:id=>{assert.ok(nodes[id],id);return nodes[id];},createElement:tag=>new Element(tag),createElementNS:(_,tag)=>new Element(tag)},
    fetch:async url=>{if(fail)throw Error('offline');if(url.startsWith('/api/history')){historyCalls++;return {ok:true,json:async()=>({rows:snapshot.feeds.water.rows})};}return {ok:true,json:async()=>snapshot};},
    setInterval:()=>0,setTimeout:()=>0,URL,URLSearchParams,Blob,console});
  vm.runInContext(fs.readFileSync('web/dashboard.js','utf8'),ctx);
  return {nodes,ctx,leaflet,historyCalls:()=>historyCalls,setFail:()=>fail=true};
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(){const stamp=new Date(Date.now()+3600000).toISOString();const station={station_id:'3',name:'Canal',latitude:13.74,longitude:100.79,distance_km:2,value:-.2,timestamp:new Date().toISOString(),source:'ThaiWater',unit:'m MSL',stale:false};
  const weather={timestamp:stamp,precipitation_mm:0,probability_pct:0,wind_speed_kmh:10,wind_from_deg:0,wind_to_deg:180,wind_gusts_kmh:20};
  return {feeds:{water:{status:'ok',rows:[station,{...station,station_id:'4',distance_km:50}],fetched_at:stamp},flow:{status:'ok',rows:[{...station,value:-3.09}],fetched_at:stamp},rain:{status:'ok',rows:[{...station,value:0}],fetched_at:stamp},forecast:{status:'ok',rows:[weather],locations:[{name:'KMITL',latitude:13.73,longitude:100.78,rows:[weather]}],fetched_at:stamp}},system:{observation_count:3,poll_seconds:300,collector_running:true}};
}
test('local/regional filters and signed flow display',async()=>{const m=mount(fixture());await tick();assert.equal(m.nodes.waterCount.textContent,1);m.nodes.scope.value='regional';m.nodes.scope.onchange();assert.equal(m.nodes.waterCount.textContent,2);m.nodes.feedTabs.children[1].click();assert.equal(m.nodes.stations.firstChild.children[3].textContent,'-3.09');});
test('station selection requests observation history',async()=>{const m=mount(fixture());await tick();m.nodes.stations.firstChild.firstChild.firstChild.click();await tick();assert.equal(m.historyCalls(),1);assert.equal(m.nodes.export.disabled,false);assert.match(m.nodes.detailTitle.textContent,/Canal/);});
test('failed refresh retains the measurement and identifies the last successful retrieval',async()=>{
  const m=mount(fixture());await tick();
  const measured=m.nodes.stations.firstChild.children[5].textContent;
  const retrieved=m.nodes.feedStatus.textContent.replace('ดึงเมื่อ ','');
  m.setFail();await m.nodes.refresh.onclick();
  assert.equal(m.nodes.stations.firstChild.children[5].textContent,measured);
  assert.match(m.nodes.stations.firstChild.children[6].textContent,/ข้อมูลเก่า/);
  assert.equal(m.nodes.feedStatus.textContent,'Unable to update station data · Last successful retrieval: '+retrieved);
  m.nodes.search.value='absent';m.nodes.search.oninput();
  assert.match(m.nodes.feedStatus.textContent,/Unable to update station data/);
});
test('source failure without cached rows does not look like an empty filter',async()=>{
  const data=fixture();data.feeds.water={status:'error',rows:[],fetched_at:null};
  const m=mount(data,true);await tick();
  assert.match(m.nodes.updated.textContent,/Unable to update station data/);
  assert.match(m.nodes.mapStatus.textContent,/Last successful retrieval: unavailable/);
  assert.equal(m.nodes.stations.children.length,0);
});
test('search with successful station data reports an empty filter',async()=>{const m=mount(fixture());await tick();m.nodes.search.value='unknown-canal';m.nodes.search.oninput();assert.equal(m.nodes.stations.children.length,0);assert.equal(m.nodes.waterCount.textContent,0);assert.equal(m.nodes.feedStatus.textContent,'No stations found matching the filters');});


test('street map markers follow filters and preserve zoom during polling',async()=>{
  const m=mount(fixture(),true);await tick();
  assert.equal(m.leaflet.maps.length,2);assert.equal(m.leaflet.layers[0].items.length,1);
  const fits=m.leaflet.maps[0].fits;await m.nodes.refresh.onclick();
  assert.equal(m.leaflet.maps.length,2);assert.equal(m.leaflet.maps[0].fits,fits);
  m.nodes.scope.value='regional';m.nodes.scope.onchange();assert.equal(m.leaflet.layers[0].items.length,2);
  m.nodes.search.value='absent';m.nodes.search.oninput();assert.equal(m.leaflet.layers[0].items.length,0);
});
test('map marker opens history and failed network retains stale markers',async()=>{
  const m=mount(fixture(),true);await tick();
  m.leaflet.layers[0].items[0].events.click();await tick();
  assert.equal(m.historyCalls(),1);assert.equal(m.nodes.export.disabled,false);
  m.setFail();await m.nodes.refresh.onclick();assert.equal(m.leaflet.layers[0].items.length,1);
  assert.equal(m.leaflet.layers[0].items[0].options.fillColor,'#748594');
});
test('map errors leave the station table usable',async()=>{
  const m=mount(fixture(),true);await tick();m.leaflet.tiles[0].tileerror();
  assert.ok(m.nodes.mapStatus.textContent);assert.equal(m.nodes.stations.children.length,1);
  const offline=mount(fixture());await tick();assert.equal(offline.nodes.geo.firstChild.tag,'p');
  offline.nodes.stations.firstChild.firstChild.firstChild.click();await tick();assert.equal(offline.historyCalls(),1);
});
test('stale markers stay distinct and untrusted names remain text',async()=>{
  const data=fixture();data.feeds.water.rows[0].stale=true;data.feeds.water.rows[0].name='<img src=x onerror=alert(1)>';
  const m=mount(data,true);await tick();const marker=m.leaflet.layers[0].items[0];
  assert.equal(marker.options.fillColor,'#748594');assert.equal(marker.popup.firstChild.textContent,data.feeds.water.rows[0].name);
});

function contents(node){return [node.textContent,...node.children.map(contents)].join(' ');}
test('weather cards use Thai names, hourly rain and the selected hour',async()=>{
  const data=fixture(),first=data.feeds.forecast.rows[0];
  const next={...first,timestamp:new Date(Date.parse(first.timestamp)+3600000).toISOString(),precipitation_mm:2.5,wind_to_deg:270};
  data.feeds.forecast.rows.push(next);data.feeds.forecast.locations[0].rows.push(next);
  const m=mount(data,true);await tick();
  assert.match(contents(m.nodes.weatherCards),/ลาดกระบัง/);
  assert.match(contents(m.nodes.weatherCards),/0\.00 มม\./);
  assert.match(contents(m.nodes.weatherCards),/พัดไปทางใต้/);
  const fits=m.leaflet.maps[1].fits;
  m.nodes.weatherHour.value=next.timestamp;m.nodes.weatherHour.onchange();
  assert.match(contents(m.nodes.weatherCards),/2\.50 มม\./);
  assert.match(contents(m.nodes.weatherCards),/พัดไปทางตะวันตก/);
  assert.match(contents(m.leaflet.layers[1].items[0].tooltip),/2\.50/);
  assert.equal(m.leaflet.maps[1].fits,fits);
  assert.equal(m.leaflet.layers[1].items[0].options.fillColor,'#2563eb');
});
test('weather distinguishes missing, calm and unknown direction',async()=>{
  const data=fixture();Object.assign(data.feeds.forecast.rows[0],{precipitation_mm:null,probability_pct:null,wind_speed_kmh:0,wind_to_deg:null,wind_from_deg:null});
  const m=mount(data,true);await tick();
  assert.match(contents(m.nodes.weatherCards),/ไม่มีข้อมูลฝน/);
  assert.match(contents(m.nodes.weatherCards),/ลมสงบ/);
  assert.match(contents(m.nodes.weatherCards),/โอกาสฝน ไม่มีข้อมูล/);
  assert.equal(m.leaflet.layers[1].items[0].options.fillColor,'#748594');
  assert.match(vm.runInContext('windDescription({wind_speed_kmh:10})',m.ctx),/ไม่มีข้อมูลทิศ/);
  assert.match(vm.runInContext('windDescription({wind_speed_kmh:null,wind_to_deg:0})',m.ctx),/ไม่มีข้อมูลความเร็ว/);
  assert.match(vm.runInContext('windDescription({wind_speed_kmh:10,wind_from_deg:0})',m.ctx),/พัดไปทางใต้/);
  assert.match(vm.runInContext('windDescription({wind_speed_kmh:10,wind_to_deg:360})',m.ctx),/พัดไปทางเหนือ/);
});
test('weather missing selected-hour row never becomes zero rainfall',async()=>{
  const data=fixture();data.feeds.forecast.locations[0].rows=[];
  const m=mount(data,true);await tick();
  assert.match(contents(m.nodes.weatherCards),/ไม่มีข้อมูลฝน/);
  assert.doesNotMatch(contents(m.nodes.weatherCards),/0\.00 มม/);
});
test('weather errors clear cards and overlays and remain recoverable',async()=>{
  const m=mount(fixture(),true);await tick();m.leaflet.tiles[1].tileerror();
  assert.match(m.nodes.weatherMapStatus.textContent,/โหลดภาพแผนที่/);
  assert.equal(m.nodes.weatherCards.children.length,1);
  m.setFail();await m.nodes.refresh.onclick();
  assert.equal(m.leaflet.layers[1].items.length,0);assert.equal(m.nodes.weatherCards.children.length,0);
  assert.equal(m.nodes.weatherHour.children.length,0);
  const failed=fixture();failed.feeds.forecast.status='error';
  const unavailable=mount(failed,true);await tick();assert.equal(unavailable.nodes.weatherCards.children.length,0);
});
test('weather cards work without a map library and show stale status',async()=>{
  const data=fixture();data.feeds.forecast.cache_stale=true;
  const m=mount(data);await tick();
  assert.match(m.nodes.weatherSummary.textContent,/ข้อมูลพยากรณ์เก่า/);
  assert.match(contents(m.nodes.windMap),/โหลดแผนที่ไม่ได้/);
  assert.equal(m.nodes.weatherCards.children.length,1);
});
test('weather popup labels treat unknown location names as text',async()=>{
  const data=fixture();data.feeds.forecast.locations[0].name='<script>bad()</script>';
  const m=mount(data,true);await tick();
  assert.equal(m.leaflet.layers[1].items[0].popup.firstChild.textContent,'<script>bad()</script>');
});
