import { useState, useEffect } from "react"
import { Storage } from "@plasmohq/storage"
import "./style.css"

const storage = new Storage()

function IndexPopup() {
  const [isEnabled, setIsEnabled] = useState(false)

  useEffect(() => {
    // 초기 상태 로드
    storage.get("isEnabled").then((value) => {
      setIsEnabled(value as boolean)
    })
  }, [])

  const handleToggle = async () => {
    try {
      const response = await chrome.runtime.sendMessage({ type: "TOGGLE_ENABLED" })
      if (response.success) {
        setIsEnabled(response.isEnabled)
      }
    } catch (error) {
      console.error("Error toggling state:", error)
    }
  }

  return (
    <div className="popup-container">
      <h1>AI Email Assistant</h1>
      <p>Status: <strong>{isEnabled ? "Enabled (ON)" : "Disabled (OFF)"}</strong></p>
      <div style={{ marginTop: "20px" }}>
        <label style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <input
            type="checkbox"
            checked={isEnabled}
            onChange={handleToggle}
          />
          <span>Enable AI Assistant</span>
        </label>
      </div>
      {!isEnabled && (
        <p className="help-text">
          Enable to use voice commands.
        </p>
      )}
    </div>
  )
}

export default IndexPopup 