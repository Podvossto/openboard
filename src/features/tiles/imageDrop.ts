// Drop picture files onto the board → image tiles. Big photos are downscaled so the board
// file stays small (the tile stores a data URL).
import type { ReactFlowInstance } from "@xyflow/react";
import { addTile } from "./addTile";
import { fitImage, isImageFile } from "./logic";

const MAX_PX = 1600;
const MAX_SVG_BYTES = 512 * 1024;

function readAsDataURL(f: Blob): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = () => rej(r.error);
    r.readAsDataURL(f);
  });
}

function loadImg(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = () => rej(new Error("not an image"));
    i.src = src;
  });
}

/** data URL + natural size; raster images larger than MAX_PX are re-encoded smaller. */
export async function prepareImage(f: File): Promise<{ src: string; w: number; h: number }> {
  const isSvg = /svg/i.test(f.type) || /\.svg$/i.test(f.name);
  if (isSvg && f.size > MAX_SVG_BYTES) throw new Error("SVG is larger than 512 KB");
  const src = await readAsDataURL(f);
  const img = await loadImg(src);
  const w = img.naturalWidth || 400;
  const h = img.naturalHeight || 300;
  if (isSvg || Math.max(w, h) <= MAX_PX) return { src, w, h };
  const k = MAX_PX / Math.max(w, h);
  const c = document.createElement("canvas");
  c.width = Math.round(w * k);
  c.height = Math.round(h * k);
  c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
  const type = /png|gif|webp/i.test(f.type) ? "image/png" : "image/jpeg";
  return { src: c.toDataURL(type, 0.86), w: c.width, h: c.height };
}

/** Make one image tile per dropped picture, cascading from the drop point. */
export async function dropImages(files: File[], rf: ReactFlowInstance, at: { x: number; y: number }): Promise<number> {
  let n = 0;
  for (const f of files.filter(isImageFile)) {
    try {
      const { src, w, h } = await prepareImage(f);
      const size = fitImage(w, h);
      const id = await addTile("image", rf, {
        title: f.name.replace(/\.[^.]+$/, ""),
        data: { src, name: f.name, w, h },
        at: { x: at.x + n * 28, y: at.y + n * 28 },
      });
      if (id) {
        const { useBoard } = await import("../../store/board");
        useBoard.getState().patchTile(id, { width: size.w, height: size.h });
      }
      n++;
    } catch {
      /* skip unreadable files */
    }
  }
  return n;
}
