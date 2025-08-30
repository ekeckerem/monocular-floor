// main.js - Picker + Pose + Three alignment
console.log('main.js loaded');

// ---------- Lightweight OrbitControls (r128-compatible) ----------
THREE.OrbitControls = function (object, domElement) {
  this.object = object;
  this.domElement = (domElement !== undefined) ? domElement : document;
  this.enabled = true;
  this.target = new THREE.Vector3();
  this.minDistance = 0; this.maxDistance = Infinity;
  this.minPolarAngle = 0; this.maxPolarAngle = Math.PI;
  this.enableDamping = true; this.dampingFactor = 0.15;
  this.enableZoom = true; this.zoomSpeed = 1.0;
  this.enableRotate = true; this.rotateSpeed = 1.0;
  this.enablePan = true; this.panSpeed = 1.0;
  var scope = this, state = -1, ROTATE=0, DOLLY=1, PAN=2;
  var spherical = new THREE.Spherical(), sphericalDelta = new THREE.Spherical();
  var scale = 1, panOffset = new THREE.Vector3(), zoomChanged=false;
  var rotateStart=new THREE.Vector2(), rotateEnd=new THREE.Vector2(), rotateDelta=new THREE.Vector2();
  var panStart=new THREE.Vector2(), panEnd=new THREE.Vector2(), panDelta=new THREE.Vector2();
  var dollyStart=new THREE.Vector2(), dollyEnd=new THREE.Vector2(), dollyDelta=new THREE.Vector2();

  function getZoomScale(){ return Math.pow(0.95, scope.zoomSpeed); }
  function rotateLeft(a){ sphericalDelta.theta -= a; }
  function rotateUp(a){ sphericalDelta.phi   -= a; }
  function pan(dx,dy){
    var e = scope.domElement;
    if (scope.object.isPerspectiveCamera){
      var offset = new THREE.Vector3().copy(scope.object.position).sub(scope.target);
      var targetDistance = offset.length() * Math.tan((scope.object.fov/2)*Math.PI/180.0);
      var panX = 2*dx*targetDistance/e.clientHeight;
      var panY = 2*dy*targetDistance/e.clientHeight;
      var v = new THREE.Vector3();
      v.setFromMatrixColumn(scope.object.matrix,0).multiplyScalar(-panX); panOffset.add(v);
      v.setFromMatrixColumn(scope.object.matrix,0).cross(scope.object.up).multiplyScalar(panY); panOffset.add(v);
    }
  }
  function dollyIn(s){ if(scope.object.isPerspectiveCamera) scale/=s; }
  function dollyOut(s){ if(scope.object.isPerspectiveCamera) scale*=s; }

  function onWheel(e){ e.preventDefault(); if(e.deltaY<0) dollyOut(getZoomScale()); else dollyIn(getZoomScale()); update(); }
  function onMouseDown(e){
    e.preventDefault();
    if (e.button===0){ rotateStart.set(e.clientX,e.clientY); state=ROTATE; }
    else if (e.button===1){ dollyStart.set(e.clientX,e.clientY); state=DOLLY; }
    else if (e.button===2){ panStart.set(e.clientX,e.clientY); state=PAN; }
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }
  function onMouseMove(e){
    if (state===ROTATE){
      rotateEnd.set(e.clientX,e.clientY);
      rotateDelta.subVectors(rotateEnd,rotateStart).multiplyScalar(scope.rotateSpeed);
      var el = scope.domElement;
      rotateLeft(2*Math.PI*rotateDelta.x/el.clientHeight);
      rotateUp  (2*Math.PI*rotateDelta.y/el.clientHeight);
      rotateStart.copy(rotateEnd); update();
    } else if (state===DOLLY){
      dollyEnd.set(e.clientX,e.clientY);
      dollyDelta.subVectors(dollyEnd,dollyStart);
      if (dollyDelta.y>0) dollyIn(getZoomScale()); else if (dollyDelta.y<0) dollyOut(getZoomScale());
      dollyStart.copy(dollyEnd); update();
    } else if (state===PAN){
      panEnd.set(e.clientX,e.clientY); panDelta.subVectors(panEnd,panStart).multiplyScalar(scope.panSpeed);
      pan(panDelta.x, panDelta.y); panStart.copy(panEnd); update();
    }
  }
  function onMouseUp(){ state=-1; document.removeEventListener('mousemove', onMouseMove); document.removeEventListener('mouseup', onMouseUp); }
  this.domElement.addEventListener('contextmenu', (e)=>e.preventDefault());
  this.domElement.addEventListener('mousedown', onMouseDown);
  this.domElement.addEventListener('wheel', onWheel, {passive:false});

  this.update = update;
  function update(){
    var offset=new THREE.Vector3();
    var quat = new THREE.Quaternion().setFromUnitVectors(scope.object.up,new THREE.Vector3(0,1,0));
    var quatInv = quat.clone().invert();
    var position = scope.object.position;
    offset.copy(position).sub(scope.target).applyQuaternion(quat);
    spherical.setFromVector3(offset);
    spherical.theta += sphericalDelta.theta;
    spherical.phi += sphericalDelta.phi;
    spherical.makeSafe();
    spherical.radius *= scale; spherical.radius = Math.max(0.01, Math.min(1e6, spherical.radius));
    scope.target.add(panOffset);
    offset.setFromSpherical(spherical).applyQuaternion(quatInv);
    position.copy(scope.target).add(offset);
    scope.object.lookAt(scope.target);
    if(scope.enableDamping){ sphericalDelta.theta *= (1 - scope.dampingFactor); sphericalDelta.phi *= (1 - scope.dampingFactor); panOffset.multiplyScalar(1 - scope.dampingFactor); }
    else { sphericalDelta.set(0,0,0); panOffset.set(0,0,0); }
    scale = 1;
  }
  update();
};

// ---------- DOM ----------
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
const imgSizeEl   = document.getElementById('imgSizeEl');

const btnAutoOrder  = document.getElementById('btnAutoOrder');
const btnDeleteLast = document.getElementById('btnDeleteLast');
const btnClear      = document.getElementById('btnClear');
const btnExport     = document.getElementById('btnExport');
const btnSend       = document.getElementById('btnSend');
const btnPose       = document.getElementById('btnPose');

const API_BASE = 'http://127.0.0.1:8000';

// ---- Align 3D debug panel ----
const poseDebug = document.createElement('pre');
poseDebug.style.cssText =
  'white-space:pre-wrap;word-break:break-word;background:#111a25;color:#d8deea;border:1px solid #223047;border-radius:8px;padding:8px;margin:8px 0;max-height:220px;overflow:auto;';
poseDebug.textContent = 'Align 3D debug…';
(document.querySelector('.panel') || document.body).appendChild(poseDebug);
const dbg = (...a)=>{ const s=a.map(x=>typeof x==='string'?x:JSON.stringify(x,null,2)).join(' '); console.log('[POSE]',...a); poseDebug.textContent+='\n'+s; };

// ---------- Canvas/HiDPI ----------
const ctx = imgCanvas.getContext('2d');
const dpr = window.devicePixelRatio || 1;
function resizeCanvasToCSS(canvas){
  const r=canvas.getBoundingClientRect();
  const W=Math.max(1,Math.floor(r.width)), H=Math.max(1,Math.floor(r.height));
  if (canvas.width!==W*dpr || canvas.height!==H*dpr){ canvas.width=W*dpr; canvas.height=H*dpr; }
}
function setHiDPIScale(){ ctx.setTransform(dpr,0,0,dpr,0,0); }

// ---------- Image state ----------
let img = new Image(), hasImage=false, imgW=0, imgH=0;
let drawX=0, drawY=0, drawW=0, drawH=0, scale=1;

// ---------- Points ----------
let pts=[]; let hoverIndex=-1; let dragIndex=-1;
const HIT_R=10;

// ---------- Mapping ----------
function computeDrawParams(){
  const r=imgCanvas.getBoundingClientRect(), W=r.width, H=r.height;
  if(!hasImage){ drawX=0;drawY=0;drawW=W;drawH=H;scale=1; return; }
  const s=Math.min(W/imgW,H/imgH); drawW=imgW*s; drawH=imgH*s; drawX=(W-drawW)/2; drawY=(H-drawH)/2; scale=s;
}
function imgToCanvas(p){ return {x:drawX+p.x*scale, y:drawY+p.y*scale}; }
function canvasToImg(p){ return {x:(p.x-drawX)/scale, y:(p.y-drawY)/scale}; }
function inside(px,py){ return px>=drawX&&py>=drawY&&px<=drawX+drawW&&py<=drawY+drawH; }
function dist2(a,b){ const dx=a.x-b.x, dy=a.y-b.y; return dx*dx+dy*dy; }
function clampImg(p){ return {x:Math.max(0,Math.min(imgW-1,p.x)), y:Math.max(0,Math.min(imgH-1,p.y))}; }
function autoOrderCW(points){
  if(points.length<3) return points.slice();
  const c=points.reduce((s,p)=>({x:s.x+p.x,y:s.y+p.y}),{x:0,y:0}); c.x/=points.length; c.y/=points.length;
  return points.slice().sort((p1,p2)=>{
    const a1=Math.atan2(p1.y-c.y,p1.x-c.x), a2=Math.atan2(p2.y-c.y,p2.x-c.x);
    return a1-a2;
  }).reverse();
}

// ---------- Draw ----------
function draw(){
  resizeCanvasToCSS(imgCanvas); setHiDPIScale(); computeDrawParams();
  const r=imgCanvas.getBoundingClientRect();
  ctx.fillStyle='#0b0d13'; ctx.fillRect(0,0,r.width,r.height);

  if(hasImage) ctx.drawImage(img,drawX,drawY,drawW,drawH);
  else { ctx.fillStyle='#6a7390'; ctx.font='14px system-ui'; ctx.fillText('Upload / drop an image or click Test Image…', 16, 28); }

  if(pts.length>=2){
    const c=pts.map(imgToCanvas); ctx.lineWidth=2; ctx.strokeStyle='#5aa9ff'; ctx.fillStyle='rgba(90,169,255,0.10)';
    ctx.beginPath(); ctx.moveTo(c[0].x,c[0].y); for(let i=1;i<c.length;i++) ctx.lineTo(c[i].x,c[i].y); ctx.closePath(); ctx.stroke(); if(pts.length>=3) ctx.fill();
  }
  for(let i=0;i<pts.length;i++){
    const c=imgToCanvas(pts[i]); const rad=(i===hoverIndex||i===dragIndex)?6:5;
    ctx.beginPath(); ctx.arc(c.x,c.y,rad,0,Math.PI*2);
    ctx.fillStyle=(i===dragIndex)?'#7ef1c7':(i===hoverIndex)?'#ffcf6b':'#fff';
    ctx.strokeStyle='#0b0d13'; ctx.lineWidth=2; ctx.fill(); ctx.stroke();
    ctx.fillStyle='#e8ecf1'; ctx.font='12px system-ui'; ctx.fillText(String(i+1), c.x+8, c.y-8);
  }

  countEl && (countEl.textContent=String(pts.length));
  hoverEl && (hoverEl.textContent=(hoverIndex>=0)?String(hoverIndex+1):'—');
  dragEl  && (dragEl.textContent =(dragIndex>=0)?String(dragIndex+1) :'—');
  imgSizeEl&& (imgSizeEl.textContent=hasImage?`${imgW}×${imgH}`:'—');

  payloadPre && (payloadPre.textContent=JSON.stringify(buildPayload(false),null,2));
}

// ---------- Load ----------
function loadFromURL(url, revoke=false){
  const im=new Image(); im.onload=()=>{
    img=im; hasImage=true; imgW=im.naturalWidth; imgH=im.naturalHeight; pts=[];
    if(debugPreview){ debugPreview.src=url; debugPreview.style.display='block'; }
    draw(); if(revoke) setTimeout(()=>URL.revokeObjectURL(url),100);
  };
  im.onerror=(e)=>{ console.error('img.onerror',e); hasImage=false; alert('Could not load that image. Try PNG/JPG/WebP.'); draw(); };
  im.src=url;
}
function loadFromDataURL(dataURL){ if(!dataURL?.startsWith('data:image/')){ alert('Invalid image data'); return; } loadFromURL(dataURL,false); }
function handleFile(file){
  if(!file) return;
  if(!file.type.startsWith('image/')){ alert('Please choose an image file.'); return; }
  if(file.size>10*1024*1024){ alert('Image too large (max 10MB)'); return; }
  const url=URL.createObjectURL(file); loadFromURL(url,true);
}

// ---------- Data URL for backend ----------
function currentImageDataURL(){
  if(!hasImage) return null;
  const c=document.createElement('canvas'); c.width=img.naturalWidth||imgW; c.height=img.naturalHeight||imgH;
  c.getContext('2d').drawImage(img,0,0,c.width,c.height);
  return c.toDataURL('image/jpeg',0.92);
}
function buildPayload(includeImageB64){
  return {
    image_size:{ width:imgW, height:imgH },
    points_img: pts.map(p=>({ x:Math.round(p.x), y:Math.round(p.y) })),
    include_image: !!includeImageB64,
    image_b64: includeImageB64 ? currentImageDataURL() : null
  };
}
function setBackgroundFromCurrentImage() {
  if (!hasImage) { console.warn('No image loaded'); return; }
  if (!three || !three.scene) { console.warn('Three not ready'); return; }

  // Make a Data URL from the original-resolution image
  const dataURL = currentImageDataURL();
  if (!dataURL) { console.warn('No image dataURL'); return; }

  // Ensure we have a TextureLoader
  if (!three.texLoader) three.texLoader = new THREE.TextureLoader();

  three.texLoader.load(
    dataURL,
    (tex) => {
      // sRGB improves visual match with photo
      if ('encoding' in tex) tex.encoding = THREE.sRGBEncoding;
      three.scene.background = tex;
      three.renderer.render(three.scene, three.camera);
      console.log('✓ scene.background set from image');
    },
    undefined,
    (err) => {
      console.error('Texture load failed', err);
      alert('Could not set background texture (see console for details).');
    }
  );
}


// ---------- UI ----------
btnPickImage?.addEventListener('click', ()=> fileInput?.click());
fileInput?.addEventListener('change', (e)=>{ handleFile(e.target.files?.[0]); e.target.value=''; });
btnTest?.addEventListener('click', ()=>{
  const c=document.createElement('canvas'); c.width=640;c.height=480;
  const x=c.getContext('2d'); x.fillStyle='#fff'; x.fillRect(0,0,640,480);
  x.strokeStyle='#888'; x.lineWidth=8; x.strokeRect(20,20,600,440);
  loadFromDataURL(c.toDataURL('image/png'));
});
for(const ev of ['dragenter','dragover']) dropZone?.addEventListener(ev, e=>{ e.preventDefault(); e.dataTransfer.dropEffect='copy'; });
for(const ev of ['dragleave','drop'])     dropZone?.addEventListener(ev, e=>{ e.preventDefault(); });
dropZone?.addEventListener('drop', e=>{ const f=e.dataTransfer.files?.[0]; handleFile(f); });

imgCanvas.addEventListener('mousemove', (e)=>{
  const r=imgCanvas.getBoundingClientRect(); const p={x:e.clientX-r.left,y:e.clientY-r.top};
  hoverIndex=-1; let best=-1, bestD2=HIT_R*HIT_R+1;
  for(let i=0;i<pts.length;i++){ const c=imgToCanvas(pts[i]); const d2=dist2(p,c); if(d2<bestD2){bestD2=d2;best=i;} }
  if(best>=0 && Math.sqrt(bestD2)<=HIT_R) hoverIndex=best;
  if(dragIndex>=0){ pts[dragIndex]=clampImg(canvasToImg(p)); }
  draw();
});
imgCanvas.addEventListener('mousedown', (e)=>{
  if(!hasImage) return;
  const r=imgCanvas.getBoundingClientRect(); const p={x:e.clientX-r.left,y:e.clientY-r.top};
  if(hoverIndex>=0) dragIndex=hoverIndex;
  else if(inside(p.x,p.y)){ pts.push(clampImg(canvasToImg(p))); dragIndex=pts.length-1; }
  draw();
});
window.addEventListener('mouseup', ()=>{ dragIndex=-1; draw(); });
imgCanvas.addEventListener('mouseleave', ()=>{ hoverIndex=-1; dragIndex=-1; draw(); });

window.addEventListener('keydown', (e)=>{
  if(e.key==='Delete'||e.key==='Backspace'){ if(pts.length>0){ pts.pop(); draw(); } }
  if(e.key.toLowerCase()==='c'&&(e.ctrlKey||e.metaKey)){ navigator.clipboard.writeText(JSON.stringify(buildPayload(true),null,2)); }
});
btnAutoOrder?.addEventListener('click', ()=>{ pts=autoOrderCW(pts); draw(); });
btnDeleteLast?.addEventListener('click', ()=>{ if(pts.length>0) pts.pop(); draw(); });
btnClear?.addEventListener('click', ()=>{ pts=[]; draw(); });

btnExport?.addEventListener('click', ()=>{
  const blob=new Blob([JSON.stringify(buildPayload(true),null,2)],{type:'application/json'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='points_payload.json'; a.click();
});

// ---------- Backend: Homography (optional demo hook) ----------
btnSend?.addEventListener('click', async ()=>{
  const body = buildPayload(true);
  if(!body.image_b64){ alert('No valid image to send'); return; }
  try{
    const res=await fetch(`${API_BASE}/estimate-homography`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
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

// ---------- Three.js ----------
let three=null;
(function initThree(){
  const threeCanvas=document.getElementById('threeCanvas');
  const renderer=new THREE.WebGLRenderer({canvas:threeCanvas,antialias:true});
  renderer.outputEncoding = THREE.sRGBEncoding;
  const scene=new THREE.Scene();
  scene.background=new THREE.Color(0x0b0d13);

  const rect=threeCanvas.getBoundingClientRect();
  const camera=new THREE.PerspectiveCamera(50, rect.width/rect.height, 0.01, 10000);
  camera.position.set(2.5,2.0,3.5);

  const controls=new THREE.OrbitControls(camera, threeCanvas);
  controls.enableDamping=true;

  const grid=new THREE.GridHelper(10,10,0x334466,0x223044); grid.position.y=0; scene.add(grid);
  const axes=new THREE.AxesHelper(1.2); scene.add(axes);

  function render(){
    const r=threeCanvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
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

  three={ renderer, scene, camera, controls,texLoader: new THREE.TextureLoader() };
})();

// ---------- Pose Recovery from 4 points ----------
// Maps 4 image points (clockwise) to a unit square on the floor plane (X,Z), Y=0,
// then decomposes H into [R|t] using intrinsics derived from the image size + fov.

btnPose?.addEventListener('click', ()=>{
  try {
    if (!hasImage || pts.length !== 4) {
      alert('Please select exactly 4 floor points (clockwise), then click Recover Pose.');
      return;
    }
    // 1) Ensure clockwise order
    const P = autoOrderCW(pts).map(p => [p.x, p.y]);

    // 2) Destination world points on plane Y=0, in meters (unit square)
    //    (X,Z): (0,0),(1,0),(1,1),(0,1)
    const Q = [
      [0,0], [1,0], [1,1], [0,1]
    ];

    // 3) Compute homography H such that K*[r1 r2 t] ~ H (world (X,Z,1) -> image (u,v,1))
    const H = computeHomography(Q, P); // from plane->image
    if (!H) throw new Error('Homography failed');

    // 4) Camera intrinsics from image size + assumed fov
    const fovDeg = three.camera.fov; // use preview camera fov as prior
    const fx = (imgW/2) / Math.tan((fovDeg*Math.PI/180)/2);
    const fy = fx;
    const cx = imgW/2, cy = imgH/2;
    const K = [
      [fx, 0,  cx],
      [0,  fy, cy],
      [0,  0,  1]
    ];

    const Kinv = inv3(K);

    // 5) Decompose H: H = K [r1 r2 t]
    const h1 = [H[0][0], H[1][0], H[2][0]];
    const h2 = [H[0][1], H[1][1], H[2][1]];
    const h3 = [H[0][2], H[1][2], H[2][2]];

    let r1 = mulMatVec(Kinv, h1);
    let r2 = mulMatVec(Kinv, h2);
    let t  = mulMatVec(Kinv, h3);

    const s = 1 / ((norm(r1) + norm(r2)) / 2);
    r1 = mulScalar(r1, s);
    r2 = mulScalar(r2, s);
    t  = mulScalar(t,  s);
    let r3 = cross(r1, r2);

    // Orthonormalize R via SVD-like correction
    let R = [[r1[0], r2[0], r3[0]],
             [r1[1], r2[1], r3[1]],
             [r1[2], r2[2], r3[2]]];
    R = orthonormalize(R);

    // Camera center C = -R^T t
    const Rt = transpose(R);
    const C = mulScalar(mulMatVec(Rt, t), -1);

    // 6) Apply pose to Three.js world:
    // World: Y up, floor plane Y=0 (X right, Z forward). Our unit square lies on Y=0.
    // Build a camera world matrix from R^T and C.
    const threeR = Rt; // world rotation
    const m = new THREE.Matrix4();
    m.set(
      threeR[0][0], threeR[0][1], threeR[0][2], C[0],
      threeR[1][0], threeR[1][1], threeR[1][2], C[1],
      threeR[2][0], threeR[2][1], threeR[2][2], C[2],
      0,0,0,1
    );
    three.camera.matrixAutoUpdate = false;
    three.camera.matrixWorld.copy(m);
    three.camera.matrixWorldInverse.copy(new THREE.Matrix4().copy(m).invert());
    three.camera.position.set(C[0], C[1], C[2]);

    // Aim the camera: look towards the plane’s center (0.5, 0, 0.5)
    const lookTarget = new THREE.Vector3(0.5, 0, 0.5);
    three.camera.lookAt(lookTarget);
    three.controls.target.copy(lookTarget);
    three.controls.update();

    setBackgroundFromCurrentImage();

    dbg('Pose OK:',
      { fx: fx.toFixed(2), fy: fy.toFixed(2), cx: cx.toFixed(1), cy: cy.toFixed(1) },
      { C: C.map(v=>+v.toFixed(3)) }
    );
    alert('Pose recovered and 3D view aligned.\nGrid = floor plane (Y=0). Unit = 1m.');
  } catch (err) {
    console.error(err);
    alert('Pose recovery failed: ' + err.message);
  }
});

// ---------- Linear algebra helpers ----------
function computeHomography(srcXY, dstUV){
  // srcXY: [[x,z],...] on plane (unit square). Homography maps (x,z,1)->(u,v,1)
  // dstUV: [[u,v],...]
  if (srcXY.length!==4 || dstUV.length!==4) return null;
  const A=[];
  for(let i=0;i<4;i++){
    const [x,z]=srcXY[i], [u,v]=dstUV[i];
    A.push([-x,-z,-1, 0, 0, 0, u*x, u*z, u]);
    A.push([ 0, 0, 0,-x,-z,-1, v*x, v*z, v]);
  }
  const h = solveHomography9(A);
  if(!h) return null;
  return [
    [h[0], h[1], h[2]],
    [h[3], h[4], h[5]],
    [h[6], h[7], h[8]]
  ];
}

function solveHomography9(A){
  // Solve Ah=0 with ||h||=1 via simple power-iteration on ATA (small 9x9)
  const ATA = matTmul(A, A); // 9x9
  // Smallest eigenvector of ATA → use inverse power iteration (approx via shifting)
  // For robustness here, we just take the eigenvector of the smallest diagonal after Jacobi-like sweeps (very light).
  // To keep this compact, we’ll fallback to numeric.js-less approach:
  // Use naive SVD via power iteration on inverse (regularize).
  const n=9, I=eye(n), eps=1e-6, lambda=1e-6;
  const M = add(ATA, mulMatScalar(I, lambda)); // regularized
  // Solve M x = b for random b, then normalize; iterate a few times to approach smallest eigenspace of ATA
  let x = Array(n).fill(0).map(()=>Math.random());
  normalizeVec(x);
  for(let k=0;k<40;k++){
    const y = solveSymmetricSPD(M, x); // approximate inverse multiply
    if(!y) break;
    normalizeVec(y);
    x = y;
  }
  return x;
}

function solveSymmetricSPD(M, b){
  // Conjugate Gradient (CG) for symmetric positive definite (regularized)
  const n=b.length;
  let x = new Array(n).fill(0);
  let r = subVec(b, mulMatVec(M,x));
  let p = r.slice();
  let rsold = dot(r,r);
  const maxIters = 200, tol=1e-10;
  for(let i=0;i<maxIters;i++){
    const Mp = mulMatVec(M,p);
    const alpha = rsold / Math.max(1e-20, dot(p,Mp));
    x = addVec(x, mulScalar(p, alpha));
    r = subVec(r, mulScalar(Mp, alpha));
    const rsnew = dot(r,r);
    if (Math.sqrt(rsnew) < tol) break;
    p = addVec(r, mulScalar(p, rsnew/rsold));
    rsold = rsnew;
  }
  return x;
}

function inv3(M){
  const a=M[0][0],b=M[0][1],c=M[0][2],
        d=M[1][0],e=M[1][1],f=M[1][2],
        g=M[2][0],h=M[2][1],i=M[2][2];
  const A = e*i - f*h;
  const B = -(d*i - f*g);
  const C = d*h - e*g;
  const D = -(b*i - c*h);
  const E = a*i - c*g;
  const F = -(a*h - b*g);
  const G = b*f - c*e;
  const H = -(a*f - c*d);
  const I = a*e - b*d;
  const det = a*A + b*B + c*C;
  if(Math.abs(det)<1e-12) throw new Error('Singular K');
  const invDet = 1/det;
  return [
    [A*invDet, D*invDet, G*invDet],
    [B*invDet, E*invDet, H*invDet],
    [C*invDet, F*invDet, I*invDet]
  ];
}

function mulMatVec(M,v){
  const out=new Array(M.length).fill(0);
  for(let r=0;r<M.length;r++){
    let s=0; for(let c=0;c<M[0].length;c++) s+=M[r][c]*v[c]; out[r]=s;
  }
  return out;
}
function matTmul(A,B){ // A^T * B
  const At = transpose(A);
  const n=At.length, m=B[0].length, k=At[0].length;
  const M = Array.from({length:n},()=>Array(m).fill(0));
  for(let i=0;i<n;i++){
    for(let j=0;j<m;j++){
      let s=0; for(let t=0;t<k;t++) s+=At[i][t]*B[t][j];
      M[i][j]=s;
    }
  }
  return M;
}
function transpose(M){ return M[0].map((_,c)=>M.map(row=>row[c])); }

function orthonormalize(R){
  // R: 3x3. Make it closest rotation via polar decomposition: R = US, return U
  // Compute S = sqrt(R^T R) via symmetric eigen-decomposition (here use one-step Newton)
  let RtR = matMul(transpose(R), R);
  // Newton-Schulz iteration for inverse sqrt
  let X = RtR;
  // Normalize
  const tr=trace(X); let a = tr/3; X = mulMatScalar(X, 1/a);
  let Y = eye(3);
  for(let k=0;k<10;k++){
    // Y_{k+1} = 0.5 * Y_k * (3I - X_k * Y_k^2)
    let Y2 = matMul(Y,Y);
    let XYY = matMul(X, Y2);
    let term = subMat(mulMatScalar(eye(3),3), XYY);
    Y = mulMatScalar(matMul(Y, term), 0.5);
  }
  const R_ortho = matMul(R, Y);
  return R_ortho;
}

function matMul(A,B){
  const n=A.length, m=B[0].length, k=A[0].length;
  const M = Array.from({length:n},()=>Array(m).fill(0));
  for(let i=0;i<n;i++){
    for(let j=0;j<m;j++){
      let s=0; for(let t=0;t<k;t++) s+=A[i][t]*B[t][j];
      M[i][j]=s;
    }
  }
  return M;
}
function eye(n){ const I=Array.from({length:n},()=>Array(n).fill(0)); for(let i=0;i<n;i++) I[i][i]=1; return I; }
function add(A,B){ const n=A.length,m=A[0].length; const C=Array.from({length:n},()=>Array(m).fill(0)); for(let i=0;i<n;i++) for(let j=0;j<m;j++) C[i][j]=A[i][j]+B[i][j]; return C; }
function mulMatScalar(A,s){ return A.map(row=>row.map(v=>v*s)); }
function subMat(A,B){ const n=A.length,m=A[0].length; const C=Array.from({length:n},()=>Array(m).fill(0)); for(let i=0;i<n;i++) for(let j=0;j<m;j++) C[i][j]=A[i][j]-B[i][j]; return C; }
function trace(M){ let s=0; for(let i=0;i<M.length;i++) s+=M[i][i]; return s; }

function dot(a,b){ let s=0; for(let i=0;i<a.length;i++) s+=a[i]*b[i]; return s; }
function norm(a){ return Math.sqrt(dot(a,a)); }
function cross(a,b){ return [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]]; }
function addVec(a,b){ return a.map((v,i)=>v+b[i]); }
function subVec(a,b){ return a.map((v,i)=>v-b[i]); }
function mulScalar(a,s){ return a.map(v=>v*s); }
function normalizeVec(a){ const n=norm(a); if(n>0) for(let i=0;i<a.length;i++) a[i]/=n; }

// ---------- keep loops alive ----------
(function animate(){ draw(); requestAnimationFrame(animate); })();
