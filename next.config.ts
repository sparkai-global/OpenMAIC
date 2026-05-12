import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: process.env.VERCEL ? undefined : 'standalone',
  transpilePackages: ['mathml2omml', 'pptxgenjs'],
  serverExternalPackages: ['ali-oss'],
  experimental: {
    proxyClientMaxBodySize: '200mb',
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          {
            key: 'Content-Security-Policy',
            value: 'frame-ancestors *',
          },
        ],
      },
    ];
  },
  async rewrites() {
    // 后端地址全部硬编码，不读 env（部署不依赖 .env.local）。
    // 切换 test/prod 直接改下面常量重新打包。
    const BACKEND_BASE = 'http://192.168.2.79:3000';     // 主后端（同事 Go 后端，OpenMAIC classroom）
    const PARENT_APP_BASE = 'http://8.156.87.115:8081';  // 父项目后端：测试 8.156.87.115:8081 / 正式 8.137.101.85:8081

    // /api/:path*  —— 主后端（同事 Go）
    //   本地 app/api/* 路由（chat / generate / classroom 等）走文件系统优先匹配，rewrite 只在没有本地路由时生效。
    //   /api/classroom 显式声明保持走本地（读 data/classrooms/{id}.json，方便本地课堂测试）。
    // /app/:path*  —— 父层（父项目）真后端，目前只走学习事件上报 /app/learning/event/submit
    return [
      { source: '/api/classroom', destination: '/api/classroom' },
      { source: '/api/:path*', destination: `${BACKEND_BASE.replace(/\/+$/, '')}/api/:path*` },
      { source: '/app/:path*', destination: `${PARENT_APP_BASE.replace(/\/+$/, '')}/:path*` },
    ];
  },
};

export default nextConfig;
