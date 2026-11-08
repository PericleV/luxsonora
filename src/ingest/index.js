// Main-thread entry point for loading images.
import IngestWorker from "./ingest.worker.js?worker&inline";
import { ingestBuffer, DEFAULT_LIMITS } from "./pipeline.js";
import { fromRGBA8 } from "./decode.js";

export { fromRGBA8 };

// Phones and low-memory devices get a lower pixel limit.
export function deviceLimits() {
  const mem = navigator.deviceMemory, mobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
  return (mem && mem <= 4) || mobile ? { warnMP: 40, maxMP: 60 } : DEFAULT_LIMITS;
}

let worker = null, seq = 0, pendingReject = null;
const canUseWorker = () => typeof Worker !== "undefined" && typeof OffscreenCanvas !== "undefined";

// Cancels whatever is being decoded.
export function cancelIngest() {
  if (worker) { worker.terminate(); worker = null; }
  if (mainToken) mainToken.cancelled = true;
  if (pendingReject) { const r = pendingReject; pendingReject = null; r(Object.assign(new Error("Cancelled"), { code: "cancelled" })); }
}

// Uses the worker when it can start; pages with an opaque origin (data: URLs, some
// sandboxes) refuse inline workers, and then decoding runs on the main thread.
let workerBroken = false, mainToken = null;
function onMain(buf, name, limits, onProgress) {
  const token = mainToken = {};
  return ingestBuffer(buf, name, limits, p => { if (token.cancelled) throw Object.assign(new Error("Cancelled"), { code: "cancelled" }); onProgress(p); });
}
export async function ingestFile(file, onProgress = () => {}) {
  const limits = deviceLimits();
  if (workerBroken || !canUseWorker()) { cancelIngest(); return onMain(await file.arrayBuffer(), file.name, limits, onProgress); }
  try {
    return await viaWorker(await file.arrayBuffer(), file.name, limits, onProgress);
  } catch (e) {
    if (e.code !== "worker_failed") throw e;
    workerBroken = true;
    return onMain(await file.arrayBuffer(), file.name, limits, onProgress);
  }
}

function viaWorker(buf, name, limits, onProgress) {
  cancelIngest();
  let w;
  try { w = worker = new IngestWorker(); } catch (e) { return Promise.reject(Object.assign(new Error("worker"), { code: "worker_failed" })); }
  const id = ++seq;
  return new Promise((resolve, reject) => {
    let heard = false;
    pendingReject = reject;
    // some origins block the worker silently; without a handshake in time, fall back
    const watchdog = setTimeout(() => { if (!heard) { done(); reject(Object.assign(new Error("worker"), { code: "worker_failed" })); } }, 1500);
    const done = () => { clearTimeout(watchdog); pendingReject = null; w.terminate(); if (worker === w) worker = null; };
    w.onmessage = e => {
      const m = e.data;
      if (m.ready) { heard = true; return; }
      if (m.id !== id) return;
      heard = true;
      if (m.progress !== undefined) onProgress(m.progress);
      else if (m.error) { done(); reject(Object.assign(new Error(m.error.message), { code: m.error.code })); }
      else { done(); resolve(m.result); }
    };
    // an error before the worker has said anything means it could not start at all
    w.onerror = e => { e.preventDefault?.(); done(); reject(Object.assign(new Error(e.message || "The decoder stopped unexpectedly."), { code: heard ? "decode_failed" : "worker_failed" })); };
    w.postMessage({ id, buf, name, limits }, [buf]);
  });
}
