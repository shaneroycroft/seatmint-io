import { Lucid, Blockfrost } from "@spacebudz/lucid";
import { readFileSync, writeFileSync } from "fs";
import dotenv from "dotenv";

dotenv.config();

async function generateAddresses() {
  const lucid = await Lucid.new(
    new Blockfrost("https://cardano-preprod.blockfrost.io/api/v0", process.env.BLOCKFROST_PROJECT_ID),
    "Preprod"
  );

  const scripts = [
    { name: "minting_policy", file: "./build/minting_policy/plutus.json" },
    { name: "primary_sale", file: "./build/primary_sale/plutus.json" },
    { name: "resale", file: "./build/resale/plutus.json" },
  ];

  const addresses = {};
  for (const script of scripts) {
    try {
      const plutusJson = JSON.parse(readFileSync(script.file, "utf8"));
      const cborHex = plutusJson.cborHex;

      // Load PlutusV3 script from CBOR hex
      const plutusScript = lucid.utils.plutusScriptV3FromHex(cborHex);
      const scriptHash = plutusScript.hash();

      // Generate enterprise address for Preprod (no staking credential)
      const address = lucid.utils.enterpriseAddress(scriptHash, 1); // 1 for Preprod

      addresses[script.name] = {
        scriptHash: scriptHash.toString(),
        address: address.toString(),
      };
    } catch (error) {
      console.error(`Error processing ${script.name}:`, error);
    }
  }

  writeFileSync("./build/addresses.json", JSON.stringify(addresses, null, 2));
  console.log("Generated addresses:", addresses);
}

generateAddresses().catch(console.error);