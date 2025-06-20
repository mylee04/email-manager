from fastapi import FastAPI, HTTPException, UploadFile, File, WebSocket, WebSocketDisconnect
from pydantic import BaseModel
from typing import Optional, Dict, Any, List
from datetime import datetime
import uuid

import uvicorn
import logging
from fastapi.middleware.cors import CORSMiddleware
import asyncio
import json
import base64
import io
import wave
from google.cloud import speech
import os
from dotenv import load_dotenv
import threading
import queue
from concurrent.futures import ThreadPoolExecutor
import subprocess
import tempfile
import time

# Browser-Use imports
from browser_use import Agent
from langchain_google_genai import ChatGoogleGenerativeAI

# Environment variables loading (.env file if exists)
load_dotenv()

# Logging setup
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="Email Manager Backend")

# Google Cloud Speech-to-Text client initialization
try:
    # Use service account key with priority
    if os.getenv('GOOGLE_APPLICATION_CREDENTIALS'):
        # Use service account key file
        speech_client = speech.SpeechClient()
        logger.info("Google Speech-to-Text client initialized with service account")
    else:
        speech_client = None
        logger.warning("Google Cloud service account credentials not found. Speech-to-Text will not be available.")
except Exception as e:
    speech_client = None
    logger.error(f"Failed to initialize Google Speech-to-Text client: {e}")

# LLM client initialization (for Browser-Use Agent)
llm_client = None
try:
    # Check Google Gemini API key
    if os.getenv('GOOGLE_API_KEY'):
        # Select model from environment variable, default is gemini-2.0-flash-exp (Vision built-in)
        model_name = os.getenv('GEMINI_MODEL', 'gemini-2.0-flash-exp')
        
        # All Gemini models have built-in Vision capabilities (confirmed by Google official docs)
        supported_models = [
            'gemini-2.0-flash-exp',     # Latest experimental model (Vision built-in)
            'gemini-2.0-flash',         # Stable latest model (Vision built-in)
            'gemini-2.5-pro-exp',       # High-performance experimental model (Vision built-in)
            'gemini-1.5-pro',           # Stable high-performance model (Vision built-in)
            'gemini-1.5-flash',         # Fast model (Vision built-in)
        ]
        if model_name not in supported_models:
            logger.warning(f"Model {model_name} not in supported list. Using gemini-2.0-flash-exp")
            model_name = 'gemini-2.0-flash-exp'
        
        llm_client = ChatGoogleGenerativeAI(
            model=model_name,
            temperature=0.1,
            google_api_key=os.getenv('GOOGLE_API_KEY'),
            convert_system_message_to_human=True,  # For Gemini compatibility
            max_tokens=512,  # Limit token usage to save quota (reduced further)
            max_retries=1,  # Limit retry attempts
            timeout=30  # Set timeout (changed from request_timeout)
        )
        logger.info(f"LLM client initialized with Google {model_name} (Vision capabilities built-in)")
        logger.info("✅ Computer Vision ready for Browser-Use Agent (all Gemini models support Vision)")
        logger.info("🔧 Quota saving mode: max_tokens=512, max_retries=1, timeout=30s")
    else:
        logger.warning("GOOGLE_API_KEY not found. Browser automation will not be available.")
        logger.info("Please set GOOGLE_API_KEY in your .env file to use Gemini models")
except Exception as e:
    llm_client = None
    logger.error(f"Failed to initialize Gemini LLM client: {e}")

# CORS setup
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "chrome-extension://ipdkihelfbajghdodlkeibjgmmaecjip",  # Actual extension ID
        "https://mail.google.com",  # Add Gmail domain
        "http://localhost:8000",
        "http://127.0.0.1:8000"
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class CommandRequest(BaseModel):
    command: str
    params: Optional[Dict[str, Any]] = None

class CommandResponse(BaseModel):
    success: bool
    message: str
    data: Optional[Dict[str, Any]] = None

class AudioTranscriptionRequest(BaseModel):
    audio_data: str  # Base64 encoded audio data
    language_code: str = "en-US"  # Default to English
    sample_rate: int = 16000

class TranscriptionResponse(BaseModel):
    success: bool
    transcript: str
    confidence: float
    error: Optional[str] = None

# WebSocket connection management
class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)

    async def send_personal_message(self, message: str, websocket: WebSocket):
        await websocket.send_text(message)

manager = ConnectionManager()

# Global variable for request frequency limitation
last_ai_request_time = 0
AI_REQUEST_COOLDOWN = 2.0  # 2 seconds interval for AI request limitation

# Global variable for browser session reuse
global_browser_session = None
global_agent = None

# 연속 대화 상태 관리를 위한 데이터 클래스들
from dataclasses import dataclass, field
from typing import List as TypingList

@dataclass
class ConversationTurn:
    id: str
    user_input: str
    ai_response: str
    timestamp: datetime
    action_performed: Optional[str] = None
    processing_time: float = 0.0

@dataclass 
class ConversationContext:
    turn_history: TypingList[ConversationTurn] = field(default_factory=list)
    last_user_query: Optional[str] = None
    last_ai_response: Optional[str] = None
    extracted_entities: Dict[str, Any] = field(default_factory=dict)
    session_start_time: datetime = field(default_factory=datetime.now)
    turn_count: int = 0

@dataclass
class ConversationState:
    session_id: str
    status: str  # 'idle' | 'listening' | 'processing_stt' | 'awaiting_ai' | 'ai_responding' | 'ready_for_input'
    context: ConversationContext
    websocket_connected: bool = False
    speech_thread_active: bool = False
    browser_session_id: Optional[str] = None
    last_activity: datetime = field(default_factory=datetime.now)

class ContinuousConversationManager:
    """연속 대화를 관리하는 핵심 클래스"""
    
    def __init__(self):
        self.active_sessions: Dict[str, ConversationState] = {}
        self.browser_sessions: Dict[str, Any] = {}  # BrowserSession 객체들
        self.session_websockets: Dict[str, WebSocket] = {}
        
    async def create_session(self, websocket: WebSocket) -> str:
        """Create new conversation session"""
        session_id = str(uuid.uuid4())
        
        conversation_state = ConversationState(
            session_id=session_id,
            status='idle',
            context=ConversationContext(),
            websocket_connected=True
        )
        
        self.active_sessions[session_id] = conversation_state
        self.session_websockets[session_id] = websocket
        
        logger.info(f"🆕 New conversation session created: {session_id}")
        return session_id
    
    async def update_session_status(self, session_id: str, new_status: str):
        """Update session status"""
        if session_id in self.active_sessions:
            self.active_sessions[session_id].status = new_status
            self.active_sessions[session_id].last_activity = datetime.now()
            logger.info(f"🔄 Session {session_id} status changed: {new_status}")
    
    async def add_conversation_turn(self, session_id: str, user_input: str, ai_response: str, action_performed: Optional[str] = None):
        """Record conversation turn"""
        if session_id not in self.active_sessions:
            return
            
        turn = ConversationTurn(
            id=str(uuid.uuid4()),
            user_input=user_input,
            ai_response=ai_response,
            timestamp=datetime.now(),
            action_performed=action_performed
        )
        
        state = self.active_sessions[session_id]
        state.context.turn_history.append(turn)
        state.context.last_user_query = user_input
        state.context.last_ai_response = ai_response
        state.context.turn_count += 1
        
        logger.info(f"📝 Session {session_id} conversation turn added (total {state.context.turn_count} turns)")
    
    async def get_session_context(self, session_id: str) -> Optional[ConversationContext]:
        """Return session conversation context"""
        if session_id in self.active_sessions:
            return self.active_sessions[session_id].context
        return None
    
    async def send_ready_signal(self, session_id: str):
        """Send ready signal to client for next turn"""
        if session_id not in self.session_websockets:
            return
            
        websocket = self.session_websockets[session_id]
        ready_message = {
            "type": "ready_for_next",
            "status": "Ready for your next command",
            "session_id": session_id,
            "timestamp": datetime.now().isoformat()
        }
        
        try:
            await websocket.send_text(json.dumps(ready_message))
            await self.update_session_status(session_id, 'ready_for_input')
            logger.info(f"🔄 Session {session_id} ready signal sent")
        except Exception as e:
            logger.error(f"❌ Failed to send ready signal (session {session_id}): {e}")
    
    def get_or_create_browser_session(self, session_id: str):
        """Get or create browser instance for session"""
        if session_id not in self.browser_sessions:
            # Create session-specific user_data_dir
            browser_profile_dir = f"browser_use/browser_profile_{session_id}"
            # Browser session will be created when needed
            self.browser_sessions[session_id] = None
            logger.info(f"🌐 Browser profile prepared for session {session_id}: {browser_profile_dir}")
        
        return self.browser_sessions.get(session_id)
    
    async def cleanup_session(self, session_id: str):
        """Clean up session (including browser)"""
        logger.info(f"🧹 Starting cleanup for session {session_id}")
        
        # Clean up browser session
        if session_id in self.browser_sessions and self.browser_sessions[session_id]:
            try:
                browser_session = self.browser_sessions[session_id]
                if hasattr(browser_session, 'stop'):
                    browser_session.stop()
                del self.browser_sessions[session_id]
                logger.info(f"🌐 Browser cleanup completed for session {session_id}")
            except Exception as e:
                logger.error(f"❌ Browser cleanup failed (session {session_id}): {e}")
        
        # Clean up conversation state
        if session_id in self.active_sessions:
            del self.active_sessions[session_id]
        
        if session_id in self.session_websockets:
            del self.session_websockets[session_id]
            
        logger.info(f"✅ Session {session_id} cleanup completed")

# 전역 연속 대화 매니저 인스턴스
conversation_manager = ContinuousConversationManager()

@app.post("/api/command", response_model=CommandResponse)
async def process_command(request: CommandRequest):
    try:
        logger.info(f"Received command: {request.command}")
        
        # Here implement the actual command processing logic
        # For example: summarizing emails, generating replies, etc.
        
        return CommandResponse(
            success=True,
            message=f"Successfully processed command: {request.command}",
            data={"status": "processed"}
        )
    except Exception as e:
        logger.error(f"Error processing command: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/transcribe", response_model=TranscriptionResponse)
async def transcribe_audio(request: AudioTranscriptionRequest):
    """
    Use Google Speech-to-Text API to convert audio to text
    """
    if not speech_client:
        return TranscriptionResponse(
            success=False,
            transcript="",
            confidence=0.0,
            error="Google Speech-to-Text service not available"
        )
    
    try:
        # Base64 decoding
        audio_data = base64.b64decode(request.audio_data)
        
        # Google Speech-to-Text setup (automatic sampling rate detection)
        config = speech.RecognitionConfig(
            encoding=speech.RecognitionConfig.AudioEncoding.WEBM_OPUS,  # Commonly used in web
            # sample_rate_hertz=request.sample_rate,  # Removed for automatic detection
            language_code=request.language_code,
            enable_automatic_punctuation=True,  # Automatic punctuation
            enable_word_time_offsets=True,  # Word-level timestamp
            model="latest_long",  # Use latest model
        )
        
        audio = speech.RecognitionAudio(content=audio_data)
        
        # Speech recognition
        response = speech_client.recognize(config=config, audio=audio)
        
        if response.results:
            result = response.results[0]
            transcript = result.alternatives[0].transcript
            confidence = result.alternatives[0].confidence
            
            logger.info(f"Transcription successful: {transcript}")
            
            return TranscriptionResponse(
                success=True,
                transcript=transcript,
                confidence=confidence
            )
        else:
            return TranscriptionResponse(
                success=False,
                transcript="",
                confidence=0.0,
                error="No speech detected"
            )
            
    except Exception as e:
        logger.error(f"Transcription error: {str(e)}")
        return TranscriptionResponse(
            success=False,
            transcript="",
            confidence=0.0,
            error=str(e)
        )

@app.websocket("/ws/speech")
async def websocket_speech_endpoint(websocket: WebSocket):
    """
    WebSocket endpoint supporting continuous conversation
    """
    await manager.connect(websocket)
    
    if not speech_client:
        await websocket.send_text(json.dumps({
            "error": "Google Speech-to-Text service not available"
        }))
        return
    
    # Create new conversation session
    session_id = await conversation_manager.create_session(websocket)
    
    try:
        # Session-specific audio queue and events
        audio_queue = queue.Queue()
        stop_event = threading.Event()
        
        # Streaming configuration
        config = speech.StreamingRecognitionConfig(
            config=speech.RecognitionConfig(
                encoding=speech.RecognitionConfig.AudioEncoding.WEBM_OPUS,
                sample_rate_hertz=16000,
                language_code="en-US",
                enable_automatic_punctuation=True,
                model="latest_short",
                use_enhanced=True,  # Better accuracy
                metadata=speech.RecognitionMetadata(
                    interaction_type=speech.RecognitionMetadata.InteractionType.VOICE_COMMAND,
                    microphone_distance=speech.RecognitionMetadata.MicrophoneDistance.NEARFIELD,
                    recording_device_type=speech.RecognitionMetadata.RecordingDeviceType.PC,
                ),
            ),
            interim_results=True,
            single_utterance=False,  # Support continuous conversation
            enable_voice_activity_events=True,  # Better silence detection
        )
        
        # Audio request generator
        def generate_requests():
            logger.info(f"🎙️ [Session {session_id}] Audio request generator started")
            while not stop_event.is_set():
                try:
                    chunk = audio_queue.get(timeout=1.0)
                    if chunk is None:
                        logger.info(f"🛑 [Session {session_id}] Generator received termination signal")
                        break
                    if len(chunk) > 0:
                        logger.debug(f"🎵 [Session {session_id}] Yielding audio chunk: {len(chunk)} bytes")
                        yield speech.StreamingRecognizeRequest(audio_content=chunk)
                except queue.Empty:
                    logger.debug(f"⏰ [Session {session_id}] Audio queue timeout, continuing...")
                    continue
                except Exception as e:
                    logger.error(f"[Session {session_id}] Generator error: {str(e)}")
                    break
            logger.info(f"🏁 [Session {session_id}] Audio request generator terminated")
        
        # 메인 이벤트 루프 참조
        main_loop = asyncio.get_running_loop()
        
        # Speech processing thread for continuous conversation
        def process_speech():
            try:
                logger.info(f"🎤 [Session {session_id}] Google Speech API streaming started")
                asyncio.run_coroutine_threadsafe(
                    conversation_manager.update_session_status(session_id, 'listening'), 
                    main_loop
                ).result()
                
                # Infinite loop for continuous conversation
                while not stop_event.is_set():
                    try:
                        # Clear queue before starting new stream
                        while not audio_queue.empty():
                            try:
                                audio_queue.get_nowait()
                            except queue.Empty:
                                break
                        
                        # Wait for audio data before starting stream to avoid timeout
                        logger.info(f"⏳ [Session {session_id}] Waiting for audio data before starting stream...")
                        first_chunk = None
                        try:
                            # Wait for first audio chunk (blocking) - increased timeout for continuous conversation
                            first_chunk = audio_queue.get(timeout=300.0)  # Wait up to 5 minutes
                            if first_chunk is None:
                                logger.info(f"🛑 [Session {session_id}] Received termination signal, exiting")
                                break
                        except queue.Empty:
                            logger.info(f"⏰ [Session {session_id}] No audio data received in 5 minutes, continuing to wait...")
                            # In continuous mode, keep waiting instead of breaking
                            if asyncio.run_coroutine_threadsafe(
                                websocket.send_text(json.dumps({
                                    "type": "ping",
                                    "message": "Still listening for your command...",
                                    "session_id": session_id
                                })), 
                                main_loop
                            ).result(timeout=1.0):
                                continue
                            else:
                                logger.warning(f"[Session {session_id}] Failed to send ping, connection may be lost")
                                break
                        
                        # Put the first chunk back for the generator
                        audio_queue.put(first_chunk)
                        
                        logger.info(f"🔄 [Session {session_id}] Starting new speech recognition stream with audio data")
                        requests_iterator = generate_requests()
                        responses = speech_client.streaming_recognize(config, requests_iterator)
                        logger.info(f"✅ [Session {session_id}] Speech recognition stream created successfully")
                        
                        for response in responses:
                            if stop_event.is_set():
                                logger.info(f"🛑 [Session {session_id}] Stop event detected")
                                return
                            
                            # Error check
                            if response.error.code != 0:
                                logger.error(f"[Session {session_id}] Speech API error: {response.error.message}")
                                continue
                                
                            for result in response.results:
                                if not result.alternatives:
                                    continue
                                    
                                transcript = result.alternatives[0].transcript
                                confidence = getattr(result.alternatives[0], 'confidence', 1.0)
                                
                                logger.info(f"📝 [Session {session_id}] Recognition result: {transcript} (final: {result.is_final})")
                                
                                if result.is_final:
                                    # Final result - update session status
                                    asyncio.run_coroutine_threadsafe(
                                        conversation_manager.update_session_status(session_id, 'processing_stt'), 
                                        main_loop
                                    ).result()
                                    
                                    logger.info(f"🤖 [Session {session_id}] Sending command to AI agent: {transcript}")
                                    
                                    # Step 1: Processing start notification
                                    processing_message = json.dumps({
                                        "transcript": transcript,
                                        "confidence": confidence,
                                        "is_final": True,
                                        "processing": True,
                                        "status": "Processing your request...",
                                        "session_id": session_id,
                                        "timestamp": datetime.now().isoformat()
                                    })
                                    
                                    try:
                                        future = asyncio.run_coroutine_threadsafe(
                                            websocket.send_text(processing_message), 
                                            main_loop
                                        )
                                        future.result(timeout=1.0)
                                        logger.info(f"✅ [Session {session_id}] Processing start notification sent")
                                    except Exception as send_error:
                                        logger.error(f"[Session {session_id}] Failed to send processing start notification: {str(send_error)}")
                                    
                                    # Step 2: Execute AI processing
                                    try:
                                        # Session context-based AI processing
                                        future = asyncio.run_coroutine_threadsafe(
                                            handle_final_transcript_with_session(session_id, websocket, transcript, confidence), 
                                            main_loop
                                        )
                                        ai_response = future.result(timeout=60.0)
                                        
                                        # Step 3: Record conversation turn
                                        asyncio.run_coroutine_threadsafe(
                                            conversation_manager.add_conversation_turn(session_id, transcript, ai_response), 
                                            main_loop
                                        ).result()
                                        
                                        # Step 4: Send ready signal for next turn
                                        asyncio.run_coroutine_threadsafe(
                                            conversation_manager.send_ready_signal(session_id), 
                                            main_loop
                                        ).result()
                                        
                                        logger.info(f"🔄 [Session {session_id}] Continuous conversation mode: Waiting for next command...")
                                        
                                        # IMPORTANT: Break the current stream to start a new one for continuous conversation
                                        logger.info(f"🔄 [Session {session_id}] Breaking current stream to start fresh for next command")
                                        break  # Exit the response loop to start a new stream
                                        
                                    except Exception as e:
                                        logger.error(f"[Session {session_id}] Final speech processing error: {str(e)}")
                                        
                                        # Send error message
                                        error_message = json.dumps({
                                            "transcript": transcript,
                                            "confidence": confidence,
                                            "is_final": True,
                                            "ai_response": f"Sorry, there was an issue processing your command: {str(e)}",
                                            "session_id": session_id,
                                            "timestamp": datetime.now().isoformat()
                                        })
                                        
                                        try:
                                            future = asyncio.run_coroutine_threadsafe(
                                                websocket.send_text(error_message), 
                                                main_loop
                                            )
                                            future.result(timeout=1.0)
                                            
                                            # Send ready signal even after error for continuous conversation
                                            asyncio.run_coroutine_threadsafe(
                                                conversation_manager.send_ready_signal(session_id), 
                                                main_loop
                                            ).result()
                                            
                                        except Exception as send_error:
                                            logger.error(f"[Session {session_id}] Failed to send error message: {str(send_error)}")
                                else:
                                    # Interim result
                                    message = json.dumps({
                                        "transcript": transcript,
                                        "is_final": False,
                                        "session_id": session_id
                                    })
                                    
                                    try:
                                        future = asyncio.run_coroutine_threadsafe(
                                            websocket.send_text(message), 
                                            main_loop
                                        )
                                        future.result(timeout=1.0)
                                    except Exception as e:
                                        logger.error(f"[Session {session_id}] Interim result send error: {str(e)}")
                    
                    except Exception as stream_error:
                        logger.error(f"[Session {session_id}] Speech stream error: {str(stream_error)}")
                        if not stop_event.is_set():
                            logger.info(f"🔄 [Session {session_id}] Attempting to restart speech stream...")
                            
                            # Clear queue before restart
                            queue_size = audio_queue.qsize()
                            logger.info(f"📊 [Session {session_id}] Clearing audio queue (size: {queue_size})")
                            while not audio_queue.empty():
                                try:
                                    audio_queue.get_nowait()
                                except queue.Empty:
                                    break
                            logger.info(f"✅ [Session {session_id}] Audio queue cleared, waiting 2 seconds before restart")
                            time.sleep(2)
                            continue
                        else:
                            logger.info(f"🛑 [Session {session_id}] Stop event set, breaking from stream loop")
                            break
                            
            except Exception as e:
                logger.error(f"[Session {session_id}] Speech processing error: {str(e)}")
                try:
                    future = asyncio.run_coroutine_threadsafe(
                        websocket.send_text(json.dumps({
                            "error": str(e),
                            "session_id": session_id
                        })),
                        main_loop
                    )
                    future.result(timeout=1.0)
                except Exception as send_error:
                    logger.error(f"[Session {session_id}] Failed to send error message: {str(send_error)}")
                    
            finally:
                logger.info(f"🏁 [Session {session_id}] Speech processing thread terminated")
        
        # Start Speech processing thread
        speech_thread = threading.Thread(target=process_speech)
        speech_thread.start()
        
        # Receive data from WebSocket (both audio and control messages)
        try:
            logger.info("🔗 WebSocket audio reception start")
            while True:
                try:
                    # Use generic receive to handle both bytes and text
                    message = await websocket.receive()
                    
                    if "bytes" in message:
                        # Audio data
                        data = message["bytes"]
                        if not data:
                            logger.info("📭 Empty data reception, connection end")
                            break
                        
                        logger.debug(f"📥 Received audio chunk: {len(data)} bytes")
                        # Add audio data to queue (immediate processing)
                        audio_queue.put(data)
                        
                    elif "text" in message:
                        # Control message
                        try:
                            control_msg = json.loads(message["text"])
                            if control_msg.get("type") == "STOP_RECORDING":
                                logger.info(f"🛑 [Session {session_id}] Stop recording signal received: {control_msg.get('reason', 'No reason provided')}")
                                stop_event.set()
                                audio_queue.put(None)  # Signal to stop audio processing
                                break
                            elif control_msg.get("type") == "KEEP_ALIVE":
                                logger.debug(f"📡 [Session {session_id}] Keep-alive message received")
                                # Send acknowledgment
                                await websocket.send_text(json.dumps({
                                    "type": "keep_alive_ack",
                                    "session_id": session_id,
                                    "timestamp": datetime.now().isoformat()
                                }))
                        except json.JSONDecodeError:
                            logger.warning(f"[Session {session_id}] Invalid JSON control message: {message['text']}")
                    
                    elif message.get("type") == "websocket.disconnect":
                        logger.info(f"🔌 [Session {session_id}] WebSocket disconnect received")
                        break
                        
                except asyncio.CancelledError:
                    logger.info("⚠️ WebSocket reception canceled")
                    break
                except Exception as e:
                    logger.error(f"Audio reception error: {str(e)}")
                    break
                
        except WebSocketDisconnect:
            logger.info(f"🔌 [Session {session_id}] WebSocket normal disconnection")
        except Exception as e:
            logger.error(f"[Session {session_id}] WebSocket processing error: {str(e)}")
        finally:
            # Cleanup tasks
            logger.info(f"🧹 [Session {session_id}] Starting cleanup")
            stop_event.set()
            audio_queue.put(None)  # Termination signal
            
            # Wait for thread termination
            if speech_thread.is_alive():
                logger.info(f"⏳ [Session {session_id}] Waiting for speech thread termination...")
                speech_thread.join(timeout=5.0)
                if speech_thread.is_alive():
                    logger.warning(f"⚠️ [Session {session_id}] Speech thread did not terminate normally")
                else:
                    logger.info(f"✅ [Session {session_id}] Speech thread terminated normally")
            
            # Session cleanup
            await conversation_manager.cleanup_session(session_id)
            
            # Remove from connection manager
            manager.disconnect(websocket)
            logger.info(f"🏁 [Session {session_id}] WebSocket endpoint cleanup completed")

    except Exception as e:
        logger.error(f"[Session {session_id}] WebSocket endpoint error: {str(e)}")
    finally:
        # Final cleanup
        if 'stop_event' in locals():
            stop_event.set()
        if 'audio_queue' in locals():
            try:
                audio_queue.put(None)
            except:
                pass
        if 'session_id' in locals():
            await conversation_manager.cleanup_session(session_id)
        manager.disconnect(websocket)

async def audio_stream_generator(websocket: WebSocket):
    """
    Generator to process audio stream received from WebSocket
    """
    try:
        while True:
            # Receive audio data from WebSocket
            data = await websocket.receive_bytes()
            if not data:
                break
            yield data
    except WebSocketDisconnect:
        logger.info("WebSocket connection end")
    except Exception as e:
        logger.error(f"WebSocket error: {str(e)}")
        raise

@app.get("/api/health")
async def health_check():
    return {
        "status": "healthy",
        "speech_to_text_available": speech_client is not None
    }

@app.get("/api/speech/status")
async def speech_status():
    """
    Check Speech-to-Text service status
    """
    return {
        "available": speech_client is not None,
        "service": "Google Cloud Speech-to-Text" if speech_client else "Not configured"
    }

# Real-time AI response processing function
async def send_transcript_and_process(websocket: WebSocket, transcript: str, confidence: float):
    """Send speech recognition result to client and process AI agent"""
    try:
        # Simple greeting response immediately (without Browser-Use Agent)
        transcript_lower = transcript.lower()
        if "hello" in transcript_lower or "hi" in transcript_lower:
            ai_response = "Hello! I'm here to help you manage your Gmail emails. What can I do for you?"
        else:
            # Process with Browser-Use Agent
            ai_response = await process_voice_command_async(transcript)
        
        # Send final result to client
        await websocket.send_text(json.dumps({
            "transcript": transcript,
            "confidence": confidence,
            "is_final": True,
            "ai_response": ai_response,
            "timestamp": datetime.now().isoformat()
        }))
        
        logger.info(f"✅ Real-time response sent completed: {transcript[:50]}...")
        
    except Exception as e:
        logger.error(f"AI response processing error: {str(e)}")
        # Send basic speech recognition result even if error occurs
        await websocket.send_text(json.dumps({
            "transcript": transcript,
            "confidence": confidence,
            "is_final": True,
            "error": "Error occurred during AI processing",
            "timestamp": datetime.now().isoformat()
        }))

# Session-based final speech processing function
async def handle_final_transcript_with_session(session_id: str, websocket: WebSocket, transcript: str, confidence: float) -> str:
    """Process final speech recognition result using session context"""
    try:
        logger.info(f"🎤 [Session {session_id}] Final speech recognition: {transcript}")
        
        # Update session status
        await conversation_manager.update_session_status(session_id, 'awaiting_ai')
        
        # Get session context
        context = await conversation_manager.get_session_context(session_id)
        
        # AI processing with context
        if "email" in transcript.lower():
            status_message = json.dumps({
                "transcript": transcript,
                "confidence": confidence,
                "is_final": True,
                "processing": True,
                "status": "Analyzing your request and opening Gmail...",
                "session_id": session_id,
                "timestamp": datetime.now().isoformat()
            })
            await websocket.send_text(status_message)
            logger.info(f"📧 [Session {session_id}] Gmail processing start notification sent")
        
        # Generate AI response based on session context
        ai_response = await process_voice_command_with_context(session_id, transcript, context)
        
        # Update session status
        await conversation_manager.update_session_status(session_id, 'ai_responding')

        # Send final response
        final_message = json.dumps({
            "transcript": transcript,
            "confidence": confidence,
            "is_final": True,
            "ai_response": ai_response,
            "processing": False,
            "session_id": session_id,
            "timestamp": datetime.now().isoformat()
        })
        await websocket.send_text(final_message)
        logger.info(f"✅ [Session {session_id}] Final response sent: {ai_response[:50]}...")
        
        # Enhanced Gmail task instruction with login detection
        task_instruction = f"""
You are helping with Gmail email management. 

IMPORTANT INSTRUCTIONS:
1. First, check if Gmail is already logged in by looking for Gmail interface elements
2. If you see Gmail inbox, compose button, or email list - proceed directly with the email task
3. If you see a login page, try to log in, but if you encounter reCAPTCHA or 2FA, explain that you cannot proceed
4. Focus on the current Gmail tab/window that the user already has open

Task: {ai_response}

Be concise and efficient. If Gmail is already accessible, start the email task immediately.
"""
        
        return ai_response
        
    except Exception as e:
        logger.error(f"[Session {session_id}] Final speech processing error: {str(e)}")
        error_response = f"Sorry, there was an issue processing your command: {str(e)}"
        
        error_message = json.dumps({
            "transcript": transcript,
            "confidence": confidence,
            "is_final": True,
            "ai_response": error_response,
            "processing": False,
            "session_id": session_id,
            "timestamp": datetime.now().isoformat()
        })
        await websocket.send_text(error_message)
        
        return error_response

# Context-based voice command processing function
async def process_voice_command_with_context(session_id: str, transcript: str, context: Optional[ConversationContext]) -> str:
    """Process voice command using session context"""
    try:
        if not llm_client:
            return "Sorry, AI service is not initialized."
        
        logger.info(f"🤖 [Session {session_id}] Context-based AI analysis: {transcript}")
        
        # Generate prompt with context information
        context_info = ""
        if context and context.turn_history:
            recent_turns = context.turn_history[-3:]  # Use only recent 3 turns
            context_info = "\n\nRecent conversation context:\n"
            for turn in recent_turns:
                context_info += f"User: {turn.user_input}\nAssistant: {turn.ai_response}\n"
        
        # AI intent analysis (with context)
        task_instruction = await analyze_user_intent_with_ai_and_context(transcript, context_info)
        
        # 간단한 인사
        if task_instruction == "SIMPLE_GREETING":
            return "Hello! I'm here to help you manage your Gmail emails. What can I do for you?"
        
        # 브라우저 작업 필요
        elif task_instruction.startswith("BROWSER_ACTION:"):
            actual_task = task_instruction.replace("BROWSER_ACTION:", "").strip()
            logger.info(f"🚀 [Session {session_id}] Browser-Use Agent execution: {actual_task[:50]}...")
            
            # Session-based browser usage
            result = await run_browser_use_agent_with_session(session_id, actual_task)
            return result
        
        # 기본 응답
        else:
            return task_instruction
            
    except Exception as e:
        logger.error(f"[Session {session_id}] Context-based voice command processing error: {str(e)}")
        return f"Sorry, there was an issue processing your command: {str(e)}"

# Final speech result processing and handler to respond to client
async def handle_final_transcript(websocket: WebSocket, transcript: str, confidence: float):
    """Process final speech recognition result and generate AI response"""
    try:
        logger.info(f"🎤 Final speech recognition: {transcript}")
        
        # AI processing start notification (additional notification if browser work is needed)
        if "email" in transcript.lower():
            status_message = json.dumps({
                "transcript": transcript,
                "confidence": confidence,
                "is_final": True,
                "processing": True,
                "status": "Analyzing your request and opening Gmail...",
                "timestamp": datetime.now().isoformat()
            })
            await websocket.send_text(status_message)
            logger.info("📧 Gmail processing start notification sent")
        
        ai_response = await process_voice_command_async(transcript)

        # Final response send
        final_message = json.dumps({
            "transcript": transcript,
            "confidence": confidence,
            "is_final": True,
            "ai_response": ai_response,
            "processing": False,
            "timestamp": datetime.now().isoformat()
        })
        await websocket.send_text(final_message)
        logger.info(f"✅ Final response sent completed: {ai_response[:50]}...")
        
        # Continuous conversation preparation notification (important!)
        ready_message = json.dumps({
            "type": "ready_for_next",
            "status": "Ready for next command",
            "timestamp": datetime.now().isoformat()
        })
        await websocket.send_text(ready_message)
        logger.info("🔄 Continuous conversation preparation notification sent")
        
    except Exception as e:
        logger.error(f"Final speech processing error: {str(e)}")
        error_message = json.dumps({
            "transcript": transcript,
            "confidence": confidence,
            "is_final": True,
            "ai_response": f"Sorry, there was an issue processing your command: {str(e)}",
            "processing": False,
            "timestamp": datetime.now().isoformat()
        })
        await websocket.send_text(error_message)
        
        # Send continuous conversation preparation notification even if error occurs
        try:
            ready_message = json.dumps({
                "type": "ready_for_next",
                "status": "Ready for next command (after error)",
                "timestamp": datetime.now().isoformat()
            })
            await websocket.send_text(ready_message)
            logger.info("🔄 Error after continuous conversation preparation notification sent")
        except Exception as ready_error:
            logger.error(f"Continuous conversation preparation notification send failed: {str(ready_error)}")

# Gmail automation processing based on Chrome Extension
async def process_voice_command_async(transcript: str) -> str:
    """Process speech command naturally by AI"""
    try:
        if not llm_client:
            return "Sorry, AI service is not initialized."
        
        logger.info(f"🤖 AI is analyzing speech command: {transcript}")
        
        # [1st step] Request AI to analyze user intent and convert it to Browser-Use Task
        task_instruction = await analyze_user_intent_with_ai(transcript)
        
        # AI determined if it's just a greeting
        if task_instruction == "SIMPLE_GREETING":
            return "Hello! I'm here to help you manage your Gmail emails. What can I do for you?"
        
        # AI determined if browser work is needed
        elif task_instruction.startswith("BROWSER_ACTION:"):
            actual_task = task_instruction.replace("BROWSER_ACTION:", "").strip()
            logger.info(f"🚀 Browser-Use Agent execution: {actual_task[:50]}...")
            
            # [2nd step] Execute Browser-Use Agent with generated Task
            result = await run_browser_use_agent(actual_task)
            
            logger.info(f"✅ Browser-Use Agent work completed")
            return result
        
        # AI generated if it's a general conversational response
        else:
            return task_instruction
        
    except Exception as e:
        logger.error(f"AI command processing error: {str(e)}")
        return f"Sorry, there was an issue processing your command: {str(e)}"

async def analyze_user_intent_with_ai(transcript: str) -> str:
    """AI analyzes natural conversation and determines appropriate action"""
    global last_ai_request_time
    
    try:
        # Request frequency limitation (quota saving)
        current_time = time.time()
        if current_time - last_ai_request_time < AI_REQUEST_COOLDOWN:
            logger.info(f"⏳ AI request cooldown... ({AI_REQUEST_COOLDOWN} seconds wait)")
                    # Quick fallback response
        if "email" in transcript.lower():
            return f"BROWSER_ACTION: First check if Gmail is already open and logged in, if yes proceed directly to check emails in the inbox and provide a detailed summary, if not logged in navigate to Gmail and login first."
        else:
            return "Please wait a moment. Processing your request..."
        
        last_ai_request_time = current_time
        
        # Grant role to LLM and let it determine action based on user's speech
        prompt = f"""
You are a helpful assistant guiding an AI agent to issue instructions to control Gmail.
Listen to the user's next words and convert them into a clear and concise one-sentence instruction for the AI agent to perform a task on the browser.

User: "{transcript}"

Judgment rules:
1. If the user's words are simple greetings ("hello", "hi") or unrelated conversation, respond with "SIMPLE_GREETING" only.
2. If the user's words are related to checking, composing, or searching emails in Gmail, respond with "BROWSER_ACTION: [specific task instruction]" in the format.
   - Example 1: "Check unread emails" -> "BROWSER_ACTION: First check if Gmail is already open and logged in, if yes proceed directly to check unread emails in the inbox and provide a detailed summary of senders and subjects, if not logged in navigate to Gmail and login."
   - Example 2: "New email?" -> "BROWSER_ACTION: First check if Gmail is already open and logged in, if yes check for new emails in the inbox and count them, if not logged in navigate to Gmail and login first."
   - Example 3: "Send email to Minjun" -> "BROWSER_ACTION: First check if Gmail is already open and logged in, if yes compose a new email to 'Minjun', if not logged in navigate to Gmail and login first."

Important: 
- Always start Gmail tasks by checking if Gmail is already accessible
- For email checking tasks, you must instruct to provide the results (count, sender, subject, etc.)
- If Gmail is already open and logged in, skip the login process completely

Please make the most appropriate judgment.
"""

        # LangChain ChatGoogleGenerativeAI call pattern
        from langchain.schema import HumanMessage
        messages = [HumanMessage(content=prompt)]
        response = await llm_client.ainvoke(messages)
        result = response.content.strip()
        
        logger.info(f"🧠 AI intent analysis result: {result[:50]}...")
        return result
        
    except Exception as e:
        logger.error(f"AI intent analysis error: {str(e)}")
        # Fallback: Process basic Gmail work
        if "email" in transcript.lower():
            return f"BROWSER_ACTION: First check if Gmail is already open and logged in, if yes proceed directly to check emails in the inbox and provide a detailed summary, if not logged in navigate to Gmail and login first."
        else:
            return "Yes, how can I help you?"

# Context-aware AI intent analysis function
async def analyze_user_intent_with_ai_and_context(transcript: str, context_info: str) -> str:
    """Analyze user intent with conversation context"""
    global last_ai_request_time
    
    try:
        if not llm_client:
            return "Sorry, AI service is not available."
        
        current_time = time.time()
        if current_time - last_ai_request_time < AI_REQUEST_COOLDOWN:
            logger.info(f"⏳ AI request cooldown... ({AI_REQUEST_COOLDOWN} seconds wait)")
            if "email" in transcript.lower():
                return f"BROWSER_ACTION: First check if Gmail is already open and logged in, if yes proceed directly to check emails in the inbox and provide a detailed summary, if not logged in navigate to Gmail and login first."
            else:
                return "Please wait a moment. Processing your request..."
        
        last_ai_request_time = current_time
        
        # Context-aware prompt
        prompt = f"""
You are a helpful assistant guiding an AI agent to issue instructions to control Gmail.
Listen to the user's next words and convert them into a clear and concise one-sentence instruction for the AI agent to perform a task on the browser.

{context_info}

Current User Request: "{transcript}"

Judgment rules:
1. If the user's words are simple greetings ("hello", "hi") or unrelated conversation, respond with "SIMPLE_GREETING" only.
2. If the user's words are related to checking, composing, or searching emails in Gmail, respond with "BROWSER_ACTION: [specific task instruction]" in the format.
   - Example 1: "Check unread emails" -> "BROWSER_ACTION: First check if Gmail is already open and logged in, if yes proceed directly to check unread emails in the inbox and provide a detailed summary of senders and subjects, if not logged in navigate to Gmail and login."
   - Example 2: "New email?" -> "BROWSER_ACTION: First check if Gmail is already open and logged in, if yes check for new emails in the inbox and count them, if not logged in navigate to Gmail and login first."
   - Example 3: "Send email to Minjun" -> "BROWSER_ACTION: First check if Gmail is already open and logged in, if yes compose a new email to 'Minjun', if not logged in navigate to Gmail and login first."

Consider the conversation context when making your judgment. If the user is following up on a previous request or asking for clarification, adapt the instruction accordingly.

Please make the most appropriate judgment.
"""

        from langchain.schema import HumanMessage
        messages = [HumanMessage(content=prompt)]
        response = await llm_client.ainvoke(messages)
        result = response.content.strip()
        
        logger.info(f"🧠 Context-aware AI intent analysis result: {result[:50]}...")
        return result
        
    except Exception as e:
        logger.error(f"Context-aware AI intent analysis error: {str(e)}")
        if "email" in transcript.lower():
            return f"BROWSER_ACTION: First check if Gmail is already open and logged in, if yes proceed directly to check emails in the inbox and provide a detailed summary, if not logged in navigate to Gmail and login first."
        else:
            return "Yes, how can I help you?"

# Session-based browser agent execution function
async def run_browser_use_agent_with_session(session_id: str, task_instruction: str) -> str:
    """Execute Browser-Use Agent with session management"""
    try:
        from browser_use import Agent
        from browser_use.browser import BrowserSession, BrowserProfile
        import os
        
        # Session-specific profile directory
        profile_dir = os.path.join(os.getcwd(), f"browser_profile_{session_id}")
        
        # Get or create session-specific browser
        browser_session = conversation_manager.get_or_create_browser_session(session_id)
        
        if browser_session is None:
            logger.info(f"🚀 [Session {session_id}] Create new browser session - Profile: {profile_dir}")
            
            browser_profile = BrowserProfile(
                user_data_dir=profile_dir,
                headless=False,
                keep_alive=True,
                args=[
                    "--no-first-run",
                    "--no-default-browser-check",
                    "--disable-blink-features=AutomationControlled",
                    "--disable-web-security",  # Allow cross-origin requests
                    "--disable-features=VizDisplayCompositor"  # Improve stability
                ]
            )
            
            browser_session = BrowserSession(browser_profile=browser_profile)
            await browser_session.start()
            
            # Save to session manager
            conversation_manager.browser_sessions[session_id] = browser_session
        else:
            logger.info(f"🔄 [Session {session_id}] Reuse existing browser session")
        
        # Create and run Agent
        agent = Agent(
            task=task_instruction,
            llm=llm_client,
            browser_session=browser_session
        )
        
        logger.info(f"🎯 [Session {session_id}] Agent task execution: {task_instruction[:50]}...")
        result = await agent.run(max_steps=10)
        logger.info(f"✅ [Session {session_id}] Agent execution completed - Browser session kept alive for continuous conversation")
        
        # IMPORTANT: Do NOT cleanup browser session here - keep it alive for next command
        # The browser window should remain open for continuous Gmail interactions
        
        # Return result
        return await extract_agent_result(result)
                
    except Exception as e:
        error_msg = str(e)
        logger.error(f"[Session {session_id}] Browser-Use Agent execution error: {error_msg}")
        
        # Browser profile collision error handling
        if "browser_pid" in error_msg and "already running" in error_msg:
            logger.warning("🔄 Browser profile collision detected - Clean existing session and retry")
            await conversation_manager.cleanup_session(session_id)
            return "I'm setting up a fresh browser session for you. Please try your request again in a moment."
        
        # General error handling - DO NOT cleanup browser session to keep it alive
        logger.warning(f"⚠️ Agent execution failed but keeping browser session alive: {error_msg}")
        return f"Sorry, there was an issue processing your request. The browser session is still available for your next command."

async def run_browser_use_agent(task_instruction: str) -> str:
    """[Modified] Reuse Browser-Use Agent to support continuous conversation"""
    global global_browser_session, global_agent
    
    try:
        from browser_use import Agent
        from browser_use.browser import BrowserSession, BrowserProfile
        import os
        
        # Profile folder to store login information
        profile_dir = os.path.join(os.getcwd(), "browser_profile")
        
        # Check if existing session is active
        if global_browser_session and global_agent:
            try:
                # Check if existing session is alive
                if hasattr(global_browser_session, 'browser') and global_browser_session.browser:
                    logger.info(f"🔄 Reuse existing browser session - New task: {task_instruction[:50]}...")
                    logger.info("💬 Continuous conversation mode: Use existing session without opening new browser window")
                    
                    # Create new Agent with existing browser session
                    new_agent = Agent(
                        task=task_instruction,
                        llm=llm_client,
                        browser_session=global_browser_session
                    )
                    
                    # Agent execution
                    logger.info("🎯 Agent task execution: " + task_instruction[:50] + "...")
                    result = await new_agent.run(max_steps=10)
                    logger.info(f"✅ Continuous conversation Agent execution completed")
                    
                    # Return result
                    return await extract_agent_result(result)
                    
            except Exception as reuse_error:
                logger.warning(f"⚠️ Existing session reuse failed: {str(reuse_error)}")
                logger.info("🔄 Switch to new browser session...")
                # Clean existing session
                await cleanup_browser_session()
        
        # Create new session
        logger.info(f"🚀 Start new Browser-Use Agent - Profile: {profile_dir}")
        
        # [Core] Use permanent profile to set up browser
        browser_profile = BrowserProfile(
            user_data_dir=profile_dir,
            headless=False,  # False is more convenient for debugging
            keep_alive=True,  # Browser session maintenance
            args=[
                "--no-first-run",
                "--no-default-browser-check",
                "--disable-blink-features=AutomationControlled",
                "--disable-web-security",  # Allow cross-origin requests
                "--disable-features=VizDisplayCompositor"  # Improve stability
            ]
        )
        
        # BrowserSession creation
        global_browser_session = BrowserSession(browser_profile=browser_profile)
        
        # Start session if keep_alive=True
        await global_browser_session.start()
        
        # Agent creation with browser_session
        global_agent = Agent(
            task=task_instruction,
            llm=llm_client,
            browser_session=global_browser_session
        )
        
        logger.info(f"🎯 Agent task execution: {task_instruction[:50]}...")
        
        # Agent execution (step-limited for API quota management)
        # IMPORTANT: Do not close browser after task completion for continuous conversation
        result = await global_agent.run(max_steps=10)
        
        logger.info(f"✅ Agent execution completed - Browser session kept alive for continuous conversation")
        
        # IMPORTANT: Do NOT cleanup browser session here - keep it alive for next command
        # The browser window should remain open for continuous Gmail interactions
        
        # Return result
        return await extract_agent_result(result)
                
    except Exception as e:
        error_msg = str(e)
        logger.error(f"Browser-Use Agent execution error: {error_msg}")
        
        # Browser profile collision error handling
        if "browser_pid" in error_msg and "already running" in error_msg:
            logger.warning("🔄 Browser profile collision detected - Clean existing session and retry")
            await cleanup_browser_session()
            return "I'm setting up a fresh browser session for you. Please try your request again in a moment."
        
        # General error handling - DO NOT cleanup browser session to keep it alive
        logger.warning(f"⚠️ Agent execution failed but keeping browser session alive: {error_msg}")
        return f"Sorry, there was an issue processing your request. The browser session is still available for your next command."

async def extract_agent_result(result) -> str:
    """Extract meaningful information from Agent execution result (improved)"""
    try:
        logger.info(f"🔍 Agent result extraction start - Result type: {type(result)}")
        
        # 1. Check if final_result() method exists
        if result and hasattr(result, 'final_result'):
            try:
                final_result = result.final_result()
                if final_result and str(final_result).strip():
                    logger.info(f"✅ final_result found: {final_result}")
                    return str(final_result)
            except Exception as e:
                logger.warning(f"final_result extraction failed: {str(e)}")
        
        # 2. Find extracted_content from history (most important part)
        if result and hasattr(result, 'history'):
            logger.info(f"📋 History item count: {len(result.history)}")
            
            # Collect all extracted_content
            extracted_contents = []
            
            for i, history_item in enumerate(result.history):
                logger.info(f"📝 History {i}: {type(history_item)}")
                
                if hasattr(history_item, 'result') and history_item.result:
                    for j, action_result in enumerate(history_item.result):
                        logger.info(f"    Action {j}: extracted_content={hasattr(action_result, 'extracted_content')}")
                        
                        if hasattr(action_result, 'extracted_content') and action_result.extracted_content:
                            content = action_result.extracted_content.strip()
                            if content and content not in extracted_contents:
                                extracted_contents.append(content)
                                logger.info(f"   ✅ Content found: {content[:100]}...")
            
            # Return most useful result
            if extracted_contents:
                # Select the longest and most specific result (usually the last result is the most completed form)
                best_result = max(extracted_contents, key=len)
                logger.info(f"🎯 Final selected result: {best_result[:100]}...")
                return best_result
        
        # 3. Direct string conversion attempt
        if result:
            result_str = str(result).strip()
            if result_str and result_str != "None":
                logger.info(f"📄 Direct string conversion result: {result_str[:100]}...")
                return result_str
        
        # 4. Fallback message
        logger.warning("⚠️ Unable to find extractable result")
        return "✅ Gmail work completed. Please check the result in the browser."
        
    except Exception as e:
        logger.error(f"❌ Error occurred during result extraction: {str(e)}")
        return "✅ Gmail work completed."

async def cleanup_browser_session():
    """Clean browser session"""
    global global_browser_session, global_agent
    
    try:
        if global_browser_session:
            # Browser session end (keep_alive=True, so kill() is used)
            if hasattr(global_browser_session, 'kill'):
                await global_browser_session.kill()
            logger.info("🧹 Browser session cleaned")
    except Exception as e:
        logger.error(f"Browser session cleanup error: {str(e)}")
    finally:
        global_browser_session = None
        global_agent = None

# Browser session cleanup when server ends
@app.on_event("shutdown")
async def shutdown_event():
    """Clean browser session when server ends"""
    logger.info("🛑 Server end in progress - Browser session cleanup")
    await cleanup_browser_session()

if __name__ == "__main__":
    uvicorn.run("server:app", host="127.0.0.1", port=8000, reload=True) 