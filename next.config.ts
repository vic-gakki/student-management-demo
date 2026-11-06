import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // PGlite 以 WASM 运行，需要保持为外部包，不能被打包进服务端 bundle
  serverExternalPackages: ['@electric-sql/pglite'],
};

export default nextConfig;
