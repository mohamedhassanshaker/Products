/** @type {import("prettier").Config} */
export default {
  printWidth: 100,
  singleQuote: false,
  semi: true,
  trailingComma: "all",
  arrowParens: "always",
  endOfLine: "lf",
  overrides: [
    {
      files: ["*.md"],
      options: { printWidth: 100, proseWrap: "preserve" },
    },
    {
      files: ["*.yml", "*.yaml"],
      options: { singleQuote: false },
    },
  ],
};
