import { 
  Lucid, 
  Blockfrost, 
  Data, 
  getAddressDetails, 
  mintingPolicyToId, 
  validatorToAddress, 
  validatorToScriptHash,
  conwayGenesisParameters
} from "@lucid-evolution/lucid";
import * as dotenv from "dotenv";
import * as fs from "node:fs";

dotenv.config();

// 1. Setup Lucid
const apiKey = process.env.BLOCKFROST_API_KEY!;
const seed = process.env.SEED_PHRASE!;

const lucid = await Lucid(
  new Blockfrost("https://cardano-preview.blockfrost.io/api/v0", apiKey),
  "Preview"
);
lucid.selectWalletFromSeed(seed);

const adminAddress = await lucid.wallet().address();
const adminPkh = getAddressDetails(adminAddress).paymentCredential?.hash!;

console.log(`Admin Address: ${adminAddress}`);

// 2. Load Blueprint (Compiled Aiken Code)
const blueprint = JSON.parse(fs.readFileSync("./plutus.json", "utf-8"));

// 3. IDENTIFY VALIDATORS
const settingsValidator = blueprint.validators.find((v) => v.title === "settings.settings");
const eventMintValidator = blueprint.validators.find((v) => v.title === "event_mint.seatmint_event");
const primarySaleValidator = blueprint.validators.find((v) => v.title === "primary_sale.primary_sale");
const storefrontValidator = blueprint.validators.find((v) => v.title === "storefront.storefront");

// 4. CALCULATE BOX OFFICE HASH (For Event Mint parameter)
// This allows the Factory to "trust" the Box Office without it being deployed yet
const boxOfficeHash = validatorToScriptHash({
  type: "PlutusV3",
  script: primarySaleValidator.compiledCode,
});

console.log(`Calculated Box Office Hash: ${boxOfficeHash}`);

// 5. MINT SETTINGS TOKEN
// We use a simple minting policy or the admin wallet to create a unique 'Settings' NFT
const { mintingPolicy, policyId } = await setupSettingsToken(lucid, adminAddress);
console.log(`Settings Token PolicyID: ${policyId}`);

// 6. INITIALIZE GLOBAL SETTINGS DATUM
// This matches your 'pub type GlobalSettings' in types.ak
const GlobalSettingsSchema = Data.Object({
  platform_fee_percent: Data.Integer(),
  platform_treasury: Data.String(), // Address
  current_max_supply: Data.Integer(),
  max_resale_multiplier: Data.Integer(),
  is_market_active: Data.Boolean(),
  admin_pkh: Data.Bytes(),
});

type GlobalSettings = Data.Static<typeof GlobalSettingsSchema>;

const initialSettings: GlobalSettings = {
  platform_fee_percent: 25n, // 2.5%
  platform_treasury: adminAddress,
  current_max_supply: 5000n,
  max_resale_multiplier: 120n, // 120% cap
  is_market_active: true,
  admin_pkh: adminPkh,
};

const encodedSettings = Data.to(initialSettings, GlobalSettingsSchema);

// 7. THE GENESIS TRANSACTION
// Lock the Settings Token + Initial Datum at the Settings Script
const settingsAddress = validatorToAddress("Preview", {
  type: "PlutusV3",
  script: settingsValidator.compiledCode,
});

const tx = await lucid
  .newTx()
  .mintAssets({ [policyId + Data.toText("Settings")]: 1n })
  .payToContract(settingsAddress, { kind: "inline", value: encodedSettings }, { [policyId + Data.toText("Settings")]: 1n })
  .complete();

const signedTx = await tx.sign().complete();
const txHash = await signedTx.submit();

console.log(`
--- GENESIS COMPLETE ---
Transaction Hash: ${txHash}
Settings Script: ${settingsAddress}
Box Office Hash: ${boxOfficeHash}
------------------------
Next: Copy the Box Office Hash into your Frontend config!
`);

// Helper for Settings NFT
async function setupSettingsToken(lucid, addr) {
  const { paymentCredential } = getAddressDetails(addr);
  const mintingPolicy = lucid.utils.nativeScript({
    type: "all",
    scripts: [{ type: "sig", keyHash: paymentCredential?.hash! }],
  });
  return { mintingPolicy, policyId: mintingPolicyToId(mintingPolicy) };
}