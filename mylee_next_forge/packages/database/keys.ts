import { createEnv } from '@t3-oss/env-nextjs';
import { z } from 'zod';

// 'z'는 zod 라이브러리로, 환경 변수의 타입을 검증하고, 빠졌을 경우 에러를 발생시키는 역할을 합니다.
export const keys = () =>
  createEnv({
    /**
     * 서버 측 전용 환경 변수입니다.
     * 브라우저에 절대 노출되지 않습니다.
     */
    server: {
      DATABASE_URL: z.string().url(),
      SUPABASE_SERVICE_ROLE_KEY: z.string().min(1, {
        message: 'SUPABASE_SERVICE_ROLE_KEY is required in .env.local',
      }),
    },
    /**
     * 클라이언트 측 전용 환경 변수입니다.
     * 'NEXT_PUBLIC_' 접두사가 반드시 필요합니다.
     */
    client: {
      NEXT_PUBLIC_SUPABASE_URL: z.string().url({
        message: 'NEXT_PUBLIC_SUPABASE_URL is required in .env.local',
      }),
      // anon 키는 클라이언트용이므로 이 곳에 정의해야 합니다.
      NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1, {
        message: 'NEXT_PUBLIC_SUPABASE_ANON_KEY is required in .env.local',
      }),
    },
    /**
     * 실제 process.env와 위에서 정의한 스키마를 연결합니다.
     */
    runtimeEnv: {
      // 서버 변수 매핑
      DATABASE_URL: process.env.DATABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
      
      // 클라이언트 변수 매핑
      NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
      // 주석을 해제하고 올바르게 매핑합니다.
      NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    },
  });