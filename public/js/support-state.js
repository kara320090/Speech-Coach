import { workspaceWithGeneratedDraft } from "./draft-workspace.js"

export const PRACTICE_SETTINGS_KEY = "dasibom.settings"
export const RESTORE_SUPPORT_KEY = "dasibom.support-restore"
export function scriptChunks(script, max = 2400) {
  const chunks = []
  for (let start = 0; start < script.length;) {
    let end = Math.min(script.length, start + max)
    if (end < script.length) { const line = script.lastIndexOf("\n", end - 1); if (line > start) end = line + 1 }
    chunks.push({ start, end, text: script.slice(start, end) }); start = end
  }
  return chunks
}
export function replaceSelectedChunk(full, chunk, revised) {
  if (!chunk || full.slice(chunk.start, chunk.end) !== chunk.text || !revised.trim()) throw new Error("대본이 바뀌었어요. 적용할 부분을 다시 확인해 주세요.")
  const leading = chunk.text.match(/^\s*/)[0], trailing = chunk.text.match(/\s*$/)[0]
  return full.slice(0, chunk.start) + leading + revised.trim() + trailing + full.slice(chunk.end)
}
export function supportWorkspace(previous, original, revised, sources, metadata) {
  const baseline = workspaceWithGeneratedDraft(previous, { script: original, sources, model: metadata.model, requestId: metadata.requestId }, `${metadata.versionId}-original`, metadata.createdAt)
  baseline.versions.at(-1).origin = "support-original"
  delete baseline.versions.at(-1).model
  const next = workspaceWithGeneratedDraft(baseline, { script: revised, sources, model: metadata.model, requestId: metadata.requestId }, metadata.versionId, metadata.createdAt)
  next.versions.at(-1).origin = metadata.origin || "gemini-support-rewrite" // 자체 AI 문단 수정은 "self-hosted-segment-revision"
  next.versions.at(-1).practiceId = metadata.practiceId || null
  return next
}
export function observationTexts(session, itemId) {
  const items = session?.analysis?.items || []
  return (itemId ? items.filter(i => i.id === itemId) : items).slice(0, 8).map(i => ({ source: "measurement", text: `${Math.floor(i.startSec || 0)}~${Math.ceil(i.endSec || i.startSec || 0)}초 · ${i.title} · ${i.measured} · ${i.basis || ""}`.slice(0, 300) }))
}
