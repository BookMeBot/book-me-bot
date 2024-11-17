import { ethers } from "ethers";
import { encodeFunctionData, namehash } from "viem";
import { normalize } from "viem/ens";

const adjectives = [
  "brave",
  "curious",
  "mighty",
  "fierce",
  "clever",
  "gentle",
  "proud",
  "quick",
  "wise",
  "bold",
];
const nouns = [
  "eagle",
  "tiger",
  "shark",
  "falcon",
  "lion",
  "wolf",
  "bear",
  "panther",
  "otter",
  "dragon",
];

// Contract Addresses
export const registrarAddress = "0x49aE3cC2e3AA768B1e5654f5D3C6002144A59581";
export const L2ResolverAddress = "0x6533C94869D28fAA8dF77cc63f9e2b2D6Cf77eBA";
export const baseNameRegex = /\.basetest\.eth$/;

// ABIs
export const registrarABI = [
  {
    inputs: [
      {
        components: [
          { internalType: "string", name: "name", type: "string" },
          { internalType: "address", name: "owner", type: "address" },
          { internalType: "uint256", name: "duration", type: "uint256" },
          { internalType: "address", name: "resolver", type: "address" },
          { internalType: "bytes[]", name: "data", type: "bytes[]" },
          { internalType: "bool", name: "reverseRecord", type: "bool" },
        ],
        internalType: "struct RegistrarController.RegisterRequest",
        name: "request",
        type: "tuple",
      },
    ],
    name: "register",
    outputs: [],
    stateMutability: "payable",
    type: "function",
  },
];

export const l2ResolverABI = [
  {
    inputs: [
      { internalType: "bytes32", name: "node", type: "bytes32" },
      { internalType: "address", name: "a", type: "address" },
    ],
    name: "setAddr",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { internalType: "bytes32", name: "node", type: "bytes32" },
      { internalType: "string", name: "newName", type: "string" },
    ],
    name: "setName",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
];

// Helper function to generate a random agent name
export function generateAgentName(): string {
  const randomAdjective =
    adjectives[Math.floor(Math.random() * adjectives.length)];
  const randomNoun = nouns[Math.floor(Math.random() * nouns.length)];
  return `${randomAdjective}-${randomNoun}-agent.basetest.eth`;
}

// Helper function to create register contract method arguments
export function createRegisterContractMethodArgs(
  baseName: string,
  addressId: string
) {
  const addressData = encodeFunctionData({
    abi: l2ResolverABI,
    functionName: "setAddr",
    args: [namehash(normalize(baseName)), addressId],
  });

  const nameData = encodeFunctionData({
    abi: l2ResolverABI,
    functionName: "setName",
    args: [namehash(normalize(baseName)), baseName],
  });

  const registerArgs = {
    request: [
      baseName.replace(baseNameRegex, ""),
      addressId,
      "31557600", // 1 year in seconds
      L2ResolverAddress,
      [addressData, nameData],
      true,
    ],
  };

  console.log(`Register contract method arguments constructed:`, registerArgs);
  return registerArgs;
}
