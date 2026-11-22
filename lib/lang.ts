// Map file paths to shiki language ids. Falls back to "text".
const BY_EXT: Record<string, string> = {
  ts: "ts", mts: "ts", cts: "ts", tsx: "tsx", js: "js", mjs: "js", cjs: "js", jsx: "jsx",
  json: "json", jsonc: "jsonc", json5: "json5", py: "python", pyi: "python", rb: "ruby",
  rs: "rust", go: "go", java: "java", kt: "kotlin", kts: "kotlin", swift: "swift",
  c: "c", h: "c", cc: "cpp", cpp: "cpp", cxx: "cpp", hpp: "cpp", cs: "csharp",
  php: "php", sh: "bash", bash: "bash", zsh: "bash", fish: "fish", ps1: "powershell",
  html: "html", htm: "html", css: "css", scss: "scss", sass: "sass", less: "less",
  vue: "vue", svelte: "svelte", astro: "astro", md: "markdown", mdx: "mdx",
  yml: "yaml", yaml: "yaml", toml: "toml", ini: "ini", xml: "xml", svg: "xml",
  sql: "sql", graphql: "graphql", gql: "graphql", lua: "lua", dart: "dart",
  ex: "elixir", exs: "elixir", erl: "erlang", hs: "haskell", scala: "scala",
  clj: "clojure", r: "r", jl: "julia", zig: "zig", nim: "nim", tf: "terraform",
  proto: "proto", prisma: "prisma", sol: "solidity", wasm: "wasm", diff: "diff", patch: "diff",
  txt: "text", log: "text", env: "dotenv",
};

const BY_NAME: Record<string, string> = {
  dockerfile: "docker", makefile: "make", gnumakefile: "make", cmakelists: "cmake",
  ".gitignore": "text", ".env": "dotenv", ".bashrc": "bash", ".zshrc": "bash",
  gemfile: "ruby", rakefile: "ruby",
};

export function langFromPath(path: string): string {
  const name = (path.split("/").pop() || "").toLowerCase();
  if (BY_NAME[name]) return BY_NAME[name];
  if (name === "cmakelists.txt") return "cmake";
  const dot = name.lastIndexOf(".");
  if (dot === -1) return "text";
  return BY_EXT[name.slice(dot + 1)] ?? "text";
}
