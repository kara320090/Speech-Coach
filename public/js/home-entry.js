// 기본 주소는 새 스튜디오. 기존 저장 기록의 /#/result/ID 등 해시 경로도 유지한다.
const legacy = location.hash.startsWith("#/")
// 같은 페이지의 해시 링크로 두 화면을 오갈 때만 다시 부팅한다.
window.addEventListener("hashchange", () => {
  if (location.hash.startsWith("#/") !== legacy) location.reload()
})
const root = document.getElementById("root")
if (legacy) {
  root.id = "app"
  root.tabIndex = -1
}
const styles = legacy ? ["/nocturne.css", "/styles.css", "/script.css"] : ["/studio.css"]
await Promise.all(styles.map(href => new Promise((resolve, reject) => {
  const link = document.createElement("link")
  link.rel = "stylesheet"
  link.href = href
  link.onload = resolve
  link.onerror = reject
  document.head.append(link)
})))
if (legacy) await import("./app.js")
else await import("./studio-page.js")
