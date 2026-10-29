// Independent database: existing recorded sessions and schema are untouched.
const DB = "speech-coach-understanding"
let volatile = null
async function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => req.result.createObjectStore("workspaces", { keyPath: "id" })
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
    req.onblocked = () => reject(new Error("다른 탭의 저장 작업을 확인해 주세요."))
  })
}
async function transact(mode, action) {
  const db = await open()
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction("workspaces", mode)
      const request = action(tx.objectStore("workspaces"))
      tx.oncomplete = () => resolve(request.result)
      tx.onerror = tx.onabort = () => reject(tx.error)
    })
  } finally { db.close() }
}
export async function loadWorkspace() {
  try { return await transact("readonly", s => s.get("current")) || volatile } catch { return volatile }
}
export async function saveWorkspace(state) {
  volatile = structuredClone(state)
  try { await transact("readwrite", s => s.put(volatile)); return true } catch { return false }
}
export async function deleteWorkspace() {
  try { await transact("readwrite", s => s.delete("current")); volatile = null; return true } catch { return false }
}
