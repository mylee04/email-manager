import type { PlasmoMessaging } from "@plasmohq/messaging"

// 백엔드 서버의 NLU 엔드포인트
const NLU_SERVER_ENDPOINT = "http://localhost:3000/api/nlu"

async function callNluViaBackend(utterance: string) {
  try {
    const response = await fetch(NLU_SERVER_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ utterance }), // 이제 발화 내용만 보냅니다.
    })
    if (!response.ok) throw new Error(`Backend error: ${response.statusText}`)
    return await response.json()
  } catch (error) {
    console.error("Error calling backend:", error)
    return { success: false, error: error.message }
  }
}

const handler: PlasmoMessaging.MessageHandler = async (req, res) => {
  const { utterance } = req.body
  console.log("NLU_QUERY received:", utterance)

  try {
    const backendResult = await callNluViaBackend(utterance)
    res.send(backendResult) // 백엔드 결과를 그대로 전달
  } catch (error) {
    res.send({ success: false, error: error.message })
  }
}

export default handler 