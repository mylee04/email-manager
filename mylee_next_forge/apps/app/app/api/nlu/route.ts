import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { decrypt } from '@repo/security/encryption';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!, 
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(request: NextRequest) {
  try {
    console.log('Received NLU request');
    const { userId, utterance } = await request.json();
    
    if (!userId || !utterance) {
      console.error('Missing required fields:', { userId, utterance });
      return NextResponse.json({ 
        success: false, 
        message: 'userId and utterance are required.' 
      }, { status: 400 });
    }

    // 1. 유저별 API 키 조회 및 복호화
    console.log('Fetching API keys from Supabase...');
    const { data, error } = await supabase
      .from('user_api_keys')
      .select('gemini_api_key, elevenlabs_api_key')
      .eq('user_id', userId)
      .single();

    if (error || !data) {
      console.error('Error fetching API keys:', error);
      return NextResponse.json({ 
        success: false, 
        message: 'API keys not found for user.' 
      }, { status: 400 });
    }

    console.log('Decrypting API keys...');
    const geminiApiKey = decrypt(data.gemini_api_key);
    const elevenlabsApiKey = decrypt(data.elevenlabs_api_key);

    // 2. Gemini API 호출
    console.log('Calling Gemini API...');
    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${geminiApiKey}`, 
      { method: 'GET' }
    );

    if (!geminiRes.ok) {
      console.error('Gemini API error:', await geminiRes.text());
      return NextResponse.json({ 
        success: false, 
        message: 'Failed to call Gemini API.' 
      }, { status: 500 });
    }

    const geminiData = await geminiRes.json();
    console.log('Gemini API call successful');

    // 3. ElevenLabs TTS 호출 (필요한 경우)
    // const ttsRes = await fetch('https://api.elevenlabs.io/v1/text-to-speech/21m00Tcm4TlvDq8ikWAM', {
    //   method: 'POST',
    //   headers: {
    //     'Accept': 'audio/mpeg',
    //     'Content-Type': 'application/json',
    //     'xi-api-key': elevenlabsApiKey
    //   },
    //   body: JSON.stringify({
    //     text: 'Hello',
    //     model_id: 'eleven_multilingual_v2',
    //     voice_settings: { stability: 0.5, similarity_boost: 0.75 }
    //   })
    // });

    return NextResponse.json({
      success: true,
      gemini: geminiData,
      // tts: await ttsRes.blob(), // 필요시 추가
    });
  } catch (error: any) {
    console.error('Error in /api/nlu:', error);
    return NextResponse.json({
      success: false,
      message: error?.message || 'Unknown error.'
    }, { status: 500 });
  }
}