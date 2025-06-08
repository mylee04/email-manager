// content.js
console.log("AI Email Assistant - Content Script Loaded on:", window.location.href);

// 전역 변수
let recognition = null;
let isRecognizing = false;
let isProcessingTTS = false;
const ttsQueue = [];
let extensionEnabled = false;

// 초기화 함수
async function initializeExtension() {
  try {
    const { extensionEnabled: enabled } = await chrome.storage.local.get('extensionEnabled');
    extensionEnabled = enabled;
    console.log('Content Script: Initial extension state:', extensionEnabled);

    if (extensionEnabled) {
      await startRecognition();
    }

    // 메시지 리스너
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      console.log('Content script received message:', message);

      if (message.type === 'toggle_feature') {
        const newEnabledStatus = message.enabled;
        extensionEnabled = newEnabledStatus;
        if (newEnabledStatus) {
          startRecognition().catch(console.error);
        } else {
          stopRecognition();
        }
      } else if (message.type === 'TTS') {
        handleTTSMessage(message.text, message.options);
      }
    });

  } catch (error) {
    console.error('Content Script: Initialization error:', error);
  }
}

// 음성 인식 시작
async function startRecognition() {
  try {
    if (!extensionEnabled || isRecognizing) return;

    if (!recognition) {
      recognition = new (window.SpeechRecognition || window.webkitSpeechRecognition)();
  recognition.continuous = true;
  recognition.interimResults = false;
  recognition.lang = 'en-US'; 

  recognition.onstart = () => {
    isRecognizing = true;
        // TTS 중단
    speechSynthesis.cancel();
    isProcessingTTS = false;
        ttsQueue.length = 0;
        console.log('Speech recognition started');
  };

  recognition.onresult = (event) => {
        const utterance = event.results[event.results.length - 1][0].transcript;
        console.log('Recognized speech:', utterance);
        chrome.runtime.sendMessage({
          type: 'AGENT_COMMAND',
          command: utterance
        }, (response) => {
          console.log('Background response:', response);
        });
  };

  recognition.onerror = (event) => {
        console.error('Recognition error:', event.error);
    isRecognizing = false;

    if (event.error === 'no-speech') {
          // no-speech 에러는 무시하고 계속 진행
          return;
        }

        if (event.error === 'audio-capture') {
          console.error('Microphone access denied or in use');
          // 마이크 권한 요청 UI 표시
          chrome.runtime.sendMessage({
            type: 'SHOW_MIC_PERMISSION_UI'
          });
    } else if (event.error === 'not-allowed') {
          console.error('Microphone use not allowed');
          // 마이크 사용 권한 안내
          chrome.runtime.sendMessage({
            type: 'SHOW_MIC_PERMISSION_UI'
          });
        }
      };

      recognition.onend = () => {
    isRecognizing = false;
        if (extensionEnabled) {
          startRecognition().catch(console.error);
        }
      };
    }

    await recognition.start();
    isRecognizing = true;
  } catch (error) {
    console.error('Error starting recognition:', error);
    isRecognizing = false;
  }
}

// 음성 인식 중지
function stopRecognition() {
  if (recognition && isRecognizing) {
    recognition.stop();
  }
}

// TTS 메시지 처리
function handleTTSMessage(text, options = {}) {
  console.log('TTS message received:', text);
  ttsQueue.push({ text, options });
  
  if (!isProcessingTTS) {
    processTTSQueue();
  }
}

// TTS 큐 처리
async function processTTSQueue() {
    if (ttsQueue.length === 0) {
        isProcessingTTS = false;
        return;
    }
    
    isProcessingTTS = true;
  const { text, options } = ttsQueue.shift();

  try {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = options.lang || 'en-US';
    utterance.rate = options.rate || 0.9;
    utterance.pitch = options.pitch || 1;
    utterance.volume = options.volume || 1.0;
    
    utterance.onend = () => {
      processTTSQueue();
    };

    utterance.onerror = (error) => {
      console.error('TTS error:', error);
        processTTSQueue();
    };

    window.speechSynthesis.speak(utterance);
  } catch (error) {
    console.error('TTS error:', error);
    processTTSQueue();
  }
}

// 초기화
initializeExtension();