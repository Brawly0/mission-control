const {app,BrowserWindow}=require('electron');
const path=require('path'),fs=require('fs');
app.setPath('userData',path.resolve('out/grid-check-profile-'+process.pid));
app.whenReady().then(async()=>{
 const win=new BrowserWindow({show:false,width:1440,height:900,webPreferences:{backgroundThrottling:false}});
 const js=code=>win.webContents.executeJavaScript(code);
 setTimeout(()=>app.exit(2),20000);
 const wait=()=>new Promise(r=>setTimeout(r,150));
 try{
  await win.loadFile(path.resolve('out/grid-check/index.html'));await wait();
  const assert=async(code,label)=>{if(!await js(code))throw Error(label); console.log('PASS '+label)};
  await assert(`document.querySelectorAll('.task-term').length===16`,'all panels mounted');
  await js(`window.original=document.querySelector('[data-id="0"]');document.querySelector('select').value='8x2';document.querySelector('select').dispatchEvent(new Event('change',{bubbles:true}))`);await wait();
  await assert(`getComputedStyle(document.querySelector('.task-agent-stage')).gridTemplateColumns.split(' ').length===15`,'eight columns');
  await assert(`getComputedStyle(document.querySelector('.task-agent-stage')).gridTemplateRows.split(' ').length===3`,'two rows');
  await js(`document.querySelector('[data-id="0"] button').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',altKey:true,bubbles:true}))`);await wait();
  await assert(`document.querySelector('[data-id="0"]').style.gridColumn==='3' && window.original===document.querySelector('[data-id="0"]')`,'keyboard swap preserves panel DOM');
  await js(`window.dt=new DataTransfer();document.querySelector('[data-id="0"] button').dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer:dt}))`);await wait();
  await js(`window.target=document.querySelector('[data-id="3"]');window.rect=target.getBoundingClientRect();target.dispatchEvent(new DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer:dt,clientX:rect.x+rect.width/2,clientY:rect.y+rect.height/2}))`);await wait();
  await assert(`target.dataset.drop==='swap'`,'center drop preview');
  await js(`target.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:dt}))`);await wait();
  await assert(`document.querySelector('[data-id="0"]').style.gridColumn==='7' && window.original===document.querySelector('[data-id="0"]')`,'drag swap preserves panel DOM');
  const rect=await js(`(()=>{const r=document.querySelector('.grid-gutter.col').getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+30)}})()`);
  console.log('HIT',rect,await js(`document.elementFromPoint(${rect.x},${rect.y})?.outerHTML`));await js(`window.events=[];document.addEventListener('pointerdown',e=>events.push(['down',e.target.className]));document.addEventListener('pointermove',e=>events.push(['move',e.target.className]));document.addEventListener('pointerup',e=>events.push(['up',e.target.className]))`);win.webContents.sendInputEvent({type:'mouseMove',...rect});await wait();win.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...rect});await wait();
  win.webContents.sendInputEvent({type:'mouseMove',x:rect.x+35,y:rect.y});await wait();win.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,x:rect.x+35,y:rect.y});await wait();
  console.log('EVENTS',await js(`JSON.stringify(events)`),await js(`localStorage.getItem('test-grid')`));await assert(`JSON.parse(localStorage.getItem('test-grid'))['8x2'].cols[0]!==1`,'pointer resize saved');
  fs.writeFileSync(path.resolve('out/grid-check.png'),(await win.webContents.capturePage()).toPNG());
  await js(`document.querySelector('#reset').click()`);await wait();
  await assert(`document.querySelector('[data-id="0"]').style.gridColumn==='1' && !JSON.parse(localStorage.getItem('test-grid'))['8x2']`,'reset order and sizes');
  app.exit(0);
 }catch(e){console.error(e);app.exit(1)}
});
