// Isolated Android database/UI qualification; no private corpus or model weights.
import {execFileSync, spawn} from 'node:child_process';
import {mkdirSync, readFileSync, writeFileSync, appendFileSync} from 'node:fs';
import {setTimeout as delay} from 'node:timers/promises';
import {createHash} from 'node:crypto';
const pkg = 'dev.localmed.search';
const out = process.argv[2] || '/tmp/pr164-device';
mkdirSync(out,{recursive:true});
const adb = (...args) => execFileSync('adb',args,{encoding:'utf8',timeout:20000,maxBuffer:8*1024*1024});
const save = (name,data) => writeFileSync(`${out}/${name}`,typeof data==='string'?data:JSON.stringify(data,null,2));
const report = JSON.parse(readFileSync('apps/app/public/content/core-report.json','utf8'));
const corePath = 'apps/app/public/content/core.db';
const checksum = createHash('sha256').update(readFileSync(corePath)).digest('hex');
if (`sha256:${checksum}` !== report.outputChecksum) throw new Error('Core checksum mismatch in test input');
const result = {sourceCommit:process.env.SOURCE_SHA,variant:'database/UI APK; ARM-only optional inference JNI packaging excluded; NOT production-APK or inference qualification',coreSha256:checksum,coreBytes:readFileSync(corePath).length,runs:[]};
save('environment.txt',adb('shell','getprop')+'\n'+adb('shell','dumpsys','webviewupdate'));
adb('install','-r','apps/app/android/app/build/outputs/apk/debug/app-debug.apk');
adb('shell','am','force-stop',pkg);
adb('shell','run-as',pkg,'mkdir','-p','files/localmed/content');
adb('push',corePath,'/data/local/tmp/pr164-core.db');
adb('shell','run-as',pkg,'cp','/data/local/tmp/pr164-core.db','files/localmed/content/core.db');
adb('shell',`run-as ${pkg} sh -c 'echo ${checksum} > files/localmed/content/core.db.sha256'`);
adb('shell','rm','/data/local/tmp/pr164-core.db');
// The installed pack is enough: prevent optional network/model downloads in the guest.
adb('shell','svc','wifi','disable');
adb('shell','svc','data','disable');
class CDP {
  constructor(ws){this.ws=ws;this.id=0;this.pending=new Map();ws.addEventListener('message',event=>{const msg=JSON.parse(event.data);const slot=this.pending.get(msg.id);if(!slot)return;this.pending.delete(msg.id);clearTimeout(slot.timer);msg.error?slot.reject(new Error(JSON.stringify(msg.error))):slot.resolve(msg.result);});}
  call(method,params={}){return new Promise((resolve,reject)=>{const id=++this.id;const timer=setTimeout(()=>{this.pending.delete(id);reject(new Error(`CDP timeout: ${method}`));},10000);this.pending.set(id,{resolve,reject,timer});this.ws.send(JSON.stringify({id,method,params}));});}
  async eval(expression){const v=await this.call('Runtime.evaluate',{expression,returnByValue:true});if(v.exceptionDetails)throw new Error(JSON.stringify(v.exceptionDetails));return v.result.value;}
  close(){for(const v of this.pending.values()){clearTimeout(v.timer);v.reject(new Error('CDP closed'));}this.pending.clear();this.ws.close();}
}
async function connect(){
 for(let n=0;n<60;n++){
  try{
   const sockets=adb('shell','cat','/proc/net/unix');
   const match=sockets.match(/@([^\s]*webview_devtools_remote_\d+)/);
   if(match){
    adb('forward','tcp:9222',`localabstract:${match[1]}`);
    const pages=await (await fetch('http://127.0.0.1:9222/json/list',{signal:AbortSignal.timeout(2000)})).json();
    const page=pages.find(v=>v.type==='page'&&v.webSocketDebuggerUrl);
    if(page){const ws=new WebSocket(page.webSocketDebuggerUrl);await new Promise((ok,no)=>{const t=setTimeout(()=>no(new Error('WebSocket timeout')),5000);ws.addEventListener('open',()=>{clearTimeout(t);ok();},{once:true});ws.addEventListener('error',e=>{clearTimeout(t);no(e);},{once:true});});return new CDP(ws);}
   }
  }catch(error){if(n===59)throw error;}
  await delay(1000);
 }
 throw new Error('No inspectable WebView found');
}
const snapshotExpr=`(()=>{const visible=e=>!!e&&(e.checkVisibility?e.checkVisibility({checkOpacity:true,checkVisibilityCSS:true}):e.getBoundingClientRect().height>0);const nav=document.querySelector('.app-bottom-nav');const input=document.querySelector('[data-testid="search-input"]');return {t:performance.now(),hash:location.hash,nav:visible(nav),searchInput:visible(input)&&!input.disabled,bootTitle:document.querySelector('.boot-card__title')?.textContent||null,bootDescription:document.querySelector('.boot-card__description')?.textContent||null,marks:performance.getEntriesByType('mark').filter(e=>e.name.startsWith('minimed:')).map(e=>({name:e.name,ms:e.startTime})),results:document.querySelectorAll('[data-testid="search-result"]').length,searchError:document.querySelector('.error-card')?.textContent||null,headings:[...document.querySelectorAll('h1,h2')].filter(visible).map(e=>e.textContent).slice(0,5)}})()`;
function memory(label){
 const ps=adb('shell','ps','-A','-o','PID,NAME,ARGS');
 const matches=ps.split('\n').filter(l=>l.includes(pkg)||/webview.*sandboxed_process|trichrome.*sandboxed_process/i.test(l));
 const processes=[];
 for(const line of matches){const pid=line.trim().split(/\s+/)[0];if(!/^\d+$/.test(pid))continue;try{const text=adb('shell','dumpsys','meminfo',pid,'-s');const m=text.match(/TOTAL PSS:\s*(\d+)/)||text.match(/^\s*TOTAL\s+(\d+)/m);processes.push({pid:Number(pid),name:line.trim(),pssKiB:m?Number(m[1]):null});appendFileSync(`${out}/memory-raw.txt`,`\n${label}\n${line}\n${text}`);}catch(error){processes.push({pid:Number(pid),error:String(error)});}}
 return {label,processes,totalPssKiB:processes.reduce((s,p)=>s+(p.pssKiB||0),0)};
}
async function capture(cdp,name){const image=await cdp.call('Page.captureScreenshot',{format:'png'});writeFileSync(`${out}/${name}.png`,Buffer.from(image.data,'base64'));}
async function tap(cdp,label){const point=await cdp.eval(`(()=>{const e=document.querySelector('.app-bottom-nav button[aria-label=${JSON.stringify(JSON.stringify(label))}]');if(!e)return null;const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);if(!point)throw new Error(`Navigation button missing: ${label}`);await cdp.call('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point]});await cdp.call('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});}
for(const mode of ['cold-installed','warm-relaunch']){
 let cdp;const run={mode,samples:[],memory:[]};result.runs.push(run);
 adb('shell','am','force-stop',pkg);adb('logcat','-c');
 const logger=spawn('adb',['logcat','-v','threadtime','LocalMedDatabase:I','Capacitor/Console:W','AndroidRuntime:E','chromium:E','*:S']);
 logger.stdout.on('data',v=>appendFileSync(`${out}/${mode}-logcat.txt`,v));logger.stderr.on('data',v=>appendFileSync(`${out}/${mode}-logcat.txt`,v));
 const start=Date.now();
 try{
  adb('shell','am','start','-W','-n',`${pkg}/.MainActivity`);
  cdp=await connect();
  let testedNav=false;
  while(Date.now()-start<180000){
   const snap=await cdp.eval(snapshotExpr);run.samples.push({...snap,hostElapsedMs:Date.now()-start});
   run.memory.push(memory(`${mode}:${Date.now()-start}`));
   if(snap.nav&&!testedNav){testedNav=true;run.navigationTest={whilePreparing:!snap.searchInput};await tap(cdp,'Калькуляторы');await delay(800);run.navigationTest.calculators=await cdp.eval(snapshotExpr);await capture(cdp,`${mode}-calculators`);await tap(cdp,'Поиск');await delay(300);}
   if(snap.searchInput){run.ready=snap;break;}
   if(snap.bootTitle==='База не открылась'){run.openError=snap.bootDescription;break;}
   await delay(1500);
  }
  await capture(cdp,`${mode}-end`);
  if(run.ready){
   const submitted=Date.now();
   await cdp.eval(`(()=>{const e=document.querySelector('[data-testid="search-input"]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,'астма');e.dispatchEvent(new Event('input',{bubbles:true}));e.closest('form').requestSubmit();return true})()`);
   while(Date.now()-submitted<45000){const s=await cdp.eval(snapshotExpr);if(s.results>0||s.searchError){run.search={elapsedMs:Date.now()-submitted,...s};break;}await delay(500);}
   run.memory.push(memory(`${mode}:after-search`));await capture(cdp,`${mode}-search`);
  }
 }catch(error){run.harnessError=String(error);}
 finally{cdp?.close();logger.kill();run.hostTotalMs=Date.now()-start;run.peakObservedPssKiB=Math.max(0,...run.memory.map(m=>m.totalPssKiB));save('result.json',result);console.log(JSON.stringify(run,null,2));}
}
const failures=result.runs.flatMap(r=>[...(!r.ready?[`${r.mode}: search not ready`]:[]),...(!(r.search?.results>0)?[`${r.mode}: no result within budget`]:[]),...(!r.navigationTest?.calculators?.hash?.includes('/calculators')?[`${r.mode}: calculator navigation failed`]:[])]);
result.failures=failures;save('result.json',result);if(failures.length){console.error(failures);process.exitCode=1;}
