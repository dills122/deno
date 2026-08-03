globalThis.capsuleMain = (input) => ({
  count: input.values.length,
  label: input.label,
  sum: input.values.reduce((total, value) => total + value, 0),
});
