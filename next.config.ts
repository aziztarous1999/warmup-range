import path from 'path';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Pin the project root (a stray lockfile higher up the folder tree would otherwise confuse Turbopack).
  turbopack: { root: path.resolve(__dirname) },
};

export default nextConfig;
