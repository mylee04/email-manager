// app/api/check-keys/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { clerkClient } from '@clerk/nextjs/server';

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

export async function GET(request: NextRequest) {
  try {
    // 1. using Clerk to authenticate user
    const authHeader = request.headers.get('Authorization');
    const token = authHeader?.split(' ')[1];
    if (!token) {
      return NextResponse.json({ message: 'Authentication is required.' }, { status: 401 });
    }
    const claims = await clerkClient.verifyToken(token);
    const userId = claims.sub;
    if (!userId) {
      return NextResponse.json({ message: 'Invalid token.' }, { status: 401 });
    }

    // 2. check if API key exists in Supabase DB
    const { data, error } = await supabase
      .from('user_api_keys')
      .select('user_id')
      .eq('user_id', userId)
      .maybeSingle();

    if (error) throw error;
    
    return NextResponse.json({ hasKeys: !!data });

  } catch (error: any) {
    console.error('Error in /api/check-keys:', error);
    return NextResponse.json({ message: error.message || 'Unknown error.' }, { status: 500 });
  }
}