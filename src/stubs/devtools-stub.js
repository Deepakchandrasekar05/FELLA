// Stub for react-devtools-core — only used in ink's dev-mode path.
// In production builds this is replaced by esbuild --alias so no real
// devtools dependency is required.
const devtools = { connectToDevTools: () => {} };
export default devtools;
