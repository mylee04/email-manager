import { useState, useEffect } from "react"
import VoiceRecognition from "./components/VoiceRecognition"

function IndexPopup() {
  const [isEnabled, setIsEnabled] = useState(false);

  useEffect(() => {
    // Load initial state (using same key as background.ts)
    chrome.storage.local.get(['isEnabled'], (result) => {
      setIsEnabled(result.isEnabled ?? false);
    });
  }, []);

  const handleToggle = async () => {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'TOGGLE_EXTENSION' });
      if (response) {
        setIsEnabled(response.isEnabled);
        
        // Only send stop message when actually toggling OFF
        if (!response.isEnabled) {
          console.log('🛑 Extension deactivation - stopping voice recognition');
          try {
            await chrome.runtime.sendMessage({ type: 'STOP_VOICE_RECOGNITION' });
          } catch (error) {
            console.error('Failed to stop voice recognition:', error);
          }
        } else {
          console.log('✅ Extension activated - voice assistant ready');
        }
      }
    } catch (error) {
      console.error('Toggle failed:', error);
      // Reload current state from storage on error
      chrome.storage.local.get(['isEnabled'], (result) => {
        setIsEnabled(result.isEnabled ?? false);
      });
    }
  };

  return (
    <div className="popup-container">
      <div className="header">
        <h1>🤖 AI Email Assistant</h1>
        <p className="subtitle">Voice-powered Gmail automation</p>
      </div>
      
      <div className="toggle-container">
        <div className="toggle-info">
          <span className="status-label">Voice Assistant:</span>
          <span className={`status-value ${isEnabled ? 'active' : 'inactive'}`}>
            {isEnabled ? '🟢 Active' : '🔴 Inactive'}
          </span>
        </div>
        <button 
          onClick={handleToggle}
          className={`toggle-button ${isEnabled ? 'enabled' : 'disabled'}`}
        >
          {isEnabled ? 'Turn Off' : 'Turn On'}
        </button>
      </div>

      {isEnabled && <VoiceRecognition />}

      {!isEnabled && (
        <div className="instructions">
          <h3>📋 How to use:</h3>
          <ol>
            <li>Click "Turn On" above to activate the voice assistant</li>
            <li>The assistant will automatically start listening</li>
            <li>Just speak naturally to give commands</li>
            <li>Examples: "Read my emails", "Compose new email", "Reply to the first email"</li>
          </ol>
        </div>
      )}

      <style>{`
        .popup-container {
          width: 350px;
          padding: 20px;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif;
          background: #f8f9fa;
        }

        .header {
          text-align: center;
          margin-bottom: 20px;
        }

        h1 {
          margin: 0 0 8px 0;
          color: #333;
          font-size: 20px;
          font-weight: 600;
        }

        .subtitle {
          margin: 0;
          color: #666;
          font-size: 14px;
        }

        .toggle-container {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 20px;
          padding: 16px;
          background: white;
          border-radius: 8px;
          box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }

        .toggle-info {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }

        .status-label {
          font-size: 14px;
          color: #666;
          font-weight: 500;
        }

        .status-value {
          font-size: 16px;
          font-weight: 600;
        }

        .status-value.active {
          color: #28a745;
        }

        .status-value.inactive {
          color: #dc3545;
        }

        .toggle-button {
          padding: 10px 20px;
          border: none;
          border-radius: 6px;
          cursor: pointer;
          font-weight: 600;
          font-size: 14px;
          transition: all 0.3s ease;
          min-width: 80px;
        }

        .toggle-button.enabled {
          background-color: #dc3545;
          color: white;
        }

        .toggle-button.disabled {
          background-color: #28a745;
          color: white;
        }

        .toggle-button:hover {
          opacity: 0.9;
          transform: translateY(-1px);
        }

        .instructions {
          background: white;
          padding: 16px;
          border-radius: 8px;
          box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }

        .instructions h3 {
          margin: 0 0 12px 0;
          color: #333;
          font-size: 16px;
        }

        .instructions ol {
          margin: 0;
          padding-left: 20px;
          color: #555;
        }

        .instructions li {
          margin-bottom: 8px;
          line-height: 1.4;
          font-size: 14px;
        }
      `}</style>
    </div>
  )
}

export default IndexPopup
