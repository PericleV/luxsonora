// Neural placement: attention maps from TensorFlow.js models, downloaded when first chosen.
//   objects: COCO-SSD (SSDLite MobileNet v2, 80 classes). Each detection adds a Gaussian over its
//            box (people weighted toward the head, where eyes go first); the detections also
//            become objects whose category (living, natural, artificial) colours the timbre.
//   learned: MSI-Net (Kroner et al. 2020), trained on eye-tracking data (SALICON), predicts the
//            probability of fixation for every pixel.
// Maps are quantized to 8 bits before use and stored in the recipe, so a path does not depend
// on the graphics card that computed it.
import { tfReady } from "./magenta.js";
import { normalize, borderFade, resize } from "../core/placement.js";

export const COCO_URL = "https://storage.googleapis.com/tfjs-models/savedmodel/ssdlite_mobilenet_v2/model.json";
export const MSI_URL = "https://storage.googleapis.com/msi-net/model/medium/model.json";
const MSI_DIMS = [120, 160]; // height, width of the medium model's input

// COCO class ids (1-90) → name; gaps are unused ids.
const COCO = { 1: "person", 2: "bicycle", 3: "car", 4: "motorcycle", 5: "airplane", 6: "bus", 7: "train", 8: "truck", 9: "boat", 10: "traffic light", 11: "fire hydrant", 13: "stop sign", 14: "parking meter", 15: "bench", 16: "bird", 17: "cat", 18: "dog", 19: "horse", 20: "sheep", 21: "cow", 22: "elephant", 23: "bear", 24: "zebra", 25: "giraffe", 27: "backpack", 28: "umbrella", 31: "handbag", 32: "tie", 33: "suitcase", 34: "frisbee", 35: "skis", 36: "snowboard", 37: "sports ball", 38: "kite", 39: "baseball bat", 40: "baseball glove", 41: "skateboard", 42: "surfboard", 43: "tennis racket", 44: "bottle", 46: "wine glass", 47: "cup", 48: "fork", 49: "knife", 50: "spoon", 51: "bowl", 52: "banana", 53: "apple", 54: "sandwich", 55: "orange", 56: "broccoli", 57: "carrot", 58: "hot dog", 59: "pizza", 60: "donut", 61: "cake", 62: "chair", 63: "couch", 64: "potted plant", 65: "bed", 67: "dining table", 70: "toilet", 72: "tv", 73: "laptop", 74: "mouse", 75: "remote", 76: "keyboard", 77: "cell phone", 78: "microwave", 79: "oven", 80: "toaster", 81: "sink", 82: "refrigerator", 84: "book", 85: "clock", 86: "vase", 87: "scissors", 88: "teddy bear", 89: "hair drier", 90: "toothbrush" };
export const categoryOf = id => (id >= 1 && id <= 1) || (id >= 16 && id <= 25) ? "living" : (id >= 52 && id <= 57) || id === 64 ? "natural" : "artificial";

const models = new Map();
async function graph(url) {
  if (!models.has(url)) {
    const p = (async () => { const tf = await tfReady(); return { tf, model: await tf.loadGraphModel(url) }; })();
    p.catch(() => models.delete(url));
    models.set(url, p);
  }
  return models.get(url);
}
const quantize = m => { const q = new Uint8Array(m.length); for (let i = 0; i < m.length; i++) q[i] = Math.round(Math.min(1, Math.max(0, m[i])) * 255); return q; };
export const dequantize = q => { const m = new Float32Array(q.length); for (let i = 0; i < q.length; i++) m[i] = q[i] / 255; return m; };

// canvas: the displayed (processed) image; W, H: the analysis size. Returns { q (Uint8 map), objects }.
export async function objectsMap(canvas, W, H) {
  const { tf, model } = await graph(COCO_URL);
  const input = tf.tidy(() => tf.browser.fromPixels(canvas).expandDims(0));
  const res = await model.executeAsync(input);
  input.dispose();
  const scores = res[0].dataSync(), boxes = res[1].dataSync(), nBox = res[0].shape[1], nCls = res[0].shape[2];
  res.forEach(t => t.dispose());
  const flat = [], best = [], cls = [];
  for (let i = 0; i < nBox; i++) {
    let bs = -1, bc = 0;
    for (let c = 0; c < nCls; c++) if (scores[i * nCls + c] > bs) { bs = scores[i * nCls + c]; bc = c; }
    best.push(bs); cls.push(bc + 1); flat.push(boxes[i * 4], boxes[i * 4 + 1], boxes[i * 4 + 2], boxes[i * 4 + 3]);
  }
  const bt = tf.tensor2d(flat, [nBox, 4]), st = tf.tensor1d(best);
  const keepT = await tf.image.nonMaxSuppressionAsync(bt, st, 20, 0.5, 0.35);
  const keep = Array.from(keepT.dataSync()); bt.dispose(); st.dispose(); keepT.dispose();
  const objects = keep.filter(i => COCO[cls[i]]).map(i => {
    const [y0, x0, y1, x1] = flat.slice(i * 4, i * 4 + 4).map(v => Math.min(1, Math.max(0, v)));
    return { name: COCO[cls[i]], category: categoryOf(cls[i]), importance: +best[i].toFixed(3), x: +x0.toFixed(4), y: +y0.toFixed(4), w: +(x1 - x0).toFixed(4), h: +(y1 - y0).toFixed(4) };
  });
  const map = new Float32Array(W * H);
  for (const o of objects) {
    // a Gaussian over the box; for people the centre moves up to the head
    const cx = (o.x + o.w / 2) * W, cy = (o.y + (o.name === "person" ? 0.18 : 0.5) * o.h) * H;
    const sx = Math.max(1.5, (o.w * W) / (o.name === "person" ? 4 : 3)), sy = Math.max(1.5, (o.h * H) / (o.name === "person" ? 6 : 3)), wgt = o.importance * (o.name === "person" ? 1.4 : 1);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) map[y * W + x] += wgt * Math.exp(-((x - cx) ** 2 / (2 * sx * sx) + (y - cy) ** 2 / (2 * sy * sy)));
  }
  return { q: quantize(normalize(map)), objects };
}

export async function learnedMap(canvas, W, H) {
  const { tf, model } = await graph(MSI_URL);
  const out = tf.tidy(() => {
    const img = tf.browser.fromPixels(canvas).toFloat().expandDims(0);
    const x = tf.clipByValue(tf.image.resizeBilinear(img, MSI_DIMS, true), 0, 255);
    return model.predict(x);
  });
  const t = Array.isArray(out) ? out[0] : out, data = await t.data(), shape = t.shape;
  (Array.isArray(out) ? out : [out]).forEach(o => o.dispose());
  const h = shape[1], w = shape[2];
  const map = resize(Float32Array.from(data), w, h, W, H);
  return { q: quantize(borderFade(normalize(map), W, H, 0.3, 0.06)), objects: [] };
}
