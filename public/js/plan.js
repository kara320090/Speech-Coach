// 구간별 시간 계획: 입력 해석, 진행 비교, 결과 정리.
import { parseDuration } from "./time.js"

/**
 * 한 줄에 한 구간. 줄 끝의 길이를 시간으로 읽는다.
 * 예: "도입 2:00", "본론, 3분 30초", "마무리 45초"
 */
export function parsePlan(text) {
  const sections = []
  const errors = []
  const lines = String(text ?? "").split(/\r?\n/)
  lines.forEach((raw, i) => {
    const line = raw.trim()
    if (!line) return
    const m = line.match(/^(.*?)[\s,]*((?:\d+:[0-5]\d)|(?:\d+\s*분(?:\s*\d+\s*초)?)|(?:\d+\s*초))$/)
    const planSec = m ? parseDuration(m[2].trim()) : null
    const title = m ? m[1].trim() : ""
    if (!m || planSec === null || planSec <= 0 || !title) {
      errors.push({ line: i + 1, text: line, message: `${i + 1}번째 줄을 읽지 못했어요. "구간 이름 2:30" 또는 "구간 이름 2분 30초"처럼 적어 주세요.` })
      return
    }
    sections.push({ title, planSec })
  })
  return { sections, errors }
}

export function planTotal(sections) {
  return sections.reduce((a, s) => a + s.planSec, 0)
}

/** 같은 조건인지 비교할 때 쓰는 구간 계획의 서명. */
export function planSignature(sections) {
  return sections.map((s) => `${s.title}|${s.planSec}`).join(";")
}

/**
 * 지금 진행 상태를 계획과 비교한다.
 * marks = 이미 끝낸 구간들의 종료 시점(연습 경과 초).
 * 구간 계획이 없으면 판단하지 않는다(known: false).
 */
export function paceAt(elapsedSec, sections, marks) {
  if (!sections.length) {
    return { known: false, reason: "구간 시간 계획이 없어서 진행이 빠른지 느린지 판단하지 않아요." }
  }
  const k = marks.length
  if (k >= sections.length) {
    return { known: true, finished: true, text: "모든 구간을 끝냈어요." }
  }
  const startSec = k === 0 ? 0 : marks[k - 1]
  const plannedLen = sections[k].planSec
  const inSection = elapsedSec - startSec
  const plannedCum = sections.slice(0, k).reduce((a, s) => a + s.planSec, 0)
  const driftSec = k === 0 ? 0 : startSec - plannedCum
  return {
    known: true,
    finished: false,
    sectionIndex: k,
    title: sections[k].title,
    plannedLen,
    inSection,
    overBy: inSection - plannedLen,
    driftSec,
  }
}

/**
 * 연습이 끝난 뒤 구간별 계획과 실제를 정리한다.
 * - marks[i] = i번째 구간을 끝냈다고 누른 시점
 * - 마지막으로 누른 뒤 연습을 끝냈으면 그 구간은 종료 시점까지로 본다
 * - 시작하지 못한 구간은 actualSec = null
 */
export function sectionResults(sections, marks, totalSec) {
  const rows = []
  let cursor = 0
  sections.forEach((s, i) => {
    if (i < marks.length) {
      const end = marks[i]
      rows.push({ title: s.title, planSec: s.planSec, startSec: cursor, endSec: end, actualSec: end - cursor, diffSec: end - cursor - s.planSec, status: "done" })
      cursor = end
    } else if (i === marks.length) {
      rows.push({ title: s.title, planSec: s.planSec, startSec: cursor, endSec: totalSec, actualSec: totalSec - cursor, diffSec: totalSec - cursor - s.planSec, status: "ended-during" })
      cursor = totalSec
    } else {
      rows.push({ title: s.title, planSec: s.planSec, startSec: null, endSec: null, actualSec: null, diffSec: null, status: "not-started" })
    }
  })
  return rows
}
