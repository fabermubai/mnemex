# Mnemex — Lessons Learned

<!-- Erreurs corrigées et patterns à retenir -->

## Bugs connus résolus
- **parseBool temporal dead zone**: `const parseBool` was used on lines 70/76 of `index.js` before its declaration on line 78. Fix: moved the function definition above its first usage (line 66). Lesson: always define utility functions before any code that references them.
- **dhtBootstrap undefined override**: Passing `dhtBootstrap: undefined` explicitly to trac-peer's Config caused `#isOverriden` to return true (because `hasOwnProperty` returns true for explicitly set keys), overriding MAINNET defaults. Fix: only include the key in the config object when a value actually exists (`if (value) config.key = value`). Lesson: never pass `undefined` explicitly as a config value — omit the key entirely.
