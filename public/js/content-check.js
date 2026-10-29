// Conservative checks, shared by server and editor. They do not prove semantic equivalence.
export function protectedNumbers(text) {
  return [...new Set(text.match(/\d+(?:[.,]\d+)*\s*(?:%|분|초|명|개|원|배|시간|일|개월|년|kg|ms|GB)?/g) || [])].map(n => n.replace(/\s/g, ""))
}
export function checkRevision(beforeText, afterText) {
  const before = protectedNumbers(beforeText), after = protectedNumbers(afterText)
  const numeric = [...before.filter(n => !after.includes(n)).map(n => `수치·단위 누락/변경: ${n}`), ...after.filter(n => !before.includes(n)).map(n => `새 수치·단위: ${n}`)]
  const warnings = [...numeric]
  for (const [pattern, label] of [[/않|못|없|아니|미검증/, "부정 표현"], [/경우|만|이상|미만|조건/, "조건"], [/한계|일반화|표본|검증/, "한계·검증 범위"]]) {
    if (pattern.test(beforeText) && !pattern.test(afterText)) warnings.push(`${label} 보존 확인 필요`)
  }
  return { warnings, blocked: numeric.length > 0 || !afterText.trim(), reviewRequired: true }
}
