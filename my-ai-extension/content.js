// content.js
console.log("AI Email Assistant - Content Script Loaded on:", window.location.href);

let recognition;
let isRecognizing = false;
let extensionIsEnabled = false; // 기본적으로 비활성화 상태로 시작

// TTS 중복 방지를 위한 변수 추가
let isSpeaking = false;

// TTS 큐 시스템 추가
let ttsQueue = [];
let isProcessingTTS = false;

// Web Speech API 초기화
if ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window) {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  recognition = new SpeechRecognition();
  recognition.continuous = true;
  recognition.interimResults = false;
  recognition.lang = 'en-US'; 

  recognition.onstart = () => {
    isRecognizing = true;
    console.log('Speech recognition started.');
  };

  recognition.onresult = (event) => {
    let transcript = '';
    for (let i = event.resultIndex; i < event.results.length; ++i) {
      transcript += event.results[i][0].transcript;
    }
    const userUtterance = transcript.trim(); // 사용자의 전체 발화
    if (userUtterance) { // 빈 문자열이 아닐 경우에만 처리
      console.log('Recognized speech (raw):', userUtterance);
      processUserUtterance(userUtterance);
    }
  };

  recognition.onerror = (event) => {
    isRecognizing = false;
    console.error('Speech recognition error:', event.error);
    if (event.error === 'no-speech') {
      console.log('No speech detected.');
    } else if (event.error === 'audio-capture') {
      console.error('Microphone access denied or microphone is in use.');
    } else if (event.error === 'not-allowed') {
      console.error('Microphone use was not allowed by the user or policy.');
    }
  };

  recognition.onend = () => {
    isRecognizing = false;
    console.log('Speech recognition ended.');
    if (extensionIsEnabled && !recognition.__manualStop) {
      console.log('Attempting to automatically restart speech recognition.');
      try {
        if (recognition && !isRecognizing) recognition.start();
      } catch (e) {
        console.error("Error during automatic restart:", e);
      }
    }
    recognition.__manualStop = false;
  };

} else {
  console.error('Web Speech API is not supported in this browser.');
}

function startRecognition() {
  console.log(`Content Script: Attempting to start recognition. Current state: extensionIsEnabled=${extensionIsEnabled}, isRecognizing=${isRecognizing}, recognition_object_exists=${!!recognition}`);

  if (!extensionIsEnabled) {
    console.log("Content Script: Recognition not started - Extension is currently disabled.");
    return;
  }
  if (isRecognizing) {
    console.log("Content Script: Recognition not started - Already recognizing.");
    return;
  }
  if (!recognition) {
    console.error("Content Script: Recognition not started - Recognition object is not initialized!");
    // 여기서 Web Speech API 초기화 코드를 다시 실행하거나, 사용자에게 알림을 줄 수 있습니다.
    // alert("Speech recognition engine failed to load. Please try reloading the page or extension.");
    return;
  }

  // 모든 조건 통과, 음성 인식 시작
  try {
    recognition.__manualStop = false;
    console.log("Content Script: All conditions met. Calling recognition.start().");
    recognition.start();
  } catch (e) {
    console.error("Error starting speech recognition:", e);
    // InvalidStateError는 이미 인식이 시작되었거나 중지 중일 때 발생할 수 있음
    if (e.name === 'InvalidStateError') {
       // isRecognizing 상태를 다시 확인하거나, 잠시 후 재시도하는 로직 고려
       // 또는 isRecognizing = true; 로 강제 동기화 (주의 필요)
       console.warn("Recognition might be in an invalid state (e.g., already started or stopping). Current isRecognizing:", isRecognizing);
    }
  }
}

function stopRecognition() {
  if (recognition && isRecognizing) {
    recognition.__manualStop = true;
    recognition.stop();
  }
}

// 사용자의 전체 발화 처리 함수 (새로 추가된 핵심 함수)
function processUserUtterance(utterance) {
    if (!extensionIsEnabled) {
        console.log("Utterance processing skipped: extension is disabled.");
        return;
    }

    console.log("Content Script: Sending user utterance to background for NLU processing:", utterance);
    // MCP 서버/background.js로 사용자 발화 전체를 전송
    chrome.runtime.sendMessage({ type: "NLU_QUERY", utterance: utterance }, (response) => {
        if (chrome.runtime.lastError) {
            console.error("Content Script: Error sending message to background:", chrome.runtime.lastError.message, "Utterance was:", utterance);
            speakText("Sorry, I couldn't process that request right now.");
        } else {
            console.log("Content Script: Received NLU response from background:", response);
            if (response && response.speak) {
                speakText(response.speak);
            }
            if (response && response.ui_update) {
                // 향후 UI 업데이트 로직 (예: 요약 결과 표시)
                // displayInOverlay(response.ui_update);
            }
            // 만약 response에 다음 행동(action)이 있다면 처리
            // if (response && response.action === "click_element" && response.selector) {
            //   const element = document.querySelector(response.selector);
            //   if (element) element.click();
            // }
        }
    });
}

// TTS 큐 처리 함수 개선
function processTTSQueue() {
    console.log("🔊 Queue check: isProcessingTTS =", isProcessingTTS, "queue length =", ttsQueue.length);
    
    if (ttsQueue.length === 0) {
        if(isProcessingTTS) {
            console.warn("🔊 Queue is empty but isProcessingTTS is true. Resetting.");
        }
        isProcessingTTS = false;
        return;
    }
    
    if (isProcessingTTS) {
        console.log("🔊 ProcessTTSQueue called while already processing. Ignoring.");
        return;
    }
    
    isProcessingTTS = true;
    const text = ttsQueue.shift();
    
    console.log("🔊 Content Script: Processing TTS from queue:", text);
    
    // 기존 음성 완전히 중단
    speechSynthesis.cancel();
    console.log("🔊 speechSynthesis.cancel() called");
    
    // 잠시 대기 후 실행
    setTimeout(() => {
        console.log("🔊 About to create utterance for:", text);
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = 'en-US';
        utterance.rate = 0.9;
        utterance.pitch = 1;
        utterance.volume = 1.0;
        
        utterance.onstart = () => {
            console.log('🔊 Content Script: TTS started from queue:', text.substring(0, 50));
        };
        
        utterance.onend = () => {
            console.log('🔊 Content Script: TTS ended from queue');
            isProcessingTTS = false;
            // 다음 큐 처리
            setTimeout(() => processTTSQueue(), 100);
        };
        
        utterance.onerror = (event) => {
            console.error('🔊 Content Script: TTS error from queue:', event.error);
            console.error('🔊 Content Script: TTS error details:', {
                error: event.error,
                type: event.type,
                target: event.target,
                utterance: text.substring(0, 50)
            });
            isProcessingTTS = false;
            // 에러 발생 시에도 다음 큐 처리
            setTimeout(() => processTTSQueue(), 500);
        };
        
        console.log("🔊 About to call speechSynthesis.speak()");
        speechSynthesis.speak(utterance);
        console.log("🔊 speechSynthesis.speak() called successfully");
    }, 200);
}

// 기존 speakText 함수를 큐 시스템으로 교체
function speakText(text) {
    console.log("🔊 Content Script: Adding to TTS queue:", text);
    
    // 중복 제거 강화
    if (ttsQueue.includes(text) && ttsQueue.length > 0) {
        console.log("🔊 Content Script: Duplicate TTS request (already in queue) ignored:", text);
        return;
    }
    
    // 큐에 추가
    ttsQueue.push(text);
    
    // 현재 TTS가 처리 중이지 않다면, 큐 처리를 시작
    if (!isProcessingTTS) {
        processTTSQueue();
    }
}

// 초기화 시 TTS 상태 확인
if ('speechSynthesis' in window) {
  console.log("🔊 TTS System Info:");
  console.log("🔊 speechSynthesis.speaking:", speechSynthesis.speaking);
  console.log("🔊 speechSynthesis.pending:", speechSynthesis.pending);
  console.log("🔊 speechSynthesis.paused:", speechSynthesis.paused);
  
  // 음성 목록 로드 대기
  setTimeout(() => {
    const voices = speechSynthesis.getVoices();
    console.log("🔊 Available voices:", voices.length);
    console.log("🔊 English voices:", voices.filter(v => v.lang.startsWith('en')).map(v => v.name));
  }, 1000);
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log("📨 Content Script: Received message:", request);
  
  if (request.command === "toggle_feature") {
    const oldStatus = extensionIsEnabled;
    extensionIsEnabled = request.enabled;
    console.log(`Content Script: Received 'toggle_feature', new_enabled_status: ${extensionIsEnabled}, old_status: ${oldStatus}`);
    if (extensionIsEnabled) {
      if (!oldStatus) {
         startRecognition();
      } else {
         console.log("Content Script: Feature was already enabled, no change in recognition status needed by this message alone.");
      }
      sendResponse({ status: "Speech recognition processing initiated" });
    } else {
      stopRecognition();
      sendResponse({ status: "Speech recognition stopped" });
    }
    return true;
  } 
  else if (request.type === "EXECUTE_ACTION" && request.actionDetail) {
    console.log("Content Script: Received EXECUTE_ACTION", request.actionDetail);
    const action = request.actionDetail;
    let actionResult = { success: false, error: "Unknown action type" };

    try {
      switch (action.type) {
        case "CLICK":
          if (action.selector) {
            const elementToClick = document.querySelector(action.selector);
            if (elementToClick) {
              console.log("Content Script: Clicking element:", elementToClick);
              elementToClick.click();
              actionResult = { success: true, message: "Element clicked successfully." };
            } else {
              console.warn("Content Script: Element not found with selector:", action.selector);
              actionResult = { success: false, error: `Element not found with selector: ${action.selector}` };
            }
          } else {
            actionResult = { success: false, error: "Selector missing for CLICK action" };
          }
          break;

        case "GET_TEXT":
          if (action.selector) {
            const elementToGetTextFrom = document.querySelector(action.selector);
            if (elementToGetTextFrom) {
              const extractedText = elementToGetTextFrom.innerText || elementToGetTextFrom.textContent;
              console.log("Content Script: Extracted text:", extractedText.substring(0, 100) + "...");
              actionResult = { 
                success: true, 
                data: extractedText, 
                message: "Text extracted successfully." 
              };
            } else {
              console.warn("Content Script: Element not found with selector:", action.selector);
              actionResult = { success: false, error: `Element not found with selector: ${action.selector}` };
            }
          } else {
            actionResult = { success: false, error: "Selector missing for GET_TEXT action" };
          }
          break;

        case "COUNT_ELEMENTS":
          if (action.selector) {
            const elements = document.querySelectorAll(action.selector);
            const count = elements.length;
            console.log(`Content Script: Found ${count} elements with selector:`, action.selector);
            actionResult = { 
              success: true, 
              data: count, 
              message: `Found ${count} elements.` 
            };
          } else {
            actionResult = { success: false, error: "Selector missing for COUNT_ELEMENTS action" };
          }
          break;

        case "TYPE_TEXT":
          if (action.selector && typeof action.value === 'string') {
            const elementToTypeIn = document.querySelector(action.selector);
            if (elementToTypeIn) {
              console.log("Content Script: Typing text into element:", elementToTypeIn);
              
              // Input 또는 textarea의 경우 value 속성 사용
              if (elementToTypeIn.tagName === 'INPUT' || elementToTypeIn.tagName === 'TEXTAREA') {
                elementToTypeIn.value = action.value;
                // React 등 프레임워크가 변경을 인지하도록 이벤트 발생
                elementToTypeIn.dispatchEvent(new Event('input', { bubbles: true }));
                elementToTypeIn.dispatchEvent(new Event('change', { bubbles: true }));
              } else {
                // contentEditable div 등의 경우
                elementToTypeIn.innerText = action.value;
                elementToTypeIn.dispatchEvent(new Event('input', { bubbles: true }));
              }
              
              actionResult = { success: true, message: "Text typed successfully." };
            } else {
              console.warn("Content Script: Element not found with selector:", action.selector);
              actionResult = { success: false, error: `Element not found with selector: ${action.selector}` };
            }
          } else {
            actionResult = { success: false, error: "Selector or value missing for TYPE_TEXT action" };
          }
          break;

        default:
          console.warn("Content Script: Unknown action type requested:", action.type);
          actionResult = { success: false, error: `Unknown action type: ${action.type}` };
          break;
      }
    } catch (e) {
      console.error("Content Script: Error executing action:", action.type, e);
      actionResult = { success: false, error: `Error during ${action.type}: ${e.message}` };
    }

    console.log("Content Script: Sending action result back to background:", actionResult);
    sendResponse(actionResult);
    return true;

  } 
  else if (request.type === "TTS" && request.text) {
    console.log("📨 Content Script: Received TTS request:", request.text);
    console.log("📨 Content Script: About to call speakText function");
    
    // 즉시 응답
    sendResponse({ success: true, message: "TTS initiated" });
    
    // TTS 실행
    speakText(request.text);
    
    return true;
  }
  else {
    console.log("Content Script: Unhandled message type:", request.type || request.command);
    return false;
  }
});

// 초기 로드 시 확장 프로그램 상태 확인
chrome.storage.local.get('extensionEnabled', (data) => {
  const storedIsEnabled = data.extensionEnabled !== undefined ? data.extensionEnabled : false;
  console.log(`Content Script: Initial extension state from storage: ${storedIsEnabled}. Current extensionIsEnabled variable before update: ${extensionIsEnabled}`);
  extensionIsEnabled = storedIsEnabled; // 여기서 확실하게 변수 업데이트
  console.log(`Content Script: extensionIsEnabled variable updated to: ${extensionIsEnabled}`);

  if (extensionIsEnabled) {
    console.log("Content Script: Extension is marked as enabled in storage. If on a mail page, recognition might start if triggered.");
    // 페이지 로드 시 자동으로 시작할지 여부는 정책에 따라 결정
    // 만약 자동으로 시작하게 하려면, 여기서 startRecognition() 호출
    // 예: if (isMailPage()) { startRecognition(); }
    // 현재는 팝업에서 명시적으로 켤 때만 시작하도록 되어 있으므로, 여기서는 호출하지 않음.
  }
});

if (window.location.host.includes("mail.google.com") ||
    window.location.host.includes("outlook.live.com") ||
    window.location.host.includes("outlook.office.com")) {
  console.log("AI Email Assistant content.js successfully loaded on a mail service page.");
}