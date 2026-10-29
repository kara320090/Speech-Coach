import {test,expect} from '@playwright/test'
test('기본 주소에 새 온보딩이 나오고 기존 연습·기록 주소도 열린다',async({page})=>{
 await page.goto('/')
 await expect(page.getByRole('button',{name:'바로 서비스 이용하기',exact:true})).toBeVisible()
 await page.getByRole('button',{name:'바로 서비스 이용하기',exact:true}).click()
 await page.getByRole('link',{name:'기본 연습 화면',exact:true}).click()
 await page.getByRole('button',{name:'건너뛰기',exact:true}).click()
 await expect(page.getByRole('button',{name:'녹화 시작',exact:true})).toBeVisible()
 await page.getByRole('link',{name:'새 스튜디오',exact:true}).click()
 await expect(page.getByRole('button',{name:'카메라 확인하기',exact:true})).toBeVisible()
})
