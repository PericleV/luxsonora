// The open session, kept in this browser (IndexedDB) so nothing is lost when the page reloads:
// phones often close a tab in the background (when you pick a photo, switch apps or memory runs
// low) and load it again from scratch when you come back. The picture is stored once per picture
// (its original file, or which demo), the settings, the path and the neural results after every
// change. Nothing leaves the device.
const DB = "luxsonora", STORE = "session", VERSION = 1;
let dbp = null;
function db() {
  if (!dbp) dbp = new Promise((res, rej) => {
    if (typeof indexedDB === "undefined") { rej(new Error("no IndexedDB")); return; }
    const r = indexedDB.open(DB, VERSION);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}
async function put(key, value) {
  const d = await db();
  return new Promise((res, rej) => { const tx = d.transaction(STORE, "readwrite"); tx.objectStore(STORE).put(value, key); tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); });
}
async function get(key) {
  const d = await db();
  return new Promise((res, rej) => { const tx = d.transaction(STORE, "readonly"), q = tx.objectStore(STORE).get(key); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
}
export async function clearSession() { try { await put("state", null); } catch (e) { /* storage unavailable */ } }

// image: { hash, demo } or { hash, file (a File or Blob), name, type }; state: settings, path, neural
let lastImage = null;
export async function saveSession(image, state) {
  try {
    if (image && image.hash && image.hash !== lastImage) {
      await put("image", image.file ? { hash: image.hash, file: image.file, name: image.name, type: image.type } : { hash: image.hash, demo: image.demo });
      lastImage = image.hash;
    }
    await put("state", { ...state, imageHash: image ? image.hash : null, savedAt: Date.now() });
    return true;
  } catch (e) { return false; }
}
// The saved session, if there is one from the last two weeks with its picture.
export async function loadSession() {
  try {
    const state = await get("state"); if (!state || !state.imageHash || Date.now() - (state.savedAt || 0) > 14 * 864e5) return null;
    const image = await get("image"); if (!image || image.hash !== state.imageHash) return null;
    lastImage = image.hash;
    return { state, image };
  } catch (e) { return null; }
}
