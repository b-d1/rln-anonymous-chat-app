const serializeWitness = (witness) => {
  const serialized = {
    ...witness,
    root: witness.root.toString(),
    leaf: witness.root.toString(),
    pathElements: witness.pathElements.map((pathElement) =>
      pathElement.map((bigInt) => bigInt.toString())
    ),
  };
  return serialized;
};

const deserializeWitness = (witness) => {
  // deserialize witness
  const pathElements: [[]] = witness.pathElements;
  witness.pathElements = pathElements.map((pathElement) =>
    pathElement.map((num) => BigInt(num))
  );
  return witness;
};

export { serializeWitness, deserializeWitness };
