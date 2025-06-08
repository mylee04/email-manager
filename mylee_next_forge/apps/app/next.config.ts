import { env } from '@/env';
import { withToolbar } from '@repo/feature-flags/lib/toolbar';
import { config, withAnalyzer } from '@repo/next-config';
import { withLogging, withSentry } from '@repo/observability/next-config';
import type { NextConfig } from 'next';

const corsHeaders: Pick<NextConfig, 'headers'> = {
  async headers() {
    return [
      {
        // API 라우트(/api/...)에만 이 정책을 적용합니다.
        source: "/api/:path*",
        headers: [
          // 어떤 출처(Origin)를 허용할지 지정합니다. '*'는 모든 출처를 의미합니다.
          { key: "Access-Control-Allow-Origin", value: "*" },
          // 허용할 HTTP 메소드를 지정합니다.
          { key: "Access-Control-Allow-Methods", value: "GET, POST, PUT, DELETE, OPTIONS" },
          // 허용할 HTTP 헤더를 지정합니다.
          { key: "Access-Control-Allow-Headers", value: "Content-Type, Authorization" },
        ],
      },
    ];
  },
};
// --- 종료: CORS 설정 추가 완료 ---

// 가져온 'config'와 우리가 만든 'corsHeaders'를 병합합니다.
// 이렇게 하면 기존의 모든 설정을 유지하면서 CORS 기능만 추가할 수 있습니다.
const mergedConfig: NextConfig = {
  ...config,       // '@repo/next-config'의 모든 설정을 그대로 가져옵니다.
  ...corsHeaders,  // 위에서 정의한 CORS 헤더 설정을 추가합니다.
};



// let nextConfig: NextConfig = withToolbar(withLogging(config));
let nextConfig: NextConfig = withToolbar(withLogging(mergedConfig));

if (env.VERCEL) {
  nextConfig = withSentry(nextConfig);
}

if (env.ANALYZE === 'true') {
  nextConfig = withAnalyzer(nextConfig);
}

export default nextConfig;
