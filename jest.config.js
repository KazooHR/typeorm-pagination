module.exports = {
  modulePaths: ["src"],
  modulePathIgnorePatterns: ["build"],
  coverageThreshold: {
    global: {
      branches: 100,
      lines: 100,
      statements: 100,
    },
  },
};
