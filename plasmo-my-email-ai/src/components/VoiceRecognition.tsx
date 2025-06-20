import { useState, useEffect } from 'react';

// Web Speech API 타입 정의
declare global {
  interface Window {
    webkitSpeechRecognition: any;
    SpeechRecognition: any;
  }
}

interface SpeechRecognitionEvent {
  results: {
    [key: number]: {
      [key: number]: {
        transcript: string;
      };
    };
  };
}

interface SpeechRecognitionErrorEvent {
  error: string;
}

export default function VoiceRecognition() {
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [error, setError] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [confidence, setConfidence] = useState(0);
  const [aiResponse, setAiResponse] = useState('');
  const [isContinuousMode, setIsContinuousMode] = useState(true); // Track continuous mode

  // 컴포넌트 마운트 시 자동으로 음성 인식 시작
  useEffect(() => {
    console.log("🎤 VoiceRecognition component mounted - Auto-starting voice recognition");
    startRecording();
    
    // 컴포넌트 언마운트 시 처리
    return () => {
      console.log("🛑 VoiceRecognition component unmounting");
      // Don't stop voice recognition when popup closes
      // Let the user explicitly stop it via toggle button
      console.log("Voice recognition continues in background");
    };
  }, []);
  
  // Ensure continuous recording when listening state changes
  useEffect(() => {
    if (isListening && !isProcessing && aiResponse === "") {
      console.log("🎤 Ensuring voice recognition is active");
      // Don't restart if already listening, just ensure state is correct
    }
  }, [isListening, isProcessing, aiResponse]);

  useEffect(() => {
    const messageListener = (message: any) => {
      console.log("🎧 VoiceRecognition received message:", message)
      
      if (message.type === 'VOICE_RECOGNITION_RESULT') {
        setTranscript(message.transcript || '')
        setConfidence(message.confidence || 0)
        
        if (message.ai_response) {
          setAiResponse(message.ai_response)
        }
        
        if (message.processing === false) {
          setIsProcessing(false)
        } else if (message.processing === true) {
          setIsProcessing(true)
        }
      } else if (message.type === 'VOICE_RECOGNITION_ERROR') {
        setError(message.error)
        setIsListening(false)
        setIsProcessing(false)
      } else if (message.type === 'READY_FOR_NEXT_COMMAND') {
        // 연속 대화 준비 완료 - 상태 리셋하지만 녹음은 계속 활성 상태 유지
        console.log("🔄 Ready for next command:", message.status)
        setIsProcessing(false)
        setAiResponse("")
        setIsContinuousMode(true) // Ensure continuous mode is active
        // 사용자 참조용으로 transcript와 confidence는 유지
        
        // Don't restart here - let content script handle it
        console.log("💬 Continuous conversation mode active")
      } else if (message.type === 'VOICE_RECOGNITION_STARTED') {
        setIsListening(true)
        setError("")
      } else if (message.type === 'VOICE_RECOGNITION_ENDED') {
        setIsListening(false)
        setIsProcessing(false)
      }
    }

    chrome.runtime.onMessage.addListener(messageListener)
    
    return () => {
      chrome.runtime.onMessage.removeListener(messageListener)
    }
  }, [])

  const startRecording = () => {
    setError("")
    setTranscript("")
    setAiResponse("")
    setConfidence(0)
    setIsListening(true)
    setIsProcessing(false)
    
    chrome.runtime.sendMessage({ type: 'START_VOICE_RECOGNITION' })
  }

  const stopRecording = () => {
    setIsListening(false)
    setIsProcessing(false)
    chrome.runtime.sendMessage({ type: 'STOP_VOICE_RECOGNITION' })
  }

  return (
    <div className="voice-recognition-container">
      <h2>🎤 AI Email Assistant</h2>
      
      <div className="status-section">
        {isListening && !isProcessing && (
          <div className="listening-indicator">
            🎤 Listening for your voice commands...
          </div>
        )}
        
        {isProcessing && (
          <div className="processing-indicator">
            ⏳ AI is processing your request...
          </div>
        )}
        
        {transcript && (
          <div className="transcript">
            <strong>✅ Last command:</strong> {transcript}
            {confidence > 0 && (
              <span className="confidence"> (Confidence: {Math.round(confidence * 100)}%)</span>
            )}
          </div>
        )}
        
        {aiResponse && (
          <div className="ai-response">
            <strong>🤖 AI Response:</strong> {aiResponse}
          </div>
        )}
        
        {error && (
          <div className="error">
            <strong>❌ Error:</strong> {error}
          </div>
        )}
        
        {isListening && !error && (
          <div className="help-text">
            💡 <strong>Continuous conversation mode active</strong><br/>
            Just speak naturally! Your commands will be processed automatically.<br/>
            Turn off the toggle above to stop the assistant.
          </div>
        )}

        {!isListening && !error && (
          <div className="connecting-text">
            🔄 Connecting to voice assistant...
          </div>
        )}
      </div>

      <style>{`
        .voice-recognition-container {
          padding: 16px;
          border: 1px solid #e0e0e0;
          border-radius: 8px;
          background: #fafafa;
        }
        
        h2 {
          margin: 0 0 16px 0;
          color: #333;
          font-size: 16px;
          text-align: center;
        }
        
        .status-section {
          min-height: 120px;
        }
        
        .listening-indicator {
          color: #4CAF50;
          font-weight: bold;
          margin: 10px 0;
          text-align: center;
          padding: 12px;
          background: #e8f5e8;
          border-radius: 6px;
          border: 2px solid #4CAF50;
        }
        
        .processing-indicator {
          color: #FF9800;
          font-weight: bold;
          margin: 10px 0;
          text-align: center;
          padding: 12px;
          background: #fff3e0;
          border-radius: 6px;
          border: 2px solid #FF9800;
        }

        .connecting-text {
          color: #2196F3;
          font-weight: bold;
          margin: 10px 0;
          text-align: center;
          padding: 12px;
          background: #e3f2fd;
          border-radius: 6px;
          border: 2px solid #2196F3;
        }
        
        .transcript {
          margin: 10px 0;
          padding: 10px;
          background: #f5f5f5;
          border-radius: 4px;
          border-left: 4px solid #4caf50;
          font-size: 14px;
        }
        
        .confidence {
          color: #666;
          font-size: 0.9em;
        }
        
        .ai-response {
          margin: 10px 0;
          padding: 10px;
          background: #e8f5e8;
          border-radius: 4px;
          border-left: 4px solid #4CAF50;
          font-size: 14px;
        }
        
        .error {
          margin: 10px 0;
          padding: 10px;
          background: #ffebee;
          border-radius: 4px;
          color: #c62828;
          border-left: 4px solid #f44336;
          font-size: 14px;
        }
        
        .help-text {
          margin: 10px 0;
          padding: 12px;
          background: #fff3e0;
          border-radius: 6px;
          color: #ef6c00;
          font-size: 13px;
          border: 1px dashed #ffb74d;
          text-align: center;
          line-height: 1.4;
        }
      `}</style>
    </div>
  )
} 