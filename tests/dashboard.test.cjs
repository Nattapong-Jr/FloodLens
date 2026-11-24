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
function mount(snapshot) {
  const html=fs.readFileSync('web/index.html','utf8'), nodes={};
  for(const match of html.matchAll(/<(\w+)[^>]*\bid="([^"]+)"/g))nodes[match[2]]=new Element(match[1]);
  nodes.scope.value='local';nodes.hours.value='48';
  for(const key of ['water','flow','rain']){const b=new Element('button');b.dataset={feed:key};nodes.feedTabs.append(b);}
  let historyCalls=0, fail=false;
  const ctx=vm.createContext({document:{getElementById:id=>{assert.ok(nodes[id],id);return nodes[id];},createElement:tag=>new Element(tag),createElementNS:(_,tag)=>new Element(tag)},
    fetch:async url=>{if(fail)throw Error('offline');if(url.startsWith('/api/history')){historyCalls++;return {ok:true,json:async()=>({rows:snapshot.feeds.water.rows})};}return {ok:true,json:async()=>snapshot};},
    setInterval:()=>0,setTimeout:()=>0,URL,URLSearchParams,Blob,console});
  vm.runInContext(fs.readFileSync('web/dashboard.js','utf8'),ctx);
  return {nodes,ctx,historyCalls:()=>historyCalls,setFail:()=>fail=true};
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(){const stamp=new Date(Date.now()+3600000).toISOString();const station={station_id:'3',name:'Canal',latitude:13.74,longitude:100.79,distance_km:2,value:-.2,timestamp:new Date().toISOString(),source:'ThaiWater',unit:'m MSL',stale:false};
  const weather={timestamp:stamp,precipitation_mm:0,probability_pct:0,wind_speed_kmh:10,wind_from_deg:0,wind_to_deg:180,wind_gusts_kmh:20};
  return {feeds:{water:{status:'ok',rows:[station,{...station,station_id:'4',distance_km:50}],fetched_at:stamp},flow:{status:'ok',rows:[{...station,value:-3.09}],fetched_at:stamp},rain:{status:'ok',rows:[{...station,value:0}],fetched_at:stamp},forecast:{status:'ok',rows:[weather],locations:[{name:'KMITL',latitude:13.73,longitude:100.78,rows:[weather]}],fetched_at:stamp}},system:{observation_count:3,poll_seconds:300,collector_running:true}};
}
test('local/regional filters and signed flow display',async()=>{const m=mount(fixture());await tick();assert.equal(m.nodes.waterCount.textContent,1);m.nodes.scope.value='regional';m.nodes.scope.onchange();assert.equal(m.nodes.waterCount.textContent,2);m.nodes.feedTabs.children[1].click();assert.equal(m.nodes.stations.firstChild.children[3].textContent,'-3.09');});
test('station selection requests observation history',async()=>{const m=mount(fixture());await tick();m.nodes.stations.firstChild.firstChild.firstChild.click();await tick();assert.equal(m.historyCalls(),1);assert.equal(m.nodes.export.disabled,false);assert.match(m.nodes.detailTitle.textContent,/Canal/);});
test('failed refresh clears previously displayed current values',async()=>{const m=mount(fixture());await tick();m.setFail();await m.nodes.refresh.onclick();assert.equal(m.nodes.waterCount.textContent,'—');assert.equal(m.nodes.stations.children.length,0);assert.match(m.nodes.updated.textContent,/offline/);});
test('search empty result has no map markers',async()=>{const m=mount(fixture());await tick();m.nodes.search.value='unknown-canal';m.nodes.search.oninput();assert.equal(m.nodes.stations.children.length,0);assert.equal(m.nodes.waterCount.textContent,0);});
