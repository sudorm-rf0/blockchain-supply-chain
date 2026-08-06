module.exports = {
  moduleFileExtensions: ["js", "json", "ts"],
  rootDir: ".",
  testRegex: ".*\\.spec\\.ts$",
  transform: {
    "^.+\\.(t|j)s$": "ts-jest",
  },
  collectCoverageFrom: ["src/**/*.(t|j)s", "apps/**/*.(t|j)s"],
  coveragePathIgnorePatterns: ["node_modules", ".spec.ts", ".d.ts"],
  coverageDirectory: "./coverage",
  // 防回归门槛：低于当前基线（~39% stmts / 43% branch / 33% funcs / 40% lines），
  // 允许小幅波动，但阻止覆盖率显著下滑。覆盖不足的模块应逐步补充测试而非调低门槛。
  coverageThreshold: {
    global: {
      statements: 35,
      branches: 30,
      functions: 25,
      lines: 35,
    },
  },
  testEnvironment: "node",
  moduleNameMapper: {
    "^src/(.*)$": "<rootDir>/src/$1",
  },
};
