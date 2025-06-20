console.log("AI Email Assistant - Main Service Worker Loaded.")

import { sendCommand } from './lib/api';

// Extension state management
let isEnabled = false;
let isContinuousMode = false; // Track continuous conversation mode

// Check server status
async function checkServerStatus() {
  try {
    const response = await fetch('http://localhost:8000/api/health');
    if (!response.ok) {
      throw new Error('Server is not responding');
    }
    return true;
  } catch (error) {
    console.error('Server status check failed:', error);
    return false;
  }
}

// Handle voice command
async function handleVoiceCommand(command: string) {
  try {
    const response = await sendCommand(command);
    return {
      success: true,
      message: response.message || 'Command processed successfully.'
    };
  } catch (error) {
    console.error('Voice command error:', error);
    return {
      success: false,
      message: error instanceof Error ? error.message : 'An error occurred while processing the command.'
    };
  }
}

// Send message to current active tab
async function sendMessageToActiveTab(message: any) {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab.id) {
      return await chrome.tabs.sendMessage(tab.id, message);
    }
  } catch (error) {
    console.error('Failed to send message to active tab:', error);
    throw error;
  }
}

// Send stop voice recognition message to all tabs
async function stopVoiceRecognitionInAllTabs() {
  try {
    const tabs = await chrome.tabs.query({});
    console.log(`🛑 Attempting to stop voice recognition in ${tabs.length} tabs`);
    
    const promises = tabs.map(tab => {
      if (tab.id) {
        console.log(`🛑 Sending STOP_VOICE_RECOGNITION to tab ${tab.id} (${tab.url})`);
        return chrome.tabs.sendMessage(tab.id, { type: 'STOP_VOICE_RECOGNITION' }).catch((error) => {
          console.log(`⚠️ Failed to send stop message to tab ${tab.id}:`, error.message);
        });
      }
    });
    await Promise.all(promises);
    console.log('🛑 Voice recognition stop messages sent to all tabs');
  } catch (error) {
    console.error('Failed to stop voice recognition in all tabs:', error);
  }
}

// Auto navigate to Gmail (from user's current tab)
async function navigateToGmail() {
  try {
    // Get current active tab
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    if (activeTab && activeTab.id) {
      // Check if current tab is already Gmail
      if (activeTab.url && activeTab.url.includes('mail.google.com')) {
        console.log('✅ Already on Gmail tab');
        return;
      }
      
      // Navigate current tab to Gmail
      await chrome.tabs.update(activeTab.id, { 
        url: 'https://mail.google.com' 
      });
      
      console.log('🌐 Navigated current tab to Gmail');
      
      // Guide user after Gmail loading completion
      setTimeout(() => {
        chrome.tabs.sendMessage(activeTab.id!, { 
          type: 'GMAIL_READY',
          message: '✅ Gmail ready! Try using voice commands.'
        }).catch(error => {
          console.log('Failed to send Gmail guide message (normal):', error.message);
        });
      }, 3000);
      
    } else {
      console.error('Could not find active tab');
    }
  } catch (error) {
    console.error('Failed to navigate to Gmail:', error);
  }
}

// Initialize
async function initialize() {
  try {
    // Load saved state
    const result = await chrome.storage.local.get(['isEnabled']);
    isEnabled = result.isEnabled || false;
    console.log('Extension initialized. Enabled:', isEnabled);
    
    // Check server status
    const serverStatus = await checkServerStatus();
    if (!serverStatus) {
      console.warn('Backend server is not running');
    }

    // Stop voice recognition on initialization (cleanup previous session)
    if (!isEnabled) {
      await stopVoiceRecognitionInAllTabs();
    }
  } catch (error) {
    console.error('Initialization failed:', error);
  }
}

// Message listener
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Background received message:', message);

  // Extension context validity check
  try {
    if (!chrome.runtime?.id) {
      console.error('Extension context is invalid');
      sendResponse({ success: false, error: 'Extension context invalidated' });
      return false;
    }

    if (message.type === 'TOGGLE_EXTENSION') {
      const previousState = isEnabled;
      isEnabled = !isEnabled;
      
      console.log(`🔄 Extension toggle: ${previousState} → ${isEnabled}`);
      
      chrome.storage.local.set({ isEnabled }).then(async () => {
        if (isEnabled && !previousState) {
          // Auto navigate to Gmail when activated
          console.log('✅ Extension activated - navigating to Gmail');
          await navigateToGmail();
        } else if (!isEnabled && previousState) {
        // Stop all voice recognition when deactivated
          console.log('🛑 Extension deactivated - stopping all voice recognition');
          await stopVoiceRecognitionInAllTabs();
        }
        
        sendResponse({ isEnabled });
      }).catch(error => {
        console.error('Failed to save state:', error);
        sendResponse({ success: false, error: 'Failed to save state' });
      });
      return true;
    }

    if (message.type === 'VOICE_COMMAND') {
      // Reject command processing if extension is disabled
      if (!isEnabled) {
        sendResponse({ 
          success: false, 
          message: 'Extension is disabled.' 
        });
        return true;
      }

      handleVoiceCommand(message.command)
        .then(response => {
          // Send command processing result to Popup as well
          try {
            chrome.runtime.sendMessage({ 
              type: 'VOICE_COMMAND_RESPONSE', 
              response: response 
            });
          } catch (error) {
            console.error('Failed to send command response to popup:', error);
          }
          sendResponse(response);
        })
        .catch(error => sendResponse({ 
          success: false, 
          message: error.message 
        }));
      return true;
    }

    // Voice recognition related messages from Content Script
    if (message.type === 'VOICE_RECOGNITION_STARTED') {
      try {
        chrome.runtime.sendMessage({ type: 'VOICE_STARTED' });
      } catch (error) {
        console.error('Failed to send VOICE_STARTED message:', error);
      }
      sendResponse({ success: true });
      return true;
    }

    if (message.type === 'VOICE_RECOGNITION_INTERIM') {
      // Forward interim results to Popup
      try {
        chrome.runtime.sendMessage({ 
          type: 'VOICE_INTERIM', 
          transcript: message.transcript 
        });
      } catch (error) {
        console.error('Failed to send VOICE_INTERIM message:', error);
      }
      sendResponse({ success: true });
      return true;
    }

    if (message.type === 'VOICE_RECOGNITION_RESULT') {
      // Forward final results to Popup
      try {
        chrome.runtime.sendMessage({ 
          type: 'VOICE_RESULT', 
          transcript: message.transcript,
          ai_response: message.ai_response,
          processing: message.processing,
          status: message.status,
          timestamp: message.timestamp
        });
      } catch (error) {
        console.error('Failed to send VOICE_RESULT message:', error);
      }
      sendResponse({ success: true });
      return true;
    }

    if (message.type === 'VOICE_RECOGNITION_ERROR') {
      try {
        chrome.runtime.sendMessage({ 
          type: 'VOICE_ERROR', 
          error: message.error 
        });
      } catch (error) {
        console.error('Failed to send VOICE_ERROR message:', error);
      }
      sendResponse({ success: true });
      return true;
    }

    if (message.type === 'VOICE_RECOGNITION_ENDED') {
      try {
        chrome.runtime.sendMessage({ type: 'VOICE_ENDED' });
      } catch (error) {
        console.error('Failed to send VOICE_ENDED message:', error);
      }
      sendResponse({ success: true });
      return true;
    }

    if (message.type === 'READY_FOR_NEXT_COMMAND') {
      // Mark continuous mode as active
      isContinuousMode = true;
      console.log('🔄 Continuous conversation mode activated');
      
      // Forward continuous conversation ready message to Popup
      try {
        chrome.runtime.sendMessage({ 
          type: 'READY_FOR_NEXT', 
          status: message.status,
          timestamp: message.timestamp
        });
      } catch (error) {
        console.error('Failed to send READY_FOR_NEXT message:', error);
      }
      sendResponse({ success: true });
      return true;
    }

    // Voice recognition start request from Popup
    if (message.type === 'START_VOICE_RECOGNITION') {
      // Reject start if extension is disabled
      if (!isEnabled) {
        sendResponse({ 
          success: false, 
          error: 'Extension is disabled.' 
        });
        return true;
      }

      sendMessageToActiveTab({ type: 'START_VOICE_RECOGNITION' })
        .then(() => sendResponse({ success: true }))
        .catch(error => sendResponse({ 
          success: false, 
          error: error.message 
        }));
      return true;
    }

    // Voice recognition stop request from Popup
    if (message.type === 'STOP_VOICE_RECOGNITION') {
      sendMessageToActiveTab({ type: 'STOP_VOICE_RECOGNITION' })
        .then(() => sendResponse({ success: true }))
        .catch(error => sendResponse({ 
          success: false, 
          error: error.message 
        }));
      return true;
    }

    sendResponse({ success: false, error: 'Unknown message type' });
    return false;

  } catch (error) {
    console.error('Message handler error:', error);
    sendResponse({ success: false, error: 'Message handler failed' });
    return false;
  }
});

// Initialize on extension installation
chrome.runtime.onInstalled.addListener(() => {
  console.log('Extension installed');
  initialize();
});

// Initialize on extension startup
chrome.runtime.onStartup.addListener(() => {
  console.log('Extension startup');
  initialize();
});

// Detect context invalidation
chrome.runtime.onSuspend.addListener(() => {
  console.log('Extension context is being suspended');
});

// Execute initialization
initialize();
