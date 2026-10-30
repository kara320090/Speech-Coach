import {test,expect,type Page} from '@playwright/test'
const consent='녹음 소리를 AI로 전사하는 데 동의해요 (분석 시 유료 사용량이 발생할 수 있어요).'
async function setup(page:Page){
 await page.route('**/api/model-status',r=>r.fulfill({json:{provider:'ai-gateway',transcriptionConfigured:true,transcription:{provider:'ai-gateway'},ready:true}}))
 await page.goto('/');await page.getByRole('button',{name:'바로 서비스 이용하기',exact:true}).click()
}
async function finish(page:Page){
 await page.getByRole('button',{name:'녹화 시작',exact:true}).click();await page.waitForTimeout(1600)
 await page.getByRole('button',{name:'연습 종료',exact:true}).click()
}
const reply={text:'안녕하세요 발표 연습을 시작합니다',segments:[{text:'안녕하세요 발표 연습을 시작합니다',startSecond:0,endSecond:0.8}]}
test('가짜 전사 응답: 준비에서 동의하면 녹화 종료 후 WAV 요청1회와 인식 결과를 표시한다',async({page})=>{
 let calls=0
 await page.route('**/api/transcribe',r=>{calls++;expect(r.request().headers()['content-type']).toBe('audio/wav');return r.fulfill({json:reply})})
 await setup(page);await page.getByRole('checkbox',{name:consent,exact:true}).check()
 await page.getByRole('button',{name:'카메라 확인하기',exact:true}).click()
 await expect(page.getByRole('checkbox',{name:consent,exact:true})).toBeChecked()
 await finish(page)
 await expect(page.getByRole('heading',{name:'음성 인식을 완료했어요',exact:true})).toBeVisible()
 await page.getByText('인식된 글 보기',{exact:true}).click()
 await expect(page.getByText(reply.text,{exact:true})).toBeVisible()
 expect(calls).toBe(1)
})
test('가짜 전사 응답: 미동의 녹음은 전송0건, 결과에서 별도 동의·실행 후 기존 녹음으로1회 인식한다',async({page})=>{
 let calls=0;await page.route('**/api/transcribe',r=>{calls++;return r.fulfill({json:reply})})
 await setup(page);await page.getByRole('button',{name:'카메라 확인하기',exact:true}).click();await finish(page)
 await expect(page.getByRole('heading',{name:'이 녹음은 음성 인식을 실행하지 않았어요',exact:true})).toBeVisible()
 expect(calls).toBe(0)
 await page.getByRole('link',{name:'연습 기록',exact:true}).click()
 await page.getByRole('link',{name:'결과 보기',exact:true}).click()
 await page.getByRole('link',{name:'스튜디오에서 음성 인식 확인',exact:true}).click()
 await expect(page.getByRole('heading',{name:'이 녹음은 음성 인식을 실행하지 않았어요',exact:true})).toBeVisible()
 const button=page.getByRole('button',{name:'저장된 녹음 음성 인식하기',exact:true});await expect(button).toBeDisabled()
 await page.getByRole('checkbox',{name:/이 녹음의 소리를 AI로 보내/}).check();await button.click()
 await expect(page.getByRole('heading',{name:'음성 인식을 완료했어요',exact:true})).toBeVisible()
 await expect(page.getByText('자체 AI 전사를 꺼서 속도와 군말은 측정하지 않았어요.',{exact:true})).toHaveCount(0)
 await expect(page.locator('video').first()).toHaveAttribute('src',/^blob:/)
 expect(calls).toBe(1)
})

test('가짜 전사 오류: 인식 실패에도 원본 녹화와 명시적 재시도만 유지한다',async({page})=>{
 let calls=0;await page.route('**/api/transcribe',r=>{calls++;return r.fulfill({status:503,json:{error:'provider-unavailable',message:'가짜 오류'}})})
 await setup(page);await page.getByRole('checkbox',{name:consent,exact:true}).check()
 await page.getByRole('button',{name:'카메라 확인하기',exact:true}).click();await finish(page)
 await expect(page.getByRole('heading',{name:'음성 인식을 완료하지 못했어요',exact:true})).toBeVisible()
 await expect(page.locator('video').first()).toHaveAttribute('src',/^blob:/)
 await expect(page.getByRole('button',{name:'저장된 녹음 음성 인식하기',exact:true})).toBeDisabled()
 expect(calls).toBe(1)
})
