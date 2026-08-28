import type { NextConfig } from "next"

const config: NextConfig = {
  reactStrictMode: true,
  // Workspace packages are consumed as TypeScript source, not built artefacts.
  transpilePackages: ["@slipstream/shared", "@slipstream/db", "@slipstream/venues"],
}

export default config
