import { NextRequest, NextResponse } from 'next/server';

async function testGeminiApiKey(apiKey: string) {
  try {
    // Gemini는 v1beta/models 엔드포인트에 GET 요청과 x-goog-api-key 헤더를 사용합니다.
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`,
      { method: 'GET' }
    );
    return response.ok;
  } catch (e) {
    console.error("Gemini validation error:", e);
    return false;
  }
}

async function testElevenLabsApiKey(apiKey: string) {
  try {
    const response = await fetch('https://api.elevenlabs.io/v1/user', {
      headers: { 'xi-api-key': apiKey }
    });
    return response.ok;
  } catch (e) {
    console.error("ElevenLabs validation error:", e);
    return false;
  }
}

export async function POST(request: NextRequest) {
  try {
    const { geminiApiKey, elevenlabsApiKey } = await request.json();

    if (!geminiApiKey || !elevenlabsApiKey) {
      return NextResponse.json({ success: false, message: 'API keys are required.' }, { status: 400 });
    }

    const isGeminiValid = await testGeminiApiKey(geminiApiKey);
    if (!isGeminiValid) {
      return NextResponse.json({ success: false, field: 'gemini', message: 'Gemini API key is invalid or failed to connect.' }, { status: 400 });
    }

    const isElevenLabsValid = await testElevenLabsApiKey(elevenlabsApiKey);
    if (!isElevenLabsValid) {
      return NextResponse.json({ success: false, field: 'elevenlabs', message: 'ElevenLabs API key is invalid or failed to connect.' }, { status: 400 });
    }

    return NextResponse.json({ success: true, message: 'API keys are valid.' });

  } catch (error: any) {
    console.error('Error in /api/validate-keys:', error);
    return NextResponse.json({ success: false, message: error?.message || 'Unknown server error.' }, { status: 500 });
  }
}