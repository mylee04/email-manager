import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { encrypt } from '@repo/security/encryption';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!, 
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(request: NextRequest) {
  try {
    console.log('Received API key save request');
    const { userId, geminiApiKey, elevenlabsApiKey } = await request.json();
    
    if (!userId || !geminiApiKey || !elevenlabsApiKey) {
      console.error('Missing required fields:', { userId, hasGeminiKey: !!geminiApiKey, hasElevenlabsKey: !!elevenlabsApiKey });
      return NextResponse.json({ 
        success: false, 
        message: 'userId, geminiApiKey, and elevenlabsApiKey are required.' 
      }, { status: 400 });
    }

    console.log('Encrypting API keys...');
    // API 키 암호화
    const encryptedGeminiKey = encrypt(geminiApiKey);
    const encryptedElevenlabsKey = encrypt(elevenlabsApiKey);
    console.log('API keys encrypted successfully');

    console.log('Saving to Supabase...');
    // Supabase에 저장
    const { data, error } = await supabase
      .from('user_api_keys')
      .upsert({
        user_id: userId,
        gemini_api_key: encryptedGeminiKey,
        elevenlabs_api_key: encryptedElevenlabsKey
      });

    if (error) {
      console.error('Supabase error:', error);
      return NextResponse.json({ 
        success: false, 
        message: 'Failed to save API keys to database.' 
      }, { status: 500 });
    }

    console.log('API keys saved successfully');
    return NextResponse.json({ 
      success: true, 
      message: 'API keys saved successfully.' 
    });
  } catch (error: any) {
    console.error('Error in /api/save-key:', error);
    return NextResponse.json({
      success: false,
      message: error?.message || 'Unknown error.'
    }, { status: 500 });
  }
} 