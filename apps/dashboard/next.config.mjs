/** @type {import('next').NextConfig} */
const nextConfig = {
  // pnpm's content-addressable store (node_modules/.pnpm) holds thousands of
  // small per-package directories — 5287 of this repo's 5600 total
  // directories, confirmed via `find`. Webpack's default dev-watcher ignore
  // pattern doesn't reliably exclude that layout, so it ends up watching
  // nearly the whole store and blows past the OS's open-file-descriptor
  // ceiling (EMFILE), especially with sibling dev servers (api/agent/widget)
  // also watching files concurrently. Raising ulimit alone doesn't fix this
  // — it just chases a ceiling that scales with the store's size. Excluding
  // node_modules (plus .git/.next/.turbo, which are never source) keeps the
  // watch set to actual project files.
  webpack: (config) => {
    config.watchOptions = {
      ...config.watchOptions,
      ignored: ["**/node_modules/**", "**/.git/**", "**/.next/**", "**/.turbo/**"],
    };
    return config;
  },
};

export default nextConfig;
