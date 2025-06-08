// background.js
console.log("AI Email Assistant - Service Worker Loaded.");

// 서비스 워커 초기화
self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(clients.claim());
});

// MCP NLU 엔드포인트 설정
const MCP_NLU_ENDPOINT = "http://localhost:3000/api/nlu";

// 브라우저 세션 클래스
class BrowserSession {
  constructor() {
    this.screenshot = null;
    this.viewport = null;
  }

  async takeScreenshot() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab) throw new Error('can not find active tab.');

      const screenshot = await chrome.tabs.captureVisibleTab();
      this.screenshot = screenshot;
      return screenshot;
    } catch (error) {
      console.error('Failed to take screenshot:', error);
      throw error;
    }
  }

  async getViewport() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab) throw new Error('can not find active tab.');

      const [{ result }] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => ({
          width: window.innerWidth,
          height: window.innerHeight,
          scrollX: window.scrollX,
          scrollY: window.scrollY
        })
      });

      this.viewport = result;
      return result;
    } catch (error) {
      console.error('Failed to get viewport information:', error);
      throw error;
    }
  }
}

// Agent 클래스
class Agent {
  constructor(config) {
    this.config = config;
    this.session = new BrowserSession();
    this.isRunning = false;
    this.status = 'ready';
    this.statusDetails = '';
  }

  async updateStatus(status, details = '') {
    this.status = status;
    this.statusDetails = details;
    
    // 상태 업데이트 메시지 브로드캐스트
    chrome.runtime.sendMessage({
      type: 'AGENT_STATUS_UPDATE',
      status: this.status,
      details: this.statusDetails
    });
  }

  async run(task) {
    if (this.isRunning) {
      throw new Error('An already running task exists.');
    }

    this.isRunning = true;
    try {
      await this.updateStatus('processing', 'Task started...');
      
      // API 키 확인
      const { geminiApiKey } = await chrome.storage.local.get('geminiApiKey');
      if (!geminiApiKey) {
        throw new Error('Gemini API key is not set.');
      }

      // 스크린샷 캡처
      await this.updateStatus('processing', 'Taking screenshot...');
      const screenshot = await this.session.takeScreenshot();
      
      // 뷰포트 정보 가져오기
      await this.updateStatus('processing', 'Collecting viewport information...');
      const viewport = await this.session.getViewport();

      // Gemini Vision API 호출
      await this.updateStatus('processing', 'Analyzing with AI...');
      const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-pro-vision:generateContent', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${geminiApiKey}`
        },
        body: JSON.stringify({
          contents: [{
            parts: [{
              text: `Task: ${task}\n\nCurrent viewport: ${JSON.stringify(viewport)}`
            }, {
              inline_data: {
                mime_type: 'image/jpeg',
                data: screenshot.split(',')[1]
              }
            }]
          }],
          generationConfig: {
            temperature: 0.4,
            topK: 32,
            topP: 1,
            maxOutputTokens: 2048,
          }
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(`API call failed: ${errorData.error?.message || response.statusText}`);
      }

      const result = await response.json();
      await this.updateStatus('ready', 'Task completed');
      return result;
    } catch (error) {
      await this.updateStatus('error', error.message);
      throw error;
    } finally {
      this.isRunning = false;
    }
  }
}

// ElevenLabs TTS 초기화
const elevenlabsTTS = {
  async generate(text, options = {}) {
    try {
      const { elevenlabsApiKey } = await chrome.storage.local.get('elevenlabsApiKey');
      if (!elevenlabsApiKey) {
        throw new Error('ElevenLabs API key not set');
      }

      const response = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${options.voice || '21m00Tcm4TlvDq8ikWAM'}`,
        {
          method: 'POST',
          headers: {
            'Accept': 'audio/mpeg',
            'Content-Type': 'application/json',
            'xi-api-key': elevenlabsApiKey
          },
          body: JSON.stringify({
            text: text,
            model_id: options.model || 'eleven_multilingual_v2',
            voice_settings: {
              stability: 0.5,
              similarity_boost: 0.75,
              style: 0.0,
              use_speaker_boost: true,
              speed: 1.0
            }
          })
        }
      );

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(`TTS API call failed: ${errorData.error?.message || response.statusText}`);
      }

      const audioBlob = await response.blob();
      const audioUrl = URL.createObjectURL(audioBlob);
      // 오디오 재생
      const audio = new Audio(audioUrl);
      await new Promise((resolve, reject) => {
        audio.onended = () => {
          URL.revokeObjectURL(audioUrl);
          resolve();
        };
        audio.onerror = reject;
        audio.play();
      });
      return true;
    } catch (error) {
      console.error('TTS generation failed:', error);
      // 실패 시 브라우저 기본 TTS로 폴백
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]?.id) {
          chrome.tabs.sendMessage(tabs[0].id, {
            type: 'TTS',
            text: text,
            options: { lang: 'en-US' }
          });
        }
      });
      return false;
    }
  }
};

// Agent 인스턴스 생성
const agent = new Agent({
  allowedDomains: ['mail.google.com', 'outlook.office.com', 'outlook.live.com'],
  vision: {
    enabled: true,
    screenshotQuality: 'high',
    elementDetection: true
  },
  memory: {
    enabled: true,
    maxSize: 10
  },
  actions: {
    click: true,
    type: true,
    scroll: true,
    screenshot: true
  }
});

// API 키 초기화
async function initializeApiKeys() {
  try {
    const data = await chrome.storage.local.get(['elevenlabsApiKey', 'geminiApiKey']);
    if (!data.elevenlabsApiKey || !data.geminiApiKey) {
      console.warn('API key is not set.');
    }
  } catch (error) {
    console.error('Failed to initialize API keys:', error);
  }
}

// API 키 업데이트
async function updateApiKeys(keys) {
  try {
    await chrome.storage.local.set(keys);
    console.log('API keys updated successfully.');
    return true;
  } catch (error) {
    console.error('Failed to update API keys:', error);
    throw error;
  }
}

// 메시지 리스너
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'UPDATE_API_KEYS') {
    updateApiKeys(message.keys)
      .then(() => sendResponse({ success: true }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  } else if (message.type === 'AGENT_COMMAND') {
    console.log('Received AGENT_COMMAND:', message.command);
    agent.run(message.command)
      .then(result => {
        const response = result.candidates[0].content.parts[0].text;
        // 영어로만 TTS
        elevenlabsTTS.generate(response, { lang: 'en-US' });
        chrome.tabs.sendMessage(sender.tab.id, {
          type: 'TTS',
          text: response,
          options: { lang: 'en-US' }
        });
        sendResponse({ success: true, result });
      })
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  } else if (message.type === 'GET_AGENT_STATUS') {
    sendResponse({
      status: agent.status,
      details: agent.statusDetails
    });
    return true;
  }
});

// 초기화
initializeApiKeys();