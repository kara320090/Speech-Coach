import {test,expect} from '@playwright/test'
import path from 'node:path'
// This invented script checks storage/transport only; it is not a transcript of the real clip.
const SCRIPT='연결 상태를 확인하는 가상 대본입니다.\n\n두 번째 문단은 그대로 보존합니다.'
test('실제 영상 분석 기록·대본·근거를 스튜디오로 가져와 수동 위치를 확인한다',async({page})=>{
 let transcriptions=0;const errors:string[]=[]
 page.on('request',r=>{if(r.method()==='POST'&&r.url().endsWith('/api/transcribe'))transcriptions++})
 page.on('pageerror',e=>errors.push(e.message))
 await page.goto('/studio.html')
 await page.getByRole('button',{name:'바로 서비스 이용하기'}).click()
 await page.getByLabel('발표 대본').fill(SCRIPT)
 await page.getByRole('link',{name:'녹화된 영상 불러오기',exact:true}).click()
 await expect(page.getByLabel('영상 대본')).toHaveValue(SCRIPT)
 await page.getByLabel('근거 자료',{exact:true}).fill('연결 검사용 가상 근거')
 await page.getByLabel('영상 또는 소리 파일').setInputFiles(path.join(__dirname,'../fixtures/presentation-review.mp4'))
 await page.getByLabel('목표 시간 초').fill('18')
 await page.locator('#f-blink').check()
 await page.getByRole('button',{name:'분석 시작',exact:true}).click()
 await expect(page.getByTestId('studio-blink-status')).toContainText('얼굴 측정 시간',{timeout:110000})
 await page.getByRole('button',{name:'이 시점의 대본 확인',exact:true}).click()
 await page.getByRole('button',{name:/연결 상태를 확인하는 가상 대본/}).click()
 await page.getByRole('button',{name:'이 문장으로 할게요',exact:true}).click()
 await page.getByRole('button',{name:/대본 준비/}).first().click()
 await expect(page.getByLabel('발표 대본')).toHaveValue(SCRIPT)
 expect(transcriptions).toBe(0);expect(errors).toEqual([])
})
