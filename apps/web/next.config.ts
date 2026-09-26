import type { NextConfig } from "next"

const config: NextConfig = {
  reactStrictMode: true,
  // Workspace packages are consumed as TypeScript source, not built artefacts.
  transpilePackages: ["@slipstream/shared", "@slipstream/db", "@slipstream/venues", "@slipstream/intel", "@slipstream/vault"],
  // pg is a Node driver; keep it out of the bundle and load it at runtime.
  serverExternalPackages: ["pg"],
  // The workspace packages use NodeNext-style ".js" specifiers for ".ts"
  // files; teach webpack the same mapping TypeScript already applies.
  webpack: (cfg) => {
    cfg.resolve = cfg.resolve ?? {}
    cfg.resolve.extensionAlias = { ".js": [".ts", ".tsx", ".js"], ".mjs": [".mts", ".mjs"] }
    return cfg
  },
}

export default config
