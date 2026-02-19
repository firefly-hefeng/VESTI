import * as path from "path";
import { defineConfig } from "plasmo";

export default defineConfig({
  vite: (config) => {
    const repoRoot = path.resolve(__dirname, "..", "..");
    const packagesRoot = path.resolve(repoRoot, "packages");
    const localNodeModules = path.resolve(__dirname, "node_modules");

    config.resolve = config.resolve || {};
    config.resolve.preserveSymlinks = false;
    config.resolve.alias = {
      ...(config.resolve.alias || {}),
      react: path.join(localNodeModules, "react"),
      "react-dom": path.join(localNodeModules, "react-dom"),
      "react/jsx-runtime": path.join(localNodeModules, "react/jsx-runtime"),
      "react/jsx-dev-runtime": path.join(localNodeModules, "react/jsx-dev-runtime"),
      "lucide-react": path.join(localNodeModules, "lucide-react"),
    };
    config.resolve.dedupe = [
      ...(config.resolve.dedupe || []),
      "react",
      "react-dom",
      "lucide-react",
    ];

    config.server = config.server || {};
    config.server.fs = config.server.fs || {};
    const allowList = config.server.fs.allow ?? [];
    config.server.fs.allow = Array.from(new Set([...allowList, repoRoot, packagesRoot]));

    return config;
  },
});
