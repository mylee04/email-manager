// background.js
console.log("AI Email Assistant - Service Worker Loaded.");

// 초기 상태 설정 (예: 확장 프로그램 설치 시)
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({ extensionEnabled: false }); // 기본적으로 OFF 상태
  console.log("Extension enabled state initialized to false.");
});

// MCP 서버의 NLU 처리 엔드포인트
const MCP_NLU_ENDPOINT = "http://localhost:3000/api/nlu"; // 실제 MCP 서버 엔드포인트로 수정

// TTS 중복 방지를 위한 변수 추가
let lastTTSText = "";
let lastTTSTime = 0;

async function callNluViaMcp(utterance, currentTabUrl, contextData = null, isFollowUp = false) {
  try {
    const payload = {
      utterance: utterance,
      url: currentTabUrl
    };
    
    if (contextData) {
      payload.context_data = contextData;
    }
    
    if (isFollowUp) {
      payload.is_follow_up = true;
    }

    const response = await fetch(MCP_NLU_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      console.error("MCP Server Error Response:", response.status, errorBody);
      throw new Error(`MCP request failed with status ${response.status}: ${errorBody}`);
    }

    return await response.json();
  } catch (error) {
    console.error("Error calling MCP NLU endpoint:", error);
    return {
      success: false,
      speak: "Sorry, I couldn't connect to the assistant server.",
      message: error.message
    };
  }
}

// NLU 쿼리 처리 핸들러 (MCP 서버 연동)
async function handleNluQuery(utterance, sender, sendResponse) {
  console.log("Background (NLU Handler): Received utterance for processing via MCP:", utterance);
  
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) {
    sendResponse({
      success: false,
      speak: "Unable to access the current tab."
    });
    return;
  }

  try {
    const mcpResult = await callNluViaMcp(utterance, tab.url);
    console.log("MCP Server NLU Response:", mcpResult);

    if (mcpResult && mcpResult.success) {
      // 음성 응답 처리 (중복 방지)
      if (mcpResult.speak) {
        const now = Date.now();
        const isDuplicate = (mcpResult.speak === lastTTSText && (now - lastTTSTime) < 2000);
        
        if (!isDuplicate) {
          console.log("Background: Sending TTS message:", mcpResult.speak);
          lastTTSText = mcpResult.speak;
          lastTTSTime = now;
          
          chrome.tabs.sendMessage(tab.id, { type: "TTS", text: mcpResult.speak }, (response) => {
            if (chrome.runtime.lastError) {
              console.error("Background: TTS send error:", chrome.runtime.lastError.message);
            } else {
              console.log("Background: TTS sent successfully");
            }
          });
        } else {
          console.log("Background: Duplicate TTS request ignored:", mcpResult.speak);
        }
      }

      // 브라우저 액션이 있으면 잠시 후 실행 (TTS와 겹치지 않도록)
      if (mcpResult.browser_action) {
        setTimeout(() => {
          console.log("Background: Executing browser action:", mcpResult.browser_action);
          
          chrome.tabs.sendMessage(tab.id, { 
            type: "EXECUTE_ACTION", 
            actionDetail: mcpResult.browser_action 
          }, (responseFromContent) => {
            if (chrome.runtime.lastError) {
              console.error("Background: Browser action error:", chrome.runtime.lastError.message);
            } else {
              console.log("Background: Content script response:", responseFromContent);
              
              // 후속 처리가 필요한 경우 (더 긴 지연)
              if (mcpResult.requires_follow_up && responseFromContent && responseFromContent.success && responseFromContent.data) {
                setTimeout(() => {
                  handleFollowUpWithMcp(utterance, responseFromContent.data, tab.url, tab.id);
                }, 1000); // 1초 지연
              }
            }
          });
        }, 500); // 0.5초 지연
      }

      sendResponse({
        success: true,
        speak: mcpResult.speak,
        message: "Command processed successfully"
      });
    } else {
      // 실패한 경우에도 TTS 전송 - 디버깅 추가!
      const errorMessage = mcpResult.speak || "Sorry, I had trouble understanding that. Please try again.";
      console.log("Background: Sending error TTS:", errorMessage);
      
      chrome.tabs.sendMessage(tab.id, { type: "TTS", text: errorMessage }, (response) => {
        if (chrome.runtime.lastError) {
          console.error("Background: Error TTS send failed:", chrome.runtime.lastError.message);
        } else {
          console.log("Background: Error TTS sent successfully");
        }
      });
      
      sendResponse({
        success: false,
        speak: errorMessage,
        message: mcpResult.message
      });
    }
  } catch (error) {
    console.error("Background: Error in handleNluQuery:", error);
    sendResponse({
      success: false,
      speak: "Sorry, there was an error processing your request.",
      message: error.message
    });
  }
}

// 후속 처리 함수 개선 (나머지는 그대로)
async function handleFollowUpWithMcp(originalUtterance, browserData, tabUrl, tabId) {
  console.log("Background: Handling follow-up with browser data:", browserData);
  console.log("Background: Original utterance was:", originalUtterance);
  
  try {
    let followUpResult;
    
    // 데이터 타입에 따라 다른 처리
    if (typeof browserData === 'number') {
      // COUNT_ELEMENTS 결과 처리
      console.log("Background: Processing count result:", browserData);
      followUpResult = {
        success: true,
        speak: `You have ${browserData} unread emails.`
      };
    } else if (typeof browserData === 'string') {
      console.log("Background: Processing text result, length:", browserData.length);
      
      // GET_TEXT 결과 처리
      if (originalUtterance.toLowerCase().includes('title') || originalUtterance.toLowerCase().includes('subject')) {
        // 제목/주제 요청 처리
        followUpResult = {
          success: true,
          speak: `The email subject is: "${browserData}"`
        };
      } else if (originalUtterance.toLowerCase().includes('read')) {
        // 이메일 읽기 요청
        const isLongContent = browserData.length > 500;
        if (isLongContent) {
          followUpResult = {
            success: true,
            speak: `This email is quite long. Here's the beginning: "${browserData.substring(0, 300)}..." Would you like me to continue reading or provide a summary instead?`
          };
        } else {
          followUpResult = {
            success: true,
            speak: browserData
          };
        }
      } else {
        // 기본 텍스트 응답
        followUpResult = {
          success: true,
          speak: browserData.length > 100 ? `Here's what I found: "${browserData.substring(0, 100)}..."` : browserData
        };
      }
    } else {
      // MCP 서버에 후속 처리 요청 (원래 로직)
      followUpResult = await callNluViaMcp(originalUtterance, tabUrl, browserData, true);
    }
    
    console.log("Background: Follow-up result:", followUpResult);
    
    if (followUpResult && followUpResult.success && followUpResult.speak) {
      console.log("Background: Sending follow-up TTS:", followUpResult.speak);
      chrome.tabs.sendMessage(tabId, { type: "TTS", text: followUpResult.speak });
    }
  } catch (error) {
    console.error("Background: Error in follow-up:", error);
    chrome.tabs.sendMessage(tabId, { type: "TTS", text: "Sorry, I had trouble processing the follow-up." });
  }
}

// 팝업 또는 content script로부터 메시지 수신
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === "NLU_QUERY" && request.utterance) {
    handleNluQuery(request.utterance, sender, sendResponse);
    return true; // 비동기 응답을 위해 true 반환
  }
  // 팝업 등 다른 곳에서 오는 메시지 처리 (기존 로직 유지)
  else if (request.message === "get_extension_status") {
    chrome.storage.local.get("extensionEnabled", (data) => {
      sendResponse({ status: data.extensionEnabled });
    });
    return true; // 비동기 응답을 위해 true 반환
  }
  // toggle_feature는 content.js가 popup.js에 직접 응답
  return false;
});

// 아이콘 클릭 시 팝업 상태 업데이트 (옵션: 팝업이 아닌 다른 동작을 원할 경우)
// chrome.action.onClicked.addListener((tab) => {
//   // 팝업이 설정되어 있으면 이 리스너는 보통 실행되지 않습니다.
//   // 팝업 대신 특정 동작을 수행하게 하려면 manifest.json에서 default_popup을 제거해야 합니다.
//   console.log("Extension icon clicked on tab:", tab.id);
// });