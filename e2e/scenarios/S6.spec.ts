import {test,expect} from '@playwright/test'
import path from 'node:path'
// The actual user-supplied clip is uploaded through the product UI; no synthetic API/MediaPipe results.
test('S6 실제 발표 영상 파일의 소리와 눈 깜빡임을 이 기기에서 분석한다',async({page})=>{
 const errors:string[]=[];let aiPosts=0;const assets=new Set<string>()
 page.on('response',r=>{if(r.ok()&&/\/vendor\/mediapipe\//.test(r.url()))assets.add(r.url())})
 page.on('pageerror',e=>errors.push(e.message))
 page.on('request',r=>{if(r.method()==='POST'&&/\/api\//.test(r.url()))aiPosts++})
 await page.goto('/import.html')
 await page.getByLabel('영상 또는 소리 파일').setInputFiles(path.join(__dirname,'../fixtures/presentation-review.mp4'))
 await page.getByLabel('목표 시간 초').fill('18')
 await page.getByLabel('영상 눈 깜빡임도 이 기기에서 분석').check()
 await page.getByRole('button',{name:'분석 시작',exact:true}).click()
 await expect(page.getByRole('region',{name:'연습 결과'})).toBeVisible({timeout:110000})
 await expect(page.getByTestId('total')).toContainText('0:17')
 await expect(page.getByTestId('blink-status')).toContainText('총')
 await expect(page.getByTestId('blink-status')).toContainText('분당')
 await expect(page.locator('video#player')).toHaveAttribute('src',/^blob:/)
 expect(aiPosts).toBe(0)
 expect([...assets].some(url=>url.endsWith('face_landmarker.task'))).toBe(true)
 expect([...assets].some(url=>url.endsWith('.wasm'))).toBe(true)
 expect(errors).toEqual([])
})
