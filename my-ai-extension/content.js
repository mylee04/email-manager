// content.js
console.log("AI Email Assistant - Content Script Loaded on:", window.location.href);

let recognition;
let isRecognizing = false;
let extensionIsEnabled = false; // 기본적으로 비활성화 상태로 시작

// TTS 큐 시스템 추가
let ttsQueue = [];
let isProcessingTTS = false;
let ttsTimeoutId = null; // 강력한 음성인식 제어를 위한 변수

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
    if (event.error === 'no-speech') {
      console.log('Speech recognition: No speech detected.'); 
  } else if (event.error === 'audio-capture') {
      console.error('Speech recognition error: Microphone access denied or microphone is in use.', event);
  } else if (event.error === 'not-allowed') {
      console.error('Speech recognition error: Microphone use was not allowed by the user or policy.', event);
  } else {
      // 기타 예상치 못한 오류들
      console.error('Speech recognition error (unknown):', event.error, event);
  }
  };

  recognition.onend = function() {
  console.log("Speech recognition ended. __pausedForTTS:", recognition?.__pausedForTTS, "__manualStop:", recognition?.__manualStop); // recognition 객체 존재 여부 확인 추가
  isRecognizing = false;

  if (recognition && recognition.__pausedForTTS) { // recognition 객체가 있고, TTS 때문에 멈춘 경우
      console.log('Speech recognition ended because TTS was playing. TTS logic will handle restart.');
      // TTS의 onend/onerror 콜백에서 recognition.__pausedForTTS를 false로 만들고,
      // 필요하다면 recognition.start()를 호출할 것이므로, 여기서는 아무것도 하지 않습니다.
      return;
  }

  // 이 아래는 TTS 때문이 "아닌" 다른 이유로 음성 인식이 종료된 경우입니다.
  // (예: no-speech 오류 후, 또는 명시적인 stopRecognition() 호출 후 __manualStop이 false인 경우 등)
  if (extensionIsEnabled && (!recognition || !recognition.__manualStop)) { // 수동 중지가 아닐 때만 자동 재시작
      console.log('Attempting to automatically restart speech recognition (non-TTS related).');
      setTimeout(() => {
          // 재시작 시점에서도 TTS가 재생 중이거나 TTS로 인해 멈춘 상태가 아닌지 다시 한번 확인
          if (extensionIsEnabled && !isRecognizing && (!recognition || !recognition.__pausedForTTS)) {
              try {
                  if (recognition) recognition.start(); // recognition 객체가 있을 때만 start 호출
              } catch (e) {
                  console.error("Error during automatic restart (non-TTS related):", e);
              }
          } else {
              console.log("Automatic restart skipped: conditions not met (isRecognizing:", isRecognizing, "__pausedForTTS:", recognition?.__pausedForTTS, ")");
          }
      }, 1000); // 1초 후 재시작
    }
  };
} else { // 이 else는 if ('SpeechRecognition' in window ...) 에 대한 것
  console.error('Web Speech API is not supported in this browser.');
}

function startRecognition() {
    console.log(`Content Script: Attempting to start recognition. Current state: extensionIsEnabled=${extensionIsEnabled}, isRecognizing=${isRecognizing}, recognition_object_exists=${!!recognition}`);

    // 🚨 start 시도 시 플래그들 초기화
    if (recognition) {
        recognition.__manualStop = false;
        recognition.__pausedForTTS = false;
    }

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
        return;
    }

    // 모든 조건 통과, 음성 인식 시작
    try {
        console.log("Content Script: All conditions met. Calling recognition.start().");
        recognition.start();
    } catch (e) {
        console.error("Error starting speech recognition:", e);
        if (e.name === 'InvalidStateError') {
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
    // 🚨 TTS 중이거나 TTS로 인해 멈춘 상태면 사용자 발화 무시
    if (isProcessingTTS || (recognition && recognition.__pausedForTTS)) {
        console.log("🎤 User utterance ignored during TTS processing or TTS pause:", utterance);
        return;
    }
    
    console.log(`Content Script: Sending user utterance to background for NLU processing: ${utterance}`);
    
    chrome.runtime.sendMessage({
        type: "NLU_QUERY",
        utterance: utterance
    }, (response) => {  // Promise 대신 콜백 사용
        console.log("Content Script: Received NLU response from background:", response);
    });
}

// 🚨 단일 processTTSQueue 함수 - 최종 강화 버전
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
    
    // 🚨 기존 타이머 정리
    if (ttsTimeoutId) {
        clearTimeout(ttsTimeoutId);
        ttsTimeoutId = null;
    }
    
    // 🚨 강력한 음성인식 중지
    console.log("🔊 Forcefully stopping speech recognition for TTS");
    if (recognition) {
        recognition.__pausedForTTS = true;
        recognition.__manualStop = true;
    }
    
    try {
        if (isRecognizing) {
            recognition.stop();
            console.log("🔊 Recognition.stop() called");
        }
    } catch (e) {
        console.warn("🔊 Error stopping recognition:", e);
    }
    
    // 음성인식이 완전히 멈출 때까지 대기
    setTimeout(() => {
        isRecognizing = false; // 강제로 상태 리셋
        console.log("🔊 Recognition forcefully marked as stopped");
        
        // 기존 음성 완전히 중단
        speechSynthesis.cancel();
        console.log("🔊 speechSynthesis.cancel() called");
        
        // TTS 실행
        setTimeout(() => {
            console.log("🔊 About to create utterance for:", text);
            const utterance = new SpeechSynthesisUtterance(text);
            utterance.lang = 'en-US';
            utterance.rate = 0.9;
            utterance.pitch = 1;
            utterance.volume = 1.0;
            
            // 🚨 강제 타이머 - TTS가 끝나지 않을 경우 대비
            ttsTimeoutId = setTimeout(() => {
                console.warn("🔊 TTS forced timeout - restarting recognition");
                isProcessingTTS = false;
                if (recognition) {
                    recognition.__pausedForTTS = false;
                    recognition.__manualStop = false;
                }
                
                if (extensionIsEnabled) {
                    setTimeout(() => {
                        try {
                            if (!isRecognizing) {
                                recognition.start();
                                console.log("🔊 Recognition force-restarted after timeout");
                            }
                        } catch (e) {
                            console.warn("🔊 Error force-restarting recognition:", e);
                        }
                    }, 1000);
                }
                
                setTimeout(() => processTTSQueue(), 2000);
            }, 8000); // 8초 타이머
            
            utterance.onstart = () => {
                console.log('🔊 Content Script: TTS started from queue:', text.substring(0, 50));
            };
            
            utterance.onend = () => {
                console.log('🔊 Content Script: TTS ended from queue');
                
                // 타이머 정리
                if (ttsTimeoutId) {
                    clearTimeout(ttsTimeoutId);
                    ttsTimeoutId = null;
                }
                
                isProcessingTTS = false;
                if (recognition) {
                    recognition.__pausedForTTS = false;
                    recognition.__manualStop = false;
                }
                
                // 🚨 TTS 종료 후 음성인식 재시작 (더 긴 딜레이)
                setTimeout(() => {
                    if (extensionIsEnabled && !isRecognizing) {
                        console.log("🔊 Restarting speech recognition after TTS");
                        try {
                            recognition.start();
                        } catch (e) {
                            console.warn("🔊 Error restarting recognition after TTS:", e);
                        }
                    }
                }, 1500); // 1.5초 대기
                
                // 다음 큐 처리
                setTimeout(() => processTTSQueue(), 2000);
            };
            
            utterance.onerror = (event) => {
                console.error('🔊 Content Script: TTS error from queue:', event.error);
                
                // 타이머 정리
                if (ttsTimeoutId) {
                    clearTimeout(ttsTimeoutId);
                    ttsTimeoutId = null;
                }
                
                isProcessingTTS = false;
                if (recognition) {
                    recognition.__pausedForTTS = false;
                    recognition.__manualStop = false;
                }
                
                // 에러 시에도 음성인식 재시작
                setTimeout(() => {
                    if (extensionIsEnabled && !isRecognizing) {
                        console.log("🔊 Restarting speech recognition after TTS error");
                        try {
                            recognition.start();
                        } catch (e) {
                            console.warn("🔊 Error restarting recognition after TTS error:", e);
                        }
                    }
                }, 2000);
                
                setTimeout(() => processTTSQueue(), 3000);
            };
            
            console.log("🔊 About to call speechSynthesis.speak()");
            speechSynthesis.speak(utterance);
            console.log("🔊 speechSynthesis.speak() called successfully");
            
        }, 300);
        
    }, 500); // 음성인식 중지 대기
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
  }
});

if (window.location.host.includes("mail.google.com") ||
    window.location.host.includes("outlook.live.com") ||
    window.location.host.includes("outlook.office.com")) {
  console.log("AI Email Assistant content.js successfully loaded on a mail service page.");
}