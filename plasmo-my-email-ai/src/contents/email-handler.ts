import type { PlasmoCSConfig } from "plasmo"

export const config: PlasmoCSConfig = {
  matches: ["https://mail.google.com/*"],
  all_frames: false
}

console.log("📧 Email Handler Content Script Loaded")

// State management for voice recognition
let isRecording = false
let isProcessingCommand = false
let shouldSendAudio = true // Control audio transmission during processing
let isWebSocketConnected = false
let isContinuousMode = true // Enable continuous conversation mode by default
let ws: WebSocket | null = null
let mediaRecorder: MediaRecorder | null = null
let audioStream: MediaStream | null = null // Store the audio stream globally
let audioChunks: Blob[] = []
let audioContext: AudioContext | null = null
let analyser: AnalyserNode | null = null
let dataArray: Uint8Array | null = null
let isVoiceDetected = false
let lastVoiceTime = 0
let recordingTimeout: NodeJS.Timeout | null = null
let silenceTimeout: NodeJS.Timeout | null = null
let accumulatedTranscript = ""
let reconnectAttempts = 0
const MAX_RECONNECT_ATTEMPTS = 5

// WebSocket connection setup
function setupWebSocket() {
  if (ws && ws.readyState === WebSocket.OPEN) {
    console.log('🔌 WebSocket already connected, using existing connection');
    return;
  }

  if (ws) {
    ws.close();
  }

  console.log('🔌 WebSocket connection attempt...', reconnectAttempts + 1);
  ws = new WebSocket('ws://localhost:8000/ws/speech');
  
  ws.onopen = () => {
    console.log('🔌 WebSocket connected');
    isWebSocketConnected = true;
    reconnectAttempts = 0; // Reset reconnection counter on success
  };
  
  ws.onclose = (event) => {
    console.log('🔌 WebSocket connection closed:', event.code, event.reason);
    isWebSocketConnected = false;
    
    // Normal close (1000) or stop signal - don't reconnect
    if (event.code === 1000 || event.reason === "User stopped voice recognition") {
      console.log('✅ WebSocket closed normally');
      reconnectAttempts = 0;
      return;
    }
    
    // Abnormal close and recording is in progress - try to reconnect
    if (isRecording && reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
      reconnectAttempts++;
      console.log(`🔄 WebSocket reconnection attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS}...`);
      setTimeout(() => {
        if (isRecording) {
          setupWebSocket();
        }
      }, Math.min(1000 * reconnectAttempts, 5000)); // Gradual backoff
    } else if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      console.error('🚨 WebSocket reconnection limit exceeded, stopping recording');
      stopVoiceRecognition();
    }
  };
  
  ws.onerror = (error) => {
    console.error('🚨 WebSocket error:', error);
    isWebSocketConnected = false;
  };
  
  ws.onmessage = (event) => {
    try {
      const result = JSON.parse(event.data);
      
      if (result.error) {
        console.error('🚨 Speech recognition error:', result.error);
        chrome.runtime.sendMessage({ 
          type: 'VOICE_RECOGNITION_ERROR', 
          error: result.error 
        });
        return;
      }
      
      // Process ready for next command message (essential!)
      if (result.type === 'ready_for_next' || result.ready_for_next === true) {
        console.log('🔄 Continuous conversation preparation completed:', result.status);
        isProcessingCommand = false; // Command processing completed
        shouldSendAudio = true; // Resume audio sending
        showNotification(`🔄 ${result.status || 'Ready for next command'}`, 'ready', 2000);
        
        // Notify Background Script of completion
        chrome.runtime.sendMessage({ 
          type: 'READY_FOR_NEXT_COMMAND',
          status: result.status || 'Ready for next command',
          timestamp: result.timestamp
        });
        
        // Initialize state for continuous conversation (essential!)
        // Keep WebSocket connection and recording active but reset processing state
        console.log('💬 Continuous conversation mode: Ready to receive next command');
        
        // Visual feedback - Update microphone icon status
        const micIcon = document.querySelector('.voice-recognition-indicator');
        if (micIcon) {
          micIcon.classList.add('listening');
          micIcon.classList.remove('processing', 'completed');
        }
        
        // CRITICAL: Check and restart MediaRecorder if needed
        if (mediaRecorder) {
          console.log('🎤 MediaRecorder state:', mediaRecorder.state);
          if (mediaRecorder.state === 'recording') {
            console.log('✅ MediaRecorder still recording, ready for next command');
          } else if (mediaRecorder.state === 'paused') {
            console.log('▶️ Resuming MediaRecorder for continuous conversation');
            mediaRecorder.resume();
          } else {
            console.log('🔄 MediaRecorder inactive, restarting for continuous conversation');
            // Restart MediaRecorder with existing stream
            if (audioStream && audioStream.active) {
              console.log('🎤 Restarting MediaRecorder with existing stream');
              // Create new MediaRecorder with existing stream
              mediaRecorder = new MediaRecorder(audioStream, {
                mimeType: 'audio/webm;codecs=opus'
              });
              
              // Re-attach data handler
              mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0 && shouldSendAudio && !isProcessingCommand) {
                  if (isWebSocketConnected && ws && ws.readyState === WebSocket.OPEN) {
                    console.log("📤 Sending real-time audio chunk:", event.data.size, "bytes");
                    ws.send(event.data);
                  }
                }
              };
              
              // Start recording
              mediaRecorder.start(250);
              isRecording = true;
              shouldSendAudio = true;
              console.log('✅ MediaRecorder restarted successfully');
            } else {
              console.log('⚠️ Audio stream inactive, need to restart voice recognition');
              // Stream is dead, need to restart entire voice recognition
              startVoiceRecognition();
            }
          }
        } else {
          console.log('⚠️ MediaRecorder not found, restarting voice recognition');
          // MediaRecorder doesn't exist, restart voice recognition
          startVoiceRecognition();
        }
        
        // Send keep-alive message to prevent timeout
        if (ws && ws.readyState === WebSocket.OPEN) {
          try {
            ws.send(JSON.stringify({ type: 'KEEP_ALIVE', session_id: result.session_id }));
            console.log('📡 Sent keep-alive message');
          } catch (e) {
            console.error('Failed to send keep-alive:', e);
          }
        }
        
        return;
      }
      
      if (result.transcript) {
        console.log('🎯 Real-time recognition result:', result.transcript, `(final: ${result.is_final})`);
        
        // Process final result and AI response
        if (result.is_final) {
          console.log('✅ Final speech recognition result:', result.transcript);
          isProcessingCommand = true; // Start command processing
          shouldSendAudio = false; // Stop sending audio during processing
          
          // Show processing status message
          if (result.processing === true && result.status) {
            console.log('⏳ Processing status:', result.status);
            showNotification(`⏳ ${result.status}`, 'processing', 3000);
            
            // Visual feedback - Show processing status
            const micIcon = document.querySelector('.voice-recognition-indicator');
            if (micIcon) {
              micIcon.classList.add('processing');
              micIcon.classList.remove('listening');
            }
          }
          
          // Show AI response to user immediately if there is one
          if (result.ai_response && result.processing === false) {
            console.log('🤖 AI agent response:', result.ai_response);
            showAIResponse(result.ai_response, result.transcript);
            
            // Visual feedback - Wait after response completion
            const micIcon = document.querySelector('.voice-recognition-indicator');
            if (micIcon) {
              micIcon.classList.add('completed');
              micIcon.classList.remove('processing');
            }
          }
          
          // Notify Background Script of result
          chrome.runtime.sendMessage({ 
            type: 'VOICE_RECOGNITION_RESULT', 
            transcript: result.transcript,
            confidence: result.confidence || 1.0,
            ai_response: result.ai_response,
            processing: result.processing,
            status: result.status,
            timestamp: result.timestamp
          });
          
          // If there is an AI response, command processing is completed on the server
          if (!result.ai_response && result.processing !== true) {
            chrome.runtime.sendMessage({ 
              type: 'VOICE_COMMAND', 
              command: result.transcript 
            });
          }
        } else {
          // Intermediate result (real-time feedback) - Show only when not processing
          if (!isProcessingCommand) {
            console.log('🔄 Intermediate recognition result:', result.transcript);
            showInterimResult(result.transcript);
          }
        }
      }
    } catch (error) {
      console.error('🚨 WebSocket message processing error:', error);
    }
  };
}

// Show AI response to user
function showAIResponse(aiResponse: string, userCommand: string) {
  try {
    console.log("🎤➡️🤖 User:", userCommand);
    console.log("🤖➡️👤 AI response:", aiResponse);
    
    // Execute Gmail action (actual DOM manipulation)
    executeGmailAction(aiResponse, userCommand);
    
    // Show notification on screen (overlay on Gmail screen)
    showNotification(`🤖 AI: ${aiResponse}`, 'ai-response');
    
    // Respond with voice (optional)
    if ('speechSynthesis' in window) {
      const utterance = new SpeechSynthesisUtterance(aiResponse);
      utterance.lang = 'en-US';
      utterance.rate = 1.1;
      speechSynthesis.speak(utterance);
    }
    
  } catch (error) {
    console.error("🚨 AI response display error:", error);
  }
}

// Execute Gmail action function
function executeGmailAction(aiResponse: string, userCommand: string) {
  try {
    const commandLower = userCommand.toLowerCase();
    
    // Email reading command
    if (commandLower.includes('email') && (commandLower.includes('read') || commandLower.includes('check'))) {
      console.log("📧 Gmail email reading task started");
      readGmailEmails();
    }
    // New email writing command
    else if (commandLower.includes('new') && commandLower.includes('email') && commandLower.includes('write')) {
      console.log("✍️ Gmail new email writing started");
      composeNewEmail();
    }
    // Reply writing command
    else if (commandLower.includes('reply') || commandLower.includes('replyemail')) {
      console.log("↩️ Gmail reply writing started");
      composeReply();
    }
    
  } catch (error) {
    console.error("🚨 Gmail task execution error:", error);
  }
}

// Gmail email reading function
function readGmailEmails() {
  try {
    // Check Gmail login status
    const accountInfo = document.querySelector('[data-tooltip*="Account"] img, [aria-label*="Account"] img, .gb_d img');
    
    if (!accountInfo) {
      showNotification("❌ Gmail login is required", 'error');
      return;
    }
    
    // Check received emails
    const emailList = document.querySelectorAll('[role="main"] tr[id]');
    
    if (emailList.length === 0) {
      showNotification("📭 No emails in received emails", 'info');
      return;
    }
    
    // Extract latest 3 emails' information
    const emails = Array.from(emailList).slice(0, 3).map((emailRow, index) => {
      const senderElement = emailRow.querySelector('[email]');
      const subjectElement = emailRow.querySelector('[data-thread-id] span[id]');
      const timeElement = emailRow.querySelector('[title*=":"], [title*="AM"], [title*="PM"]');
      
      return {
        index: index + 1,
        sender: senderElement?.getAttribute('email') || senderElement?.textContent || 'Sender unknown',
        subject: subjectElement?.textContent || 'No subject',
        time: timeElement?.getAttribute('title') || timeElement?.textContent || 'Time unknown'
      };
    });
    
    // Generate email summary
    const emailSummary = emails.map(email => 
      `${email.index}. ${email.sender} from: "${email.subject}" (${email.time})`
    ).join('\n');
    
    showNotification(`📧 Latest ${emails.length} emails:\n${emailSummary}`, 'email-list', 8000);
    
    console.log("📧 Gmail email reading completed:", emails);
    
  } catch (error) {
    console.error("🚨 Gmail email reading error:", error);
    showNotification("❌ An error occurred while reading emails", 'error');
  }
}

// Gmail new email writing function
function composeNewEmail() {
  try {
    // Find new email writing button
    const composeButton = document.querySelector('[gh="cm"], [data-tooltip*="Compose"], [aria-label*="Compose"]');
    
    if (composeButton) {
      (composeButton as HTMLElement).click();
      showNotification("✍️ New email writing screen opened", 'success');
      console.log("✍️ Gmail new email writing button clicked completed");
    } else {
      showNotification("❌ Unable to find new email writing button", 'error');
    }
    
  } catch (error) {
    console.error("🚨 Gmail new email writing error:", error);
    showNotification("❌ An error occurred while writing new email", 'error');
  }
}

// Gmail reply writing function
function composeReply() {
  try {
    // Click the first email to open
    const firstEmail = document.querySelector('[role="main"] tr[id]');
    
    if (firstEmail) {
      (firstEmail as HTMLElement).click();
      
      // Find reply button (after slight delay)
      setTimeout(() => {
        const replyButton = document.querySelector('[data-tooltip*="Reply"], [aria-label*="Reply"], [title*="Reply"]');
        
        if (replyButton) {
          (replyButton as HTMLElement).click();
          showNotification("↩️ Reply writing screen opened", 'success');
          console.log("↩️ Gmail reply button clicked completed");
        } else {
          showNotification("❌ Unable to find reply button", 'error');
        }
      }, 1000);
      
    } else {
      showNotification("❌ Unable to find email to reply to", 'error');
    }
    
  } catch (error) {
    console.error("🚨 Gmail reply writing error:", error);
    showNotification("❌ An error occurred while writing reply", 'error');
  }
}

// Show interim recognition result
function showInterimResult(transcript: string) {
  try {
    // Show temporary result on screen (fade out)
    showNotification(`🎤 ${transcript}...`, 'interim-result', 2000);
  } catch (error) {
    console.error("🚨 Show interim result error:", error);
  }
}

// Show notification on screen
function showNotification(message: string, className: string = 'notification', duration: number = 5000) {
  try {
    // Remove existing notification
    const existingNotification = document.querySelector(`.voice-assistant-${className}`);
    if (existingNotification) {
      existingNotification.remove();
    }
    
    // Create new notification
    const notification = document.createElement('div');
    notification.className = `voice-assistant-${className}`;
    notification.textContent = message;
    
    // Style setting
    let backgroundColor = '#2196F3'; // Default blue color
    if (className === 'ai-response') backgroundColor = '#4CAF50'; // Green color
    else if (className === 'processing') backgroundColor = '#FF9800'; // Orange color
    else if (className === 'error') backgroundColor = '#F44336'; // Red color
    else if (className === 'interim-result') backgroundColor = '#9E9E9E'; // Gray color
    
    Object.assign(notification.style, {
      position: 'fixed',
      top: '20px',
      right: '20px',
      background: backgroundColor,
      color: 'white',
      padding: '12px 16px',
      borderRadius: '8px',
      boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
      zIndex: '10000',
      fontSize: '14px',
      maxWidth: '300px',
      wordWrap: 'break-word',
      animation: 'slideIn 0.3s ease-out'
    });
    
    // Add CSS animation
    if (!document.querySelector('#voice-assistant-styles')) {
      const style = document.createElement('style');
      style.id = 'voice-assistant-styles';
      style.textContent = `
        @keyframes slideIn {
          from { transform: translateX(100%); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
        @keyframes fadeOut {
          from { opacity: 1; }
          to { opacity: 0; }
        }
      `;
      document.head.appendChild(style);
    }
    
    document.body.appendChild(notification);
    
    // Auto remove
    setTimeout(() => {
      if (notification.parentNode) {
        notification.style.animation = 'fadeOut 0.3s ease-out';
        setTimeout(() => {
          if (notification.parentNode) {
            notification.remove();
          }
        }, 300);
      }
    }, duration);
    
  } catch (error) {
    console.error("🚨 Show notification error:", error);
  }
}

// Show error message
function showErrorMessage(error: string) {
  showNotification(`❌ Error: ${error}`, 'error', 5000);
}

// Voice activity detection setup
function setupVoiceActivityDetection(stream: MediaStream) {
  try {
    audioContext = new AudioContext()
    const source = audioContext.createMediaStreamSource(stream)
    analyser = audioContext.createAnalyser()
    
    analyser.fftSize = 256
    const bufferLength = analyser.frequencyBinCount
    dataArray = new Uint8Array(bufferLength)
    
    source.connect(analyser)
    
    // Start voice activity monitoring
    monitorVoiceActivity()
  } catch (error) {
    console.error("🚨 Voice activity detection setup failed:", error)
  }
}

// Voice activity monitoring
function monitorVoiceActivity() {
  if (!analyser || !dataArray) return
  
  analyser.getByteFrequencyData(dataArray)
  
  // Calculate voice level (average volume)
  const average = dataArray.reduce((sum, value) => sum + value, 0) / dataArray.length
  const threshold = 25 // Lower voice detection threshold
  
  const currentTime = Date.now()
  
  if (average > threshold) {
    // Voice detected
    if (!isVoiceDetected) {
      isVoiceDetected = true
      console.log("🎤 Voice activity detected (level:", Math.round(average), ")")
    }
    lastVoiceTime = currentTime
    
    // Reset silence timer
    if (silenceTimeout) {
      clearTimeout(silenceTimeout)
      silenceTimeout = null
    }
  } else {
    // Silence state (streaming continues in real-time mode)
    if (isVoiceDetected && currentTime - lastVoiceTime > 2000) { // Shorten to 2 seconds in real-time mode
      isVoiceDetected = false
      console.log("🔇 Voice activity stopped detected (2 seconds of silence) - Streaming continues")
      
      // In real-time mode, silence is normal as long as it's a short pause
    }
  }
  
  // Continue monitoring
  if (isRecording) {
    requestAnimationFrame(monitorVoiceActivity)
  }
}

// Process current segment (not used in real-time mode)
function processCurrentSegment() {
  console.log("🎯 Real-time mode is in progress...")
  // No separate processing in real-time mode
}

// Not used in real-time streaming mode
async function startNewRecordingSession() {
  console.log("🔄 Real-time mode does not need a new session")
  // Real-time streaming mode continues continuously
}

// Start voice recognition
async function startVoiceRecognition() {
  if (isRecording) {
    console.log("🎤 Voice recognition is already in progress")
    return
  }

  try {
    console.log("🎤 Google Speech-to-Text voice recognition started")
    
    // WebSocket connection setup
    setupWebSocket();
    
    // Request microphone permission
    const stream = await navigator.mediaDevices.getUserMedia({ 
      audio: {
        sampleRate: 16000,
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true
      } 
    })
    
    // Store stream globally for reuse in continuous mode
    audioStream = stream
    
    // Voice activity detection setup
    setupVoiceActivityDetection(stream)
    
    // MediaRecorder setup
    mediaRecorder = new MediaRecorder(stream, {
      mimeType: 'audio/webm;codecs=opus'
    })
    
    audioChunks = []
    isRecording = true
    shouldSendAudio = true // Enable audio sending when starting
    
    // Send real-time audio data to WebSocket
    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        // Don't send audio if we're processing a command or audio sending is disabled
        if (!shouldSendAudio || isProcessingCommand) {
          console.log("⏸️ Skipping audio chunk (shouldSendAudio:", shouldSendAudio, ", isProcessingCommand:", isProcessingCommand, ")");
          return;
        }
        
        // Check WebSocket connection status and reconnect if necessary
        if (!isWebSocketConnected || !ws || ws.readyState !== WebSocket.OPEN) {
          console.log("🔄 WebSocket connection broken, reconnecting...");
          
          // Clean up existing connection and reconnect
          if (ws) {
            ws.close();
          }
          setupWebSocket();
          
          // Wait briefly after reconnection before sending audio
          setTimeout(() => {
            if (isWebSocketConnected && ws && ws.readyState === WebSocket.OPEN && shouldSendAudio) {
              console.log("📤 Sending real-time audio chunk (reconnected):", event.data.size, "bytes");
              ws.send(event.data);
            } else {
              console.error("🚨 Real-time reconnection failed or audio sending disabled");
            }
          }, 500);
        } else {
          console.log("📤 Sending real-time audio chunk:", event.data.size, "bytes");
          try {
            ws.send(event.data);
          } catch (sendError) {
            console.error("🚨 Audio sending error:", sendError);
            // Try reconnecting if sending fails
            setupWebSocket();
          }
        }
      }
    };
    
    // Process completion (not used in real-time)
    mediaRecorder.onstop = () => {
      console.log("🔄 Real-time speech segment completed");
      
      // Stream continues in continuous mode
      if (!isContinuousMode) {
        stream.getTracks().forEach(track => track.stop());
      } else {
        console.log("🔄 Continuous mode: keeping stream alive");
        // Do NOT stop the stream in continuous mode
      }
    };
    
    // Start real-time streaming
    mediaRecorder.start(250); // Send real-time data every 250ms (faster response)
    
    // Notify Background Script of start
    chrome.runtime.sendMessage({ 
      type: 'VOICE_RECOGNITION_STARTED' 
    });
    
    // Continuous conversation mode has no time limit (continue until user stops)
    // recordingTimeout is not set - Unlimited continuous conversation support
    
    console.log("🔄 Continuous voice recognition mode activated");
    
  } catch (error) {
    console.error("🚨 Voice recognition start failed:", error);
    
    chrome.runtime.sendMessage({ 
      type: 'VOICE_RECOGNITION_ERROR', 
      error: error instanceof Error ? error.message : "Unknown error" 
    });
    
    isRecording = false;
  }
}

// Stop voice recognition
async function stopVoiceRecognition() {
  console.log("🛑 Voice recognition stop called - isRecording:", isRecording, "ws exists:", !!ws)
  
  console.log("🛑 Voice recognition stopped")
  
  isRecording = false
  isProcessingCommand = false
  shouldSendAudio = false // Stop audio sending
  
  // Timer cleanup
  if (recordingTimeout) {
    clearTimeout(recordingTimeout)
    recordingTimeout = null
  }
  
  if (silenceTimeout) {
    clearTimeout(silenceTimeout)
    silenceTimeout = null
  }
  
  // Stop recording
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    mediaRecorder.stop()
  }
  
  // Always stop WebSocket connection when stopping voice recognition
  if (ws) {
    console.log("🔌 Closing WebSocket connection to server (readyState:", ws.readyState, ")")
    
    // Send explicit stop signal before closing
    if (ws.readyState === WebSocket.OPEN) {
      try {
        const stopMessage = JSON.stringify({ type: 'STOP_RECORDING', reason: 'User stopped voice recognition' });
        console.log("📤 Sending stop recording message:", stopMessage);
        ws.send(stopMessage);
        // Give time for the message to be sent
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (e) {
        console.error("Failed to send stop signal:", e)
      }
    }
    
    // Close with normal closure code
    ws.close(1000, "User stopped voice recognition")
    ws = null
    isWebSocketConnected = false
    console.log("✅ WebSocket connection closed and cleaned up")
  }
  
  // Clean up audio context
  if (audioContext) {
    audioContext.close()
    audioContext = null
  }
  
  // Stop and clean up audio stream
  if (audioStream) {
    audioStream.getTracks().forEach(track => track.stop())
    audioStream = null
  }
  
  analyser = null
  dataArray = null
  isVoiceDetected = false
  reconnectAttempts = 0 // Reset reconnection counter
  
  // Notify Background Script of end
  chrome.runtime.sendMessage({ 
    type: 'VOICE_RECOGNITION_ENDED' 
  })
}

// Send audio to server
async function sendAudioToServer(audioBlob: Blob) {
  try {
    // Check audio size (10MB limit)
    const maxSize = 10 * 1024 * 1024; // 10MB
    if (audioBlob.size > maxSize) {
      console.warn("⚠️ Audio file is too large:", audioBlob.size, "bytes");
      chrome.runtime.sendMessage({ 
        type: 'VOICE_RECOGNITION_ERROR', 
        error: "Audio file is too large. Please speak more briefly." 
      });
      return;
    }
    
    console.log("📤 Sending audio to server... (size:", audioBlob.size, "bytes)");
    
    // Convert Blob to Base64 safely
    const arrayBuffer = await audioBlob.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);
    
    // Convert Base64 in chunks (memory efficiency)
    let base64Audio = '';
    const chunkSize = 8192; // 8KB chunk
    
    for (let i = 0; i < uint8Array.length; i += chunkSize) {
      const chunk = uint8Array.slice(i, i + chunkSize);
      const chunkString = String.fromCharCode.apply(null, Array.from(chunk));
      base64Audio += btoa(chunkString);
    }
    
    const response = await fetch('http://localhost:8000/api/transcribe', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        audio_data: base64Audio,
        language_code: 'en-US'
      })
    });
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const result = await response.json();
    
    if (result.success && result.transcript) {
      console.log("✅ Speech recognition successful:", result.transcript);
      console.log("🎯 Confidence:", result.confidence);
      
      // Process in continuous mode
      if (isContinuousMode) {
        // Process each speech segment immediately
        chrome.runtime.sendMessage({ 
          type: 'VOICE_RECOGNITION_RESULT', 
          transcript: result.transcript,
          confidence: result.confidence,
          segment: true // Show as segment
        });
        
        // Process command
        chrome.runtime.sendMessage({ 
          type: 'VOICE_COMMAND', 
          command: result.transcript 
        });
      } else {
        // Existing accumulation method
        if (accumulatedTranscript) {
          accumulatedTranscript += " " + result.transcript;
        } else {
          accumulatedTranscript = result.transcript;
        }
        
        chrome.runtime.sendMessage({ 
          type: 'VOICE_RECOGNITION_RESULT', 
          transcript: accumulatedTranscript,
          confidence: result.confidence
        });
        
        chrome.runtime.sendMessage({ 
          type: 'VOICE_COMMAND', 
          command: accumulatedTranscript 
        });
        
        accumulatedTranscript = "";
      }
      
    } else {
      console.log("❌ Speech recognition failed:", result.error || "Unknown error");
      
      chrome.runtime.sendMessage({ 
        type: 'VOICE_RECOGNITION_ERROR', 
        error: result.error || "Could not recognize speech" 
      });
    }
    
  } catch (error) {
    console.error("🚨 Server communication error:", error);
    
    chrome.runtime.sendMessage({ 
      type: 'VOICE_RECOGNITION_ERROR', 
      error: "Failed to communicate with server" 
    });
  }
}

// Receive message from Background Script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("📨 Content Script received message:", message)
  
  if (message.type === 'START_VOICE_RECOGNITION') {
    console.log("🚀 Starting voice recognition from message")
    startVoiceRecognition()
    sendResponse({ success: true })
  } else if (message.type === 'STOP_VOICE_RECOGNITION') {
    console.log("🛑 Stopping voice recognition from message")
    stopVoiceRecognition().then(() => {
      sendResponse({ success: true })
    })
    return true // Return true to indicate async response
  }
  
  return true
})

// Initialize on page load completion
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    console.log("📧 Gmail page loaded - Google Speech-to-Text ready")
  })
} else {
  console.log("📧 Gmail page already loaded - Google Speech-to-Text ready")
} 