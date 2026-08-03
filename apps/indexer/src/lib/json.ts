// Make `JSON.stringify` emit bigints as decimal strings instead of throwing.
// Imported once at the top of `src/index.ts` so all notify payloads can include
// bigint fields without needing manual `.toString()` on every property.
(BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function (this: bigint) {
  return this.toString();
};

export {};
