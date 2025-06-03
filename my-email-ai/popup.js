// popup.js
document.addEventListener('DOMContentLoaded', () => {
    const statusElement = document.getElementById('extensionStatus');
    const toggleButton = document.getElementById('toggleExtension');
    const micPermissionInfoElement = document.getElementById('micPermissionInfo');
    const mainInfoText = document.querySelector('.info:not(.mic-info)'); // 하단 일반 정보 텍스트
  
    // 팝업 UI 텍스트 (영어로 변경)
    if (mainInfoText) {
       mainInfoText.textContent = "Manage your emails with your voice!";
    }
    document.querySelector('h1').textContent = "AI Email Assistant";
  
  
    // 현재 확장 프로그램 상태 가져오기 및 UI 업데이트
    function updateStatusUI(isEnabled) {
      statusElement.textContent = isEnabled ? 'Enabled (ON)' : 'Disabled (OFF)';
      toggleButton.textContent = isEnabled ? 'Disable (OFF)' : 'Enable (ON)';
  
      // 기능을 켜려고 할 때 (즉, 현재 꺼져있을 때) 마이크 권한 안내 표시
      if (!isEnabled) {
        micPermissionInfoElement.style.display = 'block';
      } else {
        micPermissionInfoElement.style.display = 'none';
      }
    }
  
    // 초기 상태 로드 및 UI 업데이트
    chrome.storage.local.get('extensionEnabled', (data) => {
      const isEnabled = data.extensionEnabled !== undefined ? data.extensionEnabled : false; // 기본 비활성화
      updateStatusUI(isEnabled);
    });
  
  
    // 토글 버튼 클릭 이벤트
    toggleButton.addEventListener('click', () => {
      chrome.storage.local.get('extensionEnabled', (data) => {
        const currentStatus = data.extensionEnabled !== undefined ? data.extensionEnabled : false;
        const newStatus = !currentStatus;
  
        // 새 상태를 저장하고 UI 업데이트
        chrome.storage.local.set({ extensionEnabled: newStatus }, () => {
          updateStatusUI(newStatus);
          console.log(`Popup: Extension status toggled to: ${newStatus}`);
  
          // content script에 메시지 전송
          chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs[0] && tabs[0].id) {
              if (tabs[0].url && (tabs[0].url.includes("mail.google.com") || tabs[0].url.includes("outlook.live.com") || tabs[0].url.includes("outlook.office.com"))) {
                chrome.tabs.sendMessage(tabs[0].id, { command: "toggle_feature", enabled: newStatus }, (response) => {
                  if (chrome.runtime.lastError) {
                    console.warn("Popup: Error sending message to content script:", chrome.runtime.lastError.message);
                    // content.js가 응답하지 않는 경우 (예: 페이지가 아직 로드되지 않음)
                    if (newStatus) { // 활성화 하려는데 실패한 경우
                       // 필요하다면 사용자에게 재시도 안내
                       // alert("Failed to activate on the page. Please ensure the Gmail/Outlook page is fully loaded and try again.");
                    }
                  } else {
                    console.log("Popup: Response from content script:", response);
                  }
                });
              } else {
                console.log("Popup: Current tab is not Gmail/Outlook, message not sent to content script for feature toggle.");
                if (newStatus){
                   // Gmail/Outlook이 아닌 페이지에서 켜려고 할 때 사용자에게 알림
                   alert("AI Email Assistant can only be activated on Gmail or Outlook pages. Please navigate to one of these pages and try again.");
                   // 상태를 다시 false로 돌리고 UI 업데이트
                   chrome.storage.local.set({ extensionEnabled: false }, () => {
                       updateStatusUI(false);
                   });
                }
              }
            } else {
              console.warn("Popup: Active tab not found.");
            }
          });
        });
      });
    });
  });