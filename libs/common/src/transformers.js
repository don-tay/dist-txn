export const bigIntTransformer = {
    to: (value) => value == null ? null : String(value),
    from: (value) => value == null ? null : Number(value),
};
//# sourceMappingURL=transformers.js.map