// 연습 기록 저장. 브라우저 안(IndexedDB)에만 저장하고 서버로 보내지 않는다.
// 저장에 실패하면 이 화면이 열려 있는 동안만 볼 수 있도록 메모리에 둔다.

const DB_NAME = "speech-coach"
const STORE = "sessions"
const memory = new Map()

function openDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") return reject(new Error("이 브라우저는 기록 저장을 지원하지 않아요."))
    let req
    try {
      req = indexedDB.open(DB_NAME, 1)
    } catch (e) {
      return reject(e)
    }
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" })
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error || new Error("기록 저장소를 열지 못했어요."))
    req.onblocked = () => reject(new Error("기록 저장소가 다른 탭에서 사용 중이에요."))
  })
}

function tx(db, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode)
    const r = fn(t.objectStore(STORE))
    t.oncomplete = () => resolve(r && "result" in r ? r.result : undefined)
    t.onerror = () => reject(t.error)
    t.onabort = () => reject(t.error || new Error("저장이 취소됐어요."))
  })
}

/** 반환: { ok: true } 또는 { ok: false, error } — 실패해도 메모리에는 남긴다. */
export async function saveSession(session) {
  memory.set(session.id, session)
  try {
    const db = await openDb()
    await tx(db, "readwrite", (s) => s.put(session))
    db.close()
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e?.message || String(e) }
  }
}

export async function getSession(id) {
  try {
    const db = await openDb()
    const found = await tx(db, "readonly", (s) => s.get(id))
    db.close()
    if (found) return found
  } catch {
    /* 메모리에서 찾는다 */
  }
  return memory.get(id) || null
}

/** 최신순 목록. 저장소를 못 열면 메모리에 있는 것만 준다. */
export async function listSessions() {
  let stored = []
  let error = null
  try {
    const db = await openDb()
    stored = (await tx(db, "readonly", (s) => s.getAll())) || []
    db.close()
  } catch (e) {
    error = e?.message || String(e)
  }
  const map = new Map(stored.map((s) => [s.id, s]))
  for (const [id, s] of memory) if (!map.has(id)) map.set(id, s)
  return { sessions: [...map.values()].sort((a, b) => b.createdAt - a.createdAt), error }
}

export async function deleteSession(id) {
  memory.delete(id)
  try {
    const db = await openDb()
    await tx(db, "readwrite", (s) => s.delete(id))
    db.close()
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e?.message || String(e) }
  }
}
