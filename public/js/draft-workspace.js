// Keep prior drafts and answer history when a user explicitly applies a new generated draft.
export function workspaceWithGeneratedDraft(previous, draft, versionId, createdAt) {
  if (typeof draft.script !== "string" || draft.script.trim().length < 3 || draft.script.length > 2400 || typeof draft.sources !== "string" || draft.sources.length > 2400) throw new Error("초안의 길이와 자료를 확인해 주세요.")
  const before = previous?.id === "current" ? structuredClone(previous) : {}
  const versions = Array.isArray(before.versions) ? before.versions : []
  if (before.script && !versions.some(v => v.script === before.script && v.sources === before.sources)) versions.push({ id: before.versionId || `${versionId}-previous`, script: before.script, sources: before.sources || "", createdAt })
  versions.push({ id: versionId, script: draft.script.trim(), sources: draft.sources, createdAt, origin: "gemini-generation", model: draft.model, sourceRequestId: draft.requestId, humanReview: "confirmed" })
  return { ...before, id: "current", versions, attempts: Array.isArray(before.attempts) ? before.attempts : [], script: draft.script.trim(), sources: draft.sources, versionId, question: "이 대본에서 전달하려는 내용을 자기 말로 설명해 보세요.", concept: null, reference: "", helpUsed: false, followups: 0 }
}
