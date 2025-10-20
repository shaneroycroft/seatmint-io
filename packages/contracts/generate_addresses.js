import { Lucid, Blockfrost } from "@lucid-cardano/lucid";
import { readFileSync, writeFileSync } from "fs";
import dotenv from "dotenv";

dotenv.config();

async function generateAddresses() {
  const lucid = await Lucid.new(
    new Blockfrost(
      "https://cardano-preprod.blockfrost.io/api/v0",
      process.env.BLOCKFROST_PROJECT_ID
    ),
    "Preprod"
  );

  const scripts = [
    {
      name: "minting_policy",
      file: "./build/minting_policy/plutus.json",
    },
    {
      name: "primary_sale",
      file: "./build/primary_sale/plutus.json",
    },
    {
      name: "resale",
      file: "./build/resale/plutus.json",
    },
  ];

  const addresses = {};
  for (const script of scripts) {
    try {
      const plutusJson = JSON.parse(readFileSync(script.file, "utf8"));
      const scriptHash = lucid.utils.validatorToScriptHash({
        type: "PlutusV3",
        script: plutusJson.cborHex,
      });
      const address = lucid.utils.validatorToAddress({
        type: "PlutusV3",
        script: plutusJson.cborHex,
      });
      addresses[script.name] = { scriptHash, address };
    } catch (error) {
      console.error(`Error processing ${script.name}:`, error);
    }
  }

  writeFileSync(
    "./build/addresses.json",
    JSON.stringify(addresses, null, 2)
  );
  console.log("Script addresses written to build/addresses.json:", addresses);
}

generateAddresses().catch(console.error);