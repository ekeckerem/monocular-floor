// main.js v7 (fixed image loading issues)
console.log('main.js v7 OK');

// ============ DOM refs ============
const fileInput   = document.getElementById('fileInput');
const btnPickImage= document.getElementById('btnPickImage');
const btnTest     = document.getElementById('btnTest');
const dropZone    = document.getElementById('dropZone');
const debugPreview= document.getElementById('debugPreview');
const imgCanvas   = document.getElementById('imgCanvas');
const payloadPre  = document.getElementById('payload');
const countEl     = document.getElementById('count');
const hoverEl     = document.getElementById('hover');
const dragEl      = document.getElementById('drag');
const imgSizeEl   = document.getElementById('imgSizeEl'); // <-- FIXED: was 'imgSize'

const btnAutoOrder  = document.getElementById('btnAutoOrder');
const btnDeleteLast = document.getElementById('btnDeleteLast');
const btnClear      = document.getElementById('btnClear');
const btnExport     = document.getElementById('btnExport');
const btnSend       = document.getElementById('btnSend');
const btnPose       = document.getElementById('btnPose');

const API_BASE = 'http://127.0.0.1:8000';
const poseDebug = document.createElement('pre');
poseDebug.style.cssText = 'white-space:pre-wrap;word-break:break-word;background:#111a25;color:#d8deea;border:1px solid #223047;border-radius:8px;padding:8px;margin:8px 0;max-height:220px;overflow:auto;';
poseDebug.textContent = 'Align 3D debug…';
(document.querySelector('.panel') || document.body).appendChild(poseDebug);
const dbg = (...a)=>{ const s=a.map(x=>typeof x==='string'?x:JSON.stringify(x,null,2)).join(' ');
  console.log('[POSE]', ...a); poseDebug.textContent += '\n' + s; };

function dbgLine(...args){
  const s = args.map(a => typeof a === 'string' ? a : JSON.stringify(a, null, 2)).join(' ');
  console.log('[POSE]', ...args);
  poseDebug.textContent += '\n' + s;
}

async function safeFetchJSON(url, options){
  const res = await fetch(url, options);
  const text = await res.text();
  // Try JSON first; if it fails, return raw text with a flag
  try { return { ok: res.ok, status: res.status, json: JSON.parse(text), raw: text }; }
  catch { return { ok: res.ok, status: res.status, json: null, raw: text }; }
}

// ============ Canvas setup (HiDPI-safe) ============
const ctx = imgCanvas.getContext('2d');
let dpr = window.devicePixelRatio || 1;

function resizeCanvasToCSS(canvas) {
  const rect = canvas.getBoundingClientRect();
  const cssW = Math.max(1, Math.floor(rect.width));
  const cssH = Math.max(1, Math.floor(rect.height));
  if (canvas.width !== cssW * dpr || canvas.height !== cssH * dpr) {
    canvas.width = cssW * dpr;
    canvas.height = cssH * dpr;
  }
}
function setHiDPIScale() { ctx.setTransform(dpr, 0, 0, dpr, 0, 0); }

// ============ Image state ============
let img = new Image();
let hasImage = false;
let imgW = 0, imgH = 0; // original pixels

// draw placement (letterbox) in CSS pixels
let drawX = 0, drawY = 0, drawW = 0, drawH = 0, scale = 1;

// ============ Points ============
let pts = []; // [{x,y}, ...]
let hoverIndex = -1;
let dragIndex = -1;
const HIT_R = 10;

// ============ Mapping ============
function computeDrawParams() {
  const rect = imgCanvas.getBoundingClientRect();
  const W = rect.width, H = rect.height;
  if (!hasImage) { drawX=0;drawY=0;drawW=W;drawH=H;scale=1; return; }
  const s = Math.min(W / imgW, H / imgH);
  drawW = imgW * s; drawH = imgH * s;
  drawX = (W - drawW) / 2; drawY = (H - drawH) / 2;
  scale = s;
}
function imgToCanvas(p)  { return { x: drawX + p.x * scale, y: drawY + p.y * scale }; }
function canvasToImg(p)  { return { x: (p.x - drawX) / scale, y: (p.y - drawY) / scale }; }
function insideDrawnImage(px, py) { return px>=drawX && py>=drawY && px<=drawX+drawW && py<=drawY+drawH; }
function dist2(a,b){const dx=a.x-b.x,dy=a.y-b.y;return dx*dx+dy*dy;}
function autoOrderCW(points) {
  if (points.length < 3) return points.slice();
  const c = points.reduce((s,p)=>({x:s.x+p.x,y:s.y+p.y}),{x:0,y:0});
  c.x/=points.length; c.y/=points.length;
  return points.slice().sort((p1,p2)=>{
    const a1=Math.atan2(p1.y-c.y,p1.x-c.x);
    const a2=Math.atan2(p2.y-c.y,p2.x-c.x);
    return a1-a2;
  }).reverse(); // CW
}
function clampPointToImage(p){return {x:Math.max(0,Math.min(imgW-1,p.x)), y:Math.max(0,Math.min(imgH-1,p.y))};}

// ============ Drawing ============
function draw() {
  resizeCanvasToCSS(imgCanvas);
  setHiDPIScale();
  computeDrawParams();

  const rect = imgCanvas.getBoundingClientRect();
  ctx.fillStyle = '#0b0d13';
  ctx.fillRect(0,0,rect.width,rect.height);

  if (hasImage) {
    ctx.drawImage(img, drawX, drawY, drawW, drawH);
  } else {
    ctx.save();
    ctx.fillStyle='#22283a'; ctx.fillRect(0,0,rect.width,rect.height);
    ctx.fillStyle='#6a7390'; ctx.font='14px system-ui';
    ctx.fillText('Upload / drop an image or click Test Image…', 16, 28);
    ctx.restore();
  }

  if (pts.length >= 2) {
    ctx.save();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#5aa9ff';
    ctx.fillStyle = 'rgba(90,169,255,0.10)';
    const cpts = pts.map(imgToCanvas);
    ctx.beginPath();
    ctx.moveTo(cpts[0].x, cpts[0].y);
    for (let i=1;i<cpts.length;i++) ctx.lineTo(cpts[i].x, cpts[i].y);
    ctx.closePath();
    ctx.stroke();
    if (pts.length >= 3) ctx.fill();
    ctx.restore();
  }

  // points
  ctx.save();
  for (let i=0;i<pts.length;i++) {
    const cpt = imgToCanvas(pts[i]);
    const r = (i===hoverIndex||i===dragIndex)?6:5;
    ctx.beginPath(); ctx.arc(cpt.x,cpt.y,r,0,Math.PI*2);
    ctx.fillStyle = (i===dragIndex)?'#7ef1c7':(i===hoverIndex)?'#ffcf6b':'#ffffff';
    ctx.strokeStyle = '#0b0d13'; ctx.lineWidth=2; ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#e8ecf1'; ctx.font='12px system-ui';
    ctx.fillText(String(i+1), cpt.x+8, cpt.y-8);
  }
  ctx.restore();

  // status + payload
  if (countEl) countEl.textContent = String(pts.length);
  if (hoverEl) hoverEl.textContent = (hoverIndex>=0)? String(hoverIndex+1) : '—';
  if (dragEl)  dragEl.textContent  = (dragIndex>=0)? String(dragIndex+1)  : '—';
  if (imgSizeEl) imgSizeEl.textContent = hasImage ? `${imgW}×${imgH}` : '—';

  const payload = buildPayload(false);
  if (payloadPre) payloadPre.textContent = JSON.stringify(payload, null, 2);
}

// ============ Load helpers ============
function loadFromURL(url, revokeAfterLoad=false) {
  console.log('loadFromURL', url.slice(0, 50) + '...');
  const im = new Image();

  // Add error handling with more details
  im.onerror = (e) => {
    console.error('img.onerror', e);
    hasImage = false;
    alert('Could not load that image. Try PNG/JPG/WebP.');
    draw(); // Redraw to show empty state
  };

  im.onload = () => {
    console.log('img.onload', im.naturalWidth, im.naturalHeight);

    // Validate image dimensions
    if (im.naturalWidth === 0 || im.naturalHeight === 0) {
      console.error('Invalid image dimensions');
      alert('Invalid image: zero width or height');
      return;
    }

    img = im;
    hasImage = true;
    imgW = im.naturalWidth;
    imgH = im.naturalHeight;
    pts = [];

    if (debugPreview) {
      debugPreview.src = url;
      debugPreview.style.display='block';
    }

    draw();

    if (revokeAfterLoad) {
      // Add small delay before revoking to ensure image is fully loaded
      setTimeout(() => URL.revokeObjectURL(url), 100);
    }
  };

  // Set crossOrigin before src for external images
  if (url.startsWith('http') && !url.startsWith(window.location.origin)) {
    im.crossOrigin = 'anonymous';
  }

  im.src = url;
}

function loadFromDataURL(dataURL){
  if (!dataURL || !dataURL.startsWith('data:image/')) {
    console.error('Invalid data URL');
    alert('Invalid image data');
    return;
  }
  loadFromURL(dataURL, false);
}

function handleFile(file){
  if (!file) {
    console.log('No file selected');
    return;
  }

  if (!file.type.startsWith('image/')) {
    alert('Please choose an image file.');
    return;
  }

  // Check file size (optional - prevents very large files)
  if (file.size > 10 * 1024 * 1024) { // 10MB limit
    alert('Image file is too large (max 10MB)');
    return;
  }

  console.log('Loading file:', file.name, file.type, file.size + ' bytes');

  const reader = new FileReader();
  reader.onload = (e) => {
    console.log('FileReader loaded, data length:', e.target.result?.length || 0);
    loadFromDataURL(e.target.result);
  };
  reader.onerror = (e) => {
    console.error('FileReader error:', e);
    alert('Failed to read the file.');
  };
  reader.readAsDataURL(file);
}

// ============ Input handlers ============
btnPickImage?.addEventListener('click', ()=> {
  console.log('Pick image clicked');
  fileInput.click();
});

fileInput?.addEventListener('change', (e)=> {
  console.log('File input changed, files:', e.target.files?.length || 0);
  handleFile(e.target.files[0]);
  e.target.value=''; // Reset input
});

btnTest?.addEventListener('click', ()=>{
  console.log('Test image clicked');
  const c=document.createElement('canvas');
  c.width=640;
  c.height=480;
  const x=c.getContext('2d');

  // Create a more visible test pattern
  x.fillStyle='#ffffff';
  x.fillRect(0,0,640,480);

  // Add some visual elements
  x.strokeStyle='#888888';
  x.lineWidth=4;
  x.strokeRect(20,20,600,440);

  x.fillStyle='#ff6b6b';
  x.fillRect(50, 50, 100, 100);

  x.fillStyle='#4ecdc4';
  x.fillRect(490, 330, 100, 100);

  x.fillStyle='#45b7d1';
  x.font = '24px Arial';
  x.fillText('Test Image', 270, 250);

  const dataURL = c.toDataURL('image/png');
  console.log('Test image created, data URL length:', dataURL.length);
  loadFromDataURL(dataURL);
});

// Drag & drop with better error handling
for (const ev of ['dragenter','dragover']) {
  dropZone?.addEventListener(ev, e=>{
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect='copy';
    dropZone.style.backgroundColor = '#1a2332'; // Visual feedback
  });
}

for (const ev of ['dragleave','drop']) {
  dropZone?.addEventListener(ev, e=>{
    e.preventDefault();
    e.stopPropagation();
    dropZone.style.backgroundColor = ''; // Reset visual feedback
  });
}

dropZone?.addEventListener('drop', (e)=> {
  console.log('Drop event, files:', e.dataTransfer.files?.length || 0);
  const f = e.dataTransfer.files && e.dataTransfer.files[0];
  handleFile(f);
});

// Mouse event handlers remain the same
imgCanvas.addEventListener('mousemove', (e)=>{
  const rect=imgCanvas.getBoundingClientRect();
  const p={x:e.clientX-rect.left,y:e.clientY-rect.top};
  hoverIndex=-1;
  let best=-1, bestD2=HIT_R*HIT_R+1;
  for (let i=0;i<pts.length;i++){
    const c=imgToCanvas(pts[i]); const d2=dist2(p,c);
    if (d2<bestD2){bestD2=d2;best=i;}
  }
  if (best>=0 && Math.sqrt(bestD2)<=HIT_R) hoverIndex=best;
  if (dragIndex>=0){ pts[dragIndex]=clampPointToImage(canvasToImg(p)); }
  draw();
});

imgCanvas.addEventListener('mousedown', (e)=>{
  if(!hasImage) return;
  const rect=imgCanvas.getBoundingClientRect();
  const p={x:e.clientX-rect.left,y:e.clientY-rect.top};
  if (hoverIndex>=0) { dragIndex=hoverIndex; }
  else if (insideDrawnImage(p.x,p.y)) { pts.push(clampPointToImage(canvasToImg(p))); dragIndex=pts.length-1; }
  draw();
});

window.addEventListener('mouseup', ()=>{ dragIndex=-1; draw(); });
imgCanvas.addEventListener('mouseleave', ()=>{ hoverIndex=-1; dragIndex=-1; draw(); });

window.addEventListener('keydown', (e)=>{
  if (e.key==='Delete'||e.key==='Backspace'){ if (pts.length>0){ pts.pop(); draw(); } }
  if (e.key.toLowerCase()==='c' && (e.ctrlKey||e.metaKey)){ navigator.clipboard.writeText(JSON.stringify(buildPayload(true),null,2)); }
});

btnAutoOrder?.addEventListener('click', ()=>{ pts=autoOrderCW(pts); draw(); });
btnDeleteLast?.addEventListener('click', ()=>{ if (pts.length>0) pts.pop(); draw(); });
btnClear?.addEventListener('click', ()=>{ pts=[]; draw(); });

btnExport?.addEventListener('click', ()=>{
  const blob=new Blob([JSON.stringify(buildPayload(true),null,2)],{type:'application/json'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='points_payload.json'; a.click();
});

// ---- Data URL helper for backend ----
function currentImageDataURL(){
  if (!hasImage) return null;
  const c=document.createElement('canvas');
  c.width=img.naturalWidth||imgW; c.height=img.naturalHeight||imgH;
  const cx=c.getContext('2d');
  try {
    cx.drawImage(img,0,0,c.width,c.height);
    return c.toDataURL('image/jpeg',0.92);
  } catch (e) {
    console.error('Error creating data URL:', e);
    return null;
  }
}

// ---- Send to homography (Step-2) ----
btnSend?.addEventListener('click', async ()=>{
  const imageDataURL = currentImageDataURL();
  if (!imageDataURL) {
    alert('No valid image to send');
    return;
  }

  const body={
    image_size:{width:imgW,height:imgH},
    points_img:pts.map(p=>({x:Math.round(p.x),y:Math.round(p.y)})),
    include_image:true,
    image_b64:imageDataURL
  };
  try{
    const res=await fetch('http://127.0.0.1:8000/estimate-homography',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const j=await res.json();
    console.log('estimate-homography:', j);
    if (j.rectified_image) {
      const imgRect=new Image(); imgRect.src=j.rectified_image; imgRect.style.maxWidth='100%'; imgRect.style.marginTop='8px';
      const imgOv=new Image();   imgOv.src=j.overlay_image;     imgOv.style.maxWidth='100%';   imgOv.style.marginTop='8px';
      debugPreview?.insertAdjacentElement('afterend', imgRect);
      imgRect.insertAdjacentElement('afterend', imgOv);
    } else {
      alert('Backend response: '+JSON.stringify(j,null,2));
    }
  }catch(err){ alert('Fetch failed. Start the backend or check URL.\n'+err); }
});

// keep a reference to the three.js bits
let three=null;  // { renderer, scene, camera, controls, floorMesh, texLoader }
function initThreeExtras(renderer,scene,camera,controls){
  three={ renderer, scene, camera, controls, floorMesh:null, texLoader:new THREE.TextureLoader() };
}

function buildPayload(includeImageB64) {
  const imageDataURL = includeImageB64 ? currentImageDataURL() : null;
  return {
    image_size: { width: imgW, height: imgH },
    points_img: pts.map(p => ({ x: Math.round(p.x), y: Math.round(p.y) })),
    include_image: !!includeImageB64,
    image_b64: imageDataURL
  };
}

// ============ Kickoff ============
function animate(){ draw(); requestAnimationFrame(animate); }
animate();

// ============ Three.js init ============
(function initThree(){
  const threeCanvas=document.getElementById('threeCanvas');
  const renderer=new THREE.WebGLRenderer({canvas:threeCanvas,antialias:true});
  const scene=new THREE.Scene();
  scene.background=new THREE.Color(0x0b0d13);

  const rect=threeCanvas.getBoundingClientRect();
  const camera=new THREE.PerspectiveCamera(50, rect.width/rect.height, 0.01, 10000);
  camera.position.set(2.5,2.0,3.5);

  const controls=new THREE.OrbitControls(camera,threeCanvas);
  controls.enableDamping=true;

  const grid=new THREE.GridHelper(10,10,0x334466,0x223044); grid.position.y=0; scene.add(grid);
  const axes=new THREE.AxesHelper(1.2); scene.add(axes);

  function render(){
    const r=threeCanvas.getBoundingClientRect();
    if (renderer.domElement.width!==r.width*dpr || renderer.domElement.height!==r.height*dpr){
      renderer.setSize(r.width,r.height,false);
      camera.aspect=r.width/r.height;
      camera.updateProjectionMatrix();
    }
    controls.update();
    renderer.render(scene,camera);
    requestAnimationFrame(render);
  }
  render();
  initThreeExtras(renderer,scene,camera,controls);
})();

// ============ Step-3: Pose -> Align 3D ============
btnPose?.addEventListener('click', async ()=>{
  dbg('—— Align 3D clicked ——');
  if (!hasImage || pts.length < 4) { alert('Pick ≥4 floor points'); return; }

  // 1) Prove backend reachable
  let ping;
  try { ping = await fetch(API_BASE + '/').then(r=>r.json()); }
  catch(e){ dbg('Ping failed:', String(e)); alert('Backend not reachable at ' + API_BASE); return; }
  dbg('Ping:', ping);

  // 2) Build request with TRUE base64 image
  const body = buildPayload(true);
  if (!body.image_b64) {
    alert('Could not generate image data');
    return;
  }

  // 3) Call pose and show raw+JSON
  let res, txt, j;
  try {
    res = await fetch(API_BASE + '/estimate-pose', {
      method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body)
    });
    txt = await res.text(); dbg('Raw:', txt.slice(0, 400));
    j = JSON.parse(txt);
  } catch (e) {
    dbg('Pose fetch/parse error:', String(e));
    alert('Pose failed (see debug panel).'); return;
  }
  dbg('JSON:', j);

  if (j.status !== 'ok' || !j.three_pose) {
    alert('Pose response missing three_pose (see debug panel).'); return;
  }

  // 4) Visibly change background so you SEE it worked
  const texURL = currentImageDataURL();
  if (texURL) {
    three.texLoader.load(texURL, (tex)=>{
      if (three.renderer.outputColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
      else { tex.encoding = THREE.sRGBEncoding; three.renderer.outputEncoding = THREE.sRGBEncoding; }
      three.scene.background = tex;
      three.renderer.render(three.scene, three.camera);
    });
  }

  // 5) Apply camera pose
  const { position:[x,y,z], quaternion:[qx,qy,qz,qw], fov_y_deg } = j.three_pose;
  three.camera.fov = fov_y_deg || 50; three.camera.updateProjectionMatrix();
  three.camera.matrixAutoUpdate = false;
  const M = new THREE.Matrix4();
  M.compose(new THREE.Vector3(x,y,z), new THREE.Quaternion(qx,qy,qz,qw), new THREE.Vector3(1,1,1));
  three.camera.matrixWorld.copy(M); three.camera.matrixWorldNeedsUpdate = true;

  // 6) Add/update translucent floor (so you see a mesh)
  const W = j.rect_size?.width ?? 1, H = j.rect_size?.height ?? 1;
  if (!three.floorMesh) {
    const g = new THREE.PlaneGeometry(W, H, 1, 1); g.translate(W/2, H/2, 0);
    const mat = new THREE.MeshBasicMaterial({ color: 0x4da3ff, opacity: 0.35, transparent: true, side: THREE.DoubleSide });
    three.floorMesh = new THREE.Mesh(g, mat); three.scene.add(three.floorMesh);
  } else {
    three.floorMesh.geometry.dispose();
    const g = new THREE.PlaneGeometry(W, H, 1, 1); g.translate(W/2, H/2, 0);
    three.floorMesh.geometry = g;
  }
  three.controls?.target.set(W/2, H/2, 0); three.controls?.update();

  dbg('✓ Applied background, camera, floor mesh');
});