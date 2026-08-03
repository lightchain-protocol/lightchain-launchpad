// Make `JSON.stringify` (and therefore Fastify's default serializer) emit bigints
// as decimal strings instead of throwing. DTO mappers in ../dto.ts still convert
// big values to strings explicitly; this is the belt-and-braces fallback.
(BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function (this: bigint) {
  return this.toString();
};

export {};
