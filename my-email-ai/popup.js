// popup.js
document.addEventListener('DOMContentLoaded', () => {
  const statusElement = document.getElementById('extensionStatus');
  const toggleButton = document.getElementById('toggleExtension');
  const micPermissionInfoElement = document.getElementById('micPermissionInfo');
  const mainInfoText = document.querySelector('.info:not(.mic-info)');

  if (mainInfoText) {
     mainInfoText.textContent = "Manage your emails with your voice!";
  }
  document.querySelector('h1').textContent = "AI Email Assistant";

  function updateStatusUI(isEnabled) {
    statusElement.textContent = isEnabled ? 'Enabled (ON)' : 'Disabled (OFF)';
    toggleButton.textContent = isEnabled ? 'Disable (OFF)' : 'Enable (ON)';
    micPermissionInfoElement.style.display = isEnabled ? 'none' : 'block';
  }

  chrome.storage.local.get('extensionEnabled', (data) => {
    const isEnabled = data.extensionEnabled || false;
    updateStatusUI(isEnabled);
  });

  toggleButton.addEventListener('click', () => {
    chrome.storage.local.get('extensionEnabled', (data) => {
      const newStatus = !(data.extensionEnabled || false);
      chrome.storage.local.set({ extensionEnabled: newStatus }, () => {
        updateStatusUI(newStatus);
        console.log(`Popup: Extension status toggled to: ${newStatus}`);
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          if (tabs[0]?.id) {
            if (tabs[0].url && (tabs[0].url.includes("mail.google.com") || tabs[0].url.includes("outlook.live.com") || tabs[0].url.includes("outlook.office.com"))) {
              chrome.tabs.sendMessage(tabs[0].id, { type: "toggle_feature", enabled: newStatus }, (response) => {
                if (chrome.runtime.lastError) {
                  console.warn("Popup: Error sending message:", chrome.runtime.lastError.message);
                  if (newStatus) {
                    chrome.storage.local.set({ extensionEnabled: false }, () => {
                      updateStatusUI(false);
                      alert("Failed to activate. Please refresh the page and try again.");
                    });
                  }
                }
              });
            } else {
              alert("Please open Gmail or Outlook to use this extension.");
              chrome.storage.local.set({ extensionEnabled: false }, () => updateStatusUI(false));
            }
          }
        });
      });
    });
  });

  // --- Agent Status & Action Log UI (기존 코드와 동일) ---
  const agentStatusContainer = document.createElement('div');
  agentStatusContainer.id = 'agent-status-container';
  agentStatusContainer.style.cssText = 'margin-top: 20px; padding: 10px; border-radius: 8px; background-color: #f5f5f5;';
  const agentStatusElement = document.createElement('div');
  agentStatusElement.id = 'agent-status';
  agentStatusElement.style.cssText = 'font-weight: bold; margin-bottom: 5px;';
  const agentStatusDetails = document.createElement('div');
  agentStatusDetails.id = 'agent-status-details';
  agentStatusDetails.style.cssText = 'font-size: 12px; color: #666;';
  agentStatusContainer.append(agentStatusElement, agentStatusDetails);

  function updateAgentStatus(status, details = '') {
      agentStatusElement.textContent = `Agent Status: ${status}`;
      agentStatusDetails.textContent = details;
      const statusColors = { ready: '#e6ffe6', processing: '#fff3e6', error: '#ffe6e6', default: '#f5f5f5' };
      const textColors = { ready: '#006600', processing: '#cc7700', error: '#cc0000', default: '#333' };
      agentStatusContainer.style.backgroundColor = statusColors[status] || statusColors.default;
      agentStatusElement.style.color = textColors[status] || textColors.default;
  }

  function startAgentMonitoring() {
      updateAgentStatus('initializing', 'Agent is starting up...');
      chrome.runtime.onMessage.addListener((request) => {
          if (request.type === 'AGENT_STATUS_UPDATE') {
              updateAgentStatus(request.status, request.details);
          }
      });
  }

  // --- API 키 설정 UI (기존 코드와 동일) ---
  const apiKeysContainer = document.createElement('div');
  apiKeysContainer.id = 'api-keys-container';
  apiKeysContainer.style.cssText = 'margin-top: 20px; padding: 10px; border-radius: 8px; background-color: #f5f5f5;';
  const apiKeysTitle = document.createElement('h3');
  apiKeysTitle.textContent = 'API Key Settings';
  apiKeysTitle.style.marginBottom = '10px';
  const elevenlabsKeyInput = document.createElement('input');
  elevenlabsKeyInput.type = 'password';
  elevenlabsKeyInput.placeholder = 'ElevenLabs API Key';
  elevenlabsKeyInput.style.cssText = 'width: 100%; box-sizing: border-box; margin-bottom: 10px; padding: 5px;';
  const geminiKeyInput = document.createElement('input');
  geminiKeyInput.type = 'password';
  geminiKeyInput.placeholder = 'Gemini API Key';
  geminiKeyInput.style.cssText = 'width: 100%; box-sizing: border-box; margin-bottom: 10px; padding: 5px;';
  const saveButton = document.createElement('button');
  saveButton.textContent = 'Save API Keys';
  saveButton.style.cssText = 'width: 100%; padding: 8px; background-color: #4CAF50; color: white; border: none; border-radius: 4px; cursor: pointer;';
  const apiKeysStatus = document.createElement('div');
  apiKeysStatus.style.cssText = 'margin-top: 10px; font-size: 12px; color: #666;';
  apiKeysContainer.append(apiKeysTitle, elevenlabsKeyInput, geminiKeyInput, saveButton, apiKeysStatus);

  // --- 새로운 API 키 저장 로직 ---
  async function saveApiKeys() {
      const keys = {
          elevenlabsApiKey: elevenlabsKeyInput.value.trim(),
          geminiApiKey: geminiKeyInput.value.trim()
      };

      if (!keys.geminiApiKey || !keys.elevenlabsApiKey) {
          apiKeysStatus.textContent = 'Please enter both API keys.';
          apiKeysStatus.style.color = '#f44336';
          return;
      }

      apiKeysStatus.textContent = 'Validating API keys with server...';
      apiKeysStatus.style.color = '#333';
      saveButton.disabled = true;

      try {
          // 1. 백엔드를 통해 키 유효성 검사
          const validationResponse = await fetch('http://localhost:3000/api/validate-keys', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(keys)
          });
          const validationResult = await validationResponse.json();
          if (!validationResponse.ok || !validationResult.success) {
              throw new Error(validationResult.message || 'API key validation failed.');
          }

          apiKeysStatus.textContent = 'Keys are valid! Saving...';

          // 2. 유효성 검사 성공 시, 키 저장 요청
          const saveResponse = await fetch('http://localhost:3000/api/save-key', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                  userId: '1a2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d', // TODO: 실제 유저 ID로 변경 필요, 현재는 테스트용
                  ...keys
              })
          });
          const saveResult = await saveResponse.json();
          if (!saveResponse.ok || !saveResult.success) {
              throw new Error(saveResult.message || 'Failed to save API keys to server.');
          }

          // 3. 로컬 스토리지에 저장 및 UI 업데이트
          await chrome.runtime.sendMessage({ type: 'UPDATE_API_KEYS', keys });
          apiKeysStatus.textContent = 'API keys are valid and saved successfully!';
          apiKeysStatus.style.color = '#4CAF50';

          // 확장 프로그램 활성화
          await chrome.storage.local.set({ extensionEnabled: true });
          updateStatusUI(true);

      } catch (error) {
          console.error('Error during API key process:', error);
          apiKeysStatus.textContent = `Error: ${error.message}`;
          apiKeysStatus.style.color = '#f44336';
      } finally {
          saveButton.disabled = false;
      }
  }

  saveButton.addEventListener('click', saveApiKeys);

  chrome.storage.local.get(['elevenlabsApiKey', 'geminiApiKey'], (data) => {
      if (data.elevenlabsApiKey) elevenlabsKeyInput.value = data.elevenlabsApiKey;
      if (data.geminiApiKey) geminiKeyInput.value = data.geminiApiKey;
  });

  document.body.append(agentStatusContainer, apiKeysContainer);
  startAgentMonitoring();
});