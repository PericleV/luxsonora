// Decoding worker: keeps the interface responsive while large files are decoded.
import { ingestBuffer } from "./pipeline.js";

// handshake: tells the page the worker script actually started
self.postMessage({ ready: true });

self.onmessage = async e => {
  const { id, buf, name, limits } = e.data;
  try {
    const res = await ingestBuffer(buf, name, limits, p => self.postMessage({ id, progress: p }));
    self.postMessage({ id, result: res }, [res.base.data.buffer]);
  } catch (err) {
    self.postMessage({ id, error: { message: err.message || String(err), code: err.code || "decode_failed" } });
  }
};
