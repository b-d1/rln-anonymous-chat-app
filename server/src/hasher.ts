import { poseidon } from "circomlib";

export default function poseidonHash(inputs: BigInt[]): BigInt {
  return poseidon(inputs);
}
