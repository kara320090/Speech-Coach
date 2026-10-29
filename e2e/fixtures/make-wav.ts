/** 테스트용 16kHz 모노 WAV를 만든다. parts: [길이(초), 소리 있음 여부] 순서대로 이어 붙인다. 저장소에 소리 파일을 두지 않기 위해 실행할 때 만든다. */
export function makeWav(parts: Array<[number, boolean]>, rate = 16000): Buffer {
  const total = parts.reduce((a, [sec]) => a + Math.round(sec * rate), 0)
  const buf = Buffer.alloc(44 + total * 2)
  buf.write("RIFF", 0, "latin1")
  buf.writeUInt32LE(36 + total * 2, 4)
  buf.write("WAVEfmt ", 8, "latin1")
  buf.writeUInt32LE(16, 16)
  buf.writeUInt16LE(1, 20)
  buf.writeUInt16LE(1, 22)
  buf.writeUInt32LE(rate, 24)
  buf.writeUInt32LE(rate * 2, 28)
  buf.writeUInt16LE(2, 32)
  buf.writeUInt16LE(16, 34)
  buf.write("data", 36, "latin1")
  buf.writeUInt32LE(total * 2, 40)
  let i = 0
  for (const [sec, voiced] of parts) {
    const n = Math.round(sec * rate)
    for (let k = 0; k < n; k++, i++) {
      // 소리 있는 구간은 200Hz 사인파에 느린 떨림을 얹어 말소리처럼 크기가 변하게 한다.
      const v = voiced ? Math.sin((2 * Math.PI * 200 * k) / rate) * (0.25 + 0.15 * Math.sin((2 * Math.PI * 3 * k) / rate)) : 0
      buf.writeInt16LE(Math.round(v * 32767), 44 + i * 2)
    }
  }
  return buf
}
