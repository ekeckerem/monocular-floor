# backend/main.py — Step 3: homography + pose (K, R, t) + three_pose
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, validator
from typing import List, Optional
import base64, re, math
import numpy as np
import cv2

app = FastAPI(title="Monocular Floor API (Step 3)")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], allow_credentials=True,
    allow_methods=["*"], allow_headers=["*"],
)

class Point(BaseModel):
    x: int
    y: int

class ImgSize(BaseModel):
    width: int
    height: int

class EstimateRequest(BaseModel):
    image_size: ImgSize
    points_img: List[Point]
    include_image: bool = False
    image_b64: Optional[str] = None

    @validator("points_img")
    def need_points(cls, v):
        if len(v) < 4:
            raise ValueError("Need at least 4 points to compute a homography.")
        return v

def decode_data_url_image(data_url: str):
    m = re.match(r"^data:image/[^;]+;base64,(.+)$", data_url or "")
    if not m:
        raise ValueError("image_b64 must be a data URL like data:image/png;base64,...")
    b = base64.b64decode(m.group(1))
    arr = np.frombuffer(b, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("Failed to decode image.")
    return img

def order_ring_clockwise_start_tl(q: np.ndarray) -> np.ndarray:
    q = q.astype(np.float32)
    c = q.mean(axis=0)
    ang = np.arctan2(q[:,1] - c[1], q[:,0] - c[0])
    idx_cw = np.argsort(ang)[::-1]
    q = q[idx_cw]
    tl_i = int(np.argmin(q[:,0] + q[:,1]))
    return np.roll(q, -tl_i, axis=0)

def pick_four_corners(pts_all: np.ndarray) -> np.ndarray:
    hull = cv2.convexHull(pts_all.astype(np.float32)).reshape(-1,2)
    if len(hull) == 4:
        return order_ring_clockwise_start_tl(hull)
    # fallback: unique extrema by sums/diffs
    s = pts_all.sum(axis=1); d = pts_all[:,0] - pts_all[:,1]
    chosen = []
    for idx in [np.argmin(s), np.argmax(s)]:
        i = int(idx);
        if i not in chosen: chosen.append(i)
    rem = [i for i in range(len(pts_all)) if i not in chosen]
    if len(rem) >= 2:
        rem = np.array(rem)
        for idx in [rem[int(np.argmin(d[rem]))], rem[int(np.argmax(d[rem]))]]:
            i = int(idx);
            if i not in chosen: chosen.append(i)
    q = pts_all[chosen][:4]
    return order_ring_clockwise_start_tl(q)

def homography_from_points(pts: np.ndarray):
    quad4 = pick_four_corners(pts)  # TL,TR,BR,BL
    tl, tr, br, bl = quad4
    w_top  = np.linalg.norm(tr - tl)
    w_bot  = np.linalg.norm(br - bl)
    h_left = np.linalg.norm(bl - tl)
    h_right= np.linalg.norm(br - tr)
    W = int(max(64, round(max(w_top, w_bot))))
    H = int(max(64, round(max(h_left, h_right))))
    dst = np.array([[0,0],[W-1,0],[W-1,H-1],[0,H-1]], dtype=np.float32)
    H_p2i = cv2.getPerspectiveTransform(dst, quad4)
    H_i2p = cv2.getPerspectiveTransform(quad4, dst)
    return quad4, (W,H), H_p2i, H_i2p

def f_from_vps(v1, v2, cx, cy):
    du = (v1[0]-cx)*(v2[0]-cx)
    dv = (v1[1]-cy)*(v2[1]-cy)
    f2 = -(du + dv)
    return None if f2 <= 1e-6 else float(math.sqrt(f2))

def pose_from_H(H, Himg, Wimg):
    v1 = (H @ np.array([1,0,0.0])).ravel(); v1 /= v1[2]
    v2 = (H @ np.array([0,1,0.0])).ravel(); v2 /= v2[2]
    cx, cy = Wimg/2.0, Himg/2.0
    f = f_from_vps(v1, v2, cx, cy)
    if f is None: f = 1.2*max(Wimg, Himg)
    K = np.array([[f,0,cx],[0,f,cy],[0,0,1]], dtype=np.float64)
    Kinv = np.linalg.inv(K)
    h1, h2, h3 = H[:,0], H[:,1], H[:,2]
    lam = 1.0/np.linalg.norm(Kinv @ h1)
    r1 = lam*(Kinv @ h1); r2 = lam*(Kinv @ h2); r3 = np.cross(r1, r2)
    R_approx = np.column_stack([r1, r2, r3])
    U,_,Vt = np.linalg.svd(R_approx)
    R = U @ Vt
    if np.linalg.det(R) < 0: R[:,2] *= -1
    t = lam*(Kinv @ h3)

    C_cv = -R.T @ t
    B = np.diag([1.0, -1.0, -1.0])  # cv -> three basis
    R_cw_three = B @ R.T @ B
    C_three = B @ C_cv
    qw = math.sqrt(max(0.0, 1.0 + np.trace(R_cw_three)))/2.0
    qx = (R_cw_three[2,1]-R_cw_three[1,2])/(4*qw + 1e-12)
    qy = (R_cw_three[0,2]-R_cw_three[2,0])/(4*qw + 1e-12)
    qz = (R_cw_three[1,0]-R_cw_three[0,1])/(4*qw + 1e-12)
    fov_y_deg = 2.0*math.degrees(math.atan((Himg*0.5)/f))
    return K, R, t, C_cv, (C_three, (qx,qy,qz,qw), fov_y_deg)

def to_data_url(img_bgr: np.ndarray, mime="image/png") -> str:
    ext = ".png" if mime.endswith("png") else ".jpg"
    ok, buf = cv2.imencode(ext, img_bgr)
    if not ok: raise RuntimeError("encode fail")
    b64 = base64.b64encode(buf).decode("ascii")
    return f"data:{mime};base64,{b64}"

@app.get("/")
def root():
    return {"ok": True, "msg": "backend step 3 is running"}

@app.post("/estimate-homography")
def estimate_homography(req: EstimateRequest):
    pts = np.array([[p.x,p.y] for p in req.points_img], dtype=np.float32)
    quad4, (Wrect,Hrect), H_p2i, H_i2p = homography_from_points(pts)
    resp = {
        "status":"ok",
        "ordered_points": quad4.tolist(),
        "rect_size": {"width":Wrect,"height":Hrect},
        "H_plane2img": H_p2i.tolist(),
        "H_img2plane": H_i2p.tolist(),
    }
    if req.include_image and req.image_b64:
        img = decode_data_url_image(req.image_b64)
        rectified = cv2.warpPerspective(img, H_i2p, (Wrect, Hrect))
        overlay = img.copy()
        cv2.polylines(overlay, [quad4.astype(np.int32)], True, (0,255,255), 3, cv2.LINE_AA)
        resp["rectified_image"] = to_data_url(rectified,"image/png")
        resp["overlay_image"]   = to_data_url(overlay,"image/jpeg")
    return resp

@app.post("/estimate-pose")
def estimate_pose(req: EstimateRequest):
    Wimg, Himg = req.image_size.width, req.image_size.height
    pts = np.array([[p.x,p.y] for p in req.points_img], dtype=np.float32)
    quad4, (Wrect,Hrect), H_p2i, H_i2p = homography_from_points(pts)
    K, R, t, C_cv, three = pose_from_H(H_p2i.astype(np.float64), Himg, Wimg)
    C_three, quat, fov_y = three
    return {
        "status":"ok",
        "image_size":{"width":Wimg,"height":Himg},
        "rect_size":{"width":Wrect,"height":Hrect},
        "K": K.tolist(), "R": R.tolist(), "t": t.tolist(),
        "three_pose":{
            "position":[float(C_three[0]),float(C_three[1]),float(C_three[2])],
            "quaternion":[float(quat[0]),float(quat[1]),float(quat[2]),float(quat[3])],
            "fov_y_deg": fov_y,
        },
        "ordered_points": quad4.tolist()
    }
