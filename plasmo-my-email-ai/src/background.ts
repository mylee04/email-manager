import { Storage } from "@plasmohq/storage"

const storage = new Storage()

// 확장 프로그램이 설치되거나 업데이트될 때 실행
chrome.runtime.onInstalled.addListener(async () => {
  // 초기 설정값 저장
  await storage.set("isEnabled", false)
  console.log("Extension installed/updated")
})

// 메시지 리스너 설정
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "TOGGLE_ENABLED") {
    storage.get("isEnabled").then((isEnabled) => {
      storage.set("isEnabled", !isEnabled)
      sendResponse({ success: true, isEnabled: !isEnabled })
    })
    return true // 비동기 응답을 위해 true 반환
  }
}) 