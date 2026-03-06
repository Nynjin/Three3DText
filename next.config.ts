import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  webpack: (config) => {
    config.experiments = { ...config.experiments, topLevelAwait: true };
    config.output = {
      ...config.output,
      environment: {
        ...config.output?.environment,
        asyncFunction: true,
      },
    };
    return config;
  },
};

export default nextConfig;
