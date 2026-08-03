type CapsuleInput = { values: number[]; label: string };

globalThis.capsuleMain = (input: CapsuleInput) => ({
  count: input.values.length,
  label: input.label,
  sum: input.values.reduce((total, value) => total + value, 0),
});
