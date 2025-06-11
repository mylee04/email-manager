import type { PlasmoCSConfig } from "plasmo"
import { onMessage, sendToBackground } from "@plasmohq/messaging"

export const config: PlasmoCSConfig = {
  matches: [
    "https://mail.google.com/*",
    "https://outlook.live.com/*",
    "https://outlook.office.com/*"
  ]
}

console.log("AI Email Assistant - Content Script Loaded (Plasmo).")

let recognition: SpeechRecognition
let extensionIsEnabled = false

// Web Speech API 초기화
function initSpeechRecognition() {
  if (!("webkitSpeechRecognition" in window)) {
    console.error("Speech recognition not supported")
    return
  }

  recognition = new webkitSpeechRecognition()
  recognition.continuous = true
  recognition.interimResults = true
  recognition.lang = "en-US"

  recognition.onresult = (event) => {
    const result = event.results[event.results.length - 1]
    if (result.isFinal) {
      const utterance = result[0].transcript
      processUserUtterance(utterance)
    }
  }

  recognition.onerror = (event) => {
    console.error("Speech recognition error:", event.error)
  }
}

// 사용자의 발화를 background로 전송
function processUserUtterance(utterance: string) {
  if (!extensionIsEnabled) return
  console.log("Content Script: Sending utterance to background:", utterance)
  sendToBackground({
    name: "NLU_QUERY",
    body: { utterance, tab: { url: window.location.href } }
  })
}

// Background로부터 메시지 수신
onMessage(async (msg) => {
  console.log("Content Script received message:", msg)

  if (msg.body.type === "SPEAK") {
    const utterance = new SpeechSynthesisUtterance(msg.body.text)
    window.speechSynthesis.speak(utterance)
  }

  if (msg.body.type === "ACTION") {
    executeAction(msg.body.actionDetail)
  }

  if (msg.body.type === "ERROR") {
    console.error("Error from background:", msg.body.error)
  }
})

// 액션 실행 함수
function executeAction(actionDetail: { type: string; selector: string }) {
  switch (actionDetail.type) {
    case "CLICK":
      const element = document.querySelector(actionDetail.selector)
      if (element instanceof HTMLElement) {
        element.click()
      }
      break
    // 다른 액션 타입들 추가 가능
    default:
      console.warn("Unknown action type:", actionDetail.type)
  }
}

// 확장 기능 활성/비활성 메시지 리스너
onMessage(async (msg) => {
  if (msg.name === "toggle-feature") {
    extensionIsEnabled = msg.body.enabled
    if (extensionIsEnabled) {
      initSpeechRecognition()
      recognition?.start()
    } else {
      recognition?.stop()
    }
  }
}) 