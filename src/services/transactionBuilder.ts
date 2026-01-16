import { Data, fromText, LucidEvolution, UTxO, Constr, getAddressDetails } from '@lucid-evolution/lucid';
import {
  EVENT_MINT_VALIDATOR,
  PRIMARY_SALE_VALIDATOR,
  STOREFRONT_VALIDATOR,
  MintRedeemer,
  StorefrontRedeemer
} from '../utils/plutusScripts';

/**
 * TRANSACTION BUILDER
 *
 * This module builds actual Cardano transactions using Lucid Evolution.
 * It bridges the gap between user actions and smart contract execution.
 */

// Use the correct LucidEvolution type
type LucidInstance = LucidEvolution;

// ============================================
// HELPER: Apply Parameters to Plutus Scripts
// ============================================

/**
 * Apply parameters to a Plutus script
 * This is crucial - your validators need parameters before they can be used
 */
function applyParams(
  script: string,
  params: string[]
): string {
  // TODO: Use @lucid-evolution/uplc to properly apply parameters
  // For now, this is a placeholder
  // You'll need to implement actual parameter application
  
  console.log('Applying parameters:', params, 'to script');
  return script; // Placeholder - needs actual UPLC implementation
}

// ============================================
// EVENT CREATION TRANSACTION
// ============================================

export interface CreateEventTxParams {
  eventId: string;
  organizerAddress: string;
  eventName: string;
  ticketTiers: Array<{
    tierName: string;
    totalSupply: number;
  }>;
}

/**
 * Create event on-chain
 * This deploys a parameterized minting policy for the event
 */
export async function buildCreateEventTx(
  lucid: LucidInstance,
  params: CreateEventTxParams
): Promise<{ policyId: string; txHash: string }> {
  
  console.log('🎫 Building event creation transaction...');
  
  // Step 1: Get organizer's public key hash
  const organizerCredential = getAddressDetails(params.organizerAddress)
    .paymentCredential;
  
  if (!organizerCredential || organizerCredential.type !== 'Key') {
    throw new Error('Invalid organizer address');
  }
  
  const organizerPkh = organizerCredential.hash;
  
  // Step 2: Get settings token policy (from genesis)
  // This would come from your platform_config table
  const settingsToken = 'YOUR_SETTINGS_POLICY_ID'; // TODO: Load from DB
  
  // Step 3: Get box office (primary sale) validator hash
  const boxOfficeHash = PRIMARY_SALE_VALIDATOR!.hash;
  
  // Step 4: Apply parameters to event mint validator
  const eventMintScript = EVENT_MINT_VALIDATOR!.compiledCode;
  // TODO: Apply parameters when uplc library is integrated
  applyParams(eventMintScript, [
    organizerPkh,
    settingsToken,
    boxOfficeHash
  ]);

  // Step 5: Use the hash from the validator (temporary until parameter application is working)
  const policyId = EVENT_MINT_VALIDATOR!.hash;

  console.log('📜 Event Policy ID:', policyId);

  // Step 6: Build metadata for event registration
  // This creates an "Event Registry" NFT that stores event info
  const eventMetadata = {
    721: { // CIP-25 NFT metadata standard
      [policyId]: {
        [`Event-${params.eventId}`]: {
          name: params.eventName,
          image: 'ipfs://...', // TODO: Upload event banner to IPFS
          mediaType: 'image/png',
          description: `Official event registry for ${params.eventName}`,
          attributes: {
            eventId: params.eventId,
            organizer: params.organizerAddress,
            totalTiers: params.ticketTiers.length.toString()
          }
        }
      }
    }
  };

  // Step 7: Build minting transaction
  const tx = await lucid
    .newTx()
    // Mint event registry NFT (quantity: 1)
    .mintAssets(
      { [`${policyId}${fromText(`Event-${params.eventId}`)}`]: 1n },
      Data.to(new Constr(MintRedeemer.Mint.constructor, MintRedeemer.Mint.fields))
    )
    // Attach metadata
    .attachMetadata(721, eventMetadata[721])
    // Pay to organizer's address (event registry NFT goes to organizer)
    .pay.ToAddress(params.organizerAddress, {
      lovelace: 2_000_000n, // Min ADA
      [`${policyId}${fromText(`Event-${params.eventId}`)}`]: 1n
    })
    .complete();

  // Step 8: Sign and submit
  const signedTx = tx.sign.withWallet();
  const completedTx = await signedTx.complete();
  const txHash = await completedTx.submit();
  
  console.log('✅ Event created! Tx:', txHash);
  
  return { policyId, txHash };
}

// ============================================
// TICKET MINTING TRANSACTION
// ============================================

export interface MintTicketsTxParams {
  eventId: string;
  policyId: string;
  tierId: string;
  quantity: number;
  pricePerTicket: bigint; // in lovelace
  buyerAddress: string;
  organizerAddress: string;
}

/**
 * Mint tickets for a buyer
 * This is called when someone purchases tickets
 */
export async function buildMintTicketsTx(
  lucid: LucidInstance,
  params: MintTicketsTxParams
): Promise<string> {
  
  console.log('🎟️ Building ticket minting transaction...');
  
  // Step 1: Generate unique ticket identifiers
  const ticketAssets: Record<string, bigint> = {};
  const ticketMetadata: any = {};
  
  for (let i = 1; i <= params.quantity; i++) {
    const ticketName = `Ticket-${params.eventId}-${Date.now()}-${i}`;
    const assetName = fromText(ticketName);
    
    ticketAssets[`${params.policyId}${assetName}`] = 1n;
    
    // CIP-25 metadata for each ticket
    ticketMetadata[ticketName] = {
      name: `Ticket #${i}`,
      image: 'ipfs://...', // TODO: Generate ticket image
      mediaType: 'image/png',
      description: 'Official event ticket NFT',
      attributes: {
        eventId: params.eventId,
        tierId: params.tierId,
        ticketNumber: i.toString(),
        mintDate: new Date().toISOString()
      }
    };
  }
  
  // Step 2: Calculate payments
  const totalPrice = params.pricePerTicket * BigInt(params.quantity);
  const platformFee = (totalPrice * 25n) / 1000n; // 2.5%
  const organizerRevenue = totalPrice - platformFee;
  
  // Step 3: Get platform treasury address
  const platformTreasury = 'PLATFORM_TREASURY_ADDRESS'; // TODO: Load from settings

  // Step 4: Build transaction
  const tx = await lucid
    .newTx()
    // Mint tickets
    .mintAssets(
      ticketAssets,
      Data.to(new Constr(MintRedeemer.Mint.constructor, MintRedeemer.Mint.fields))
    )
    // Payment to organizer
    .pay.ToAddress(params.organizerAddress, {
      lovelace: organizerRevenue
    })
    // Platform fee
    .pay.ToAddress(platformTreasury, {
      lovelace: platformFee
    })
    // Send tickets to buyer
    .pay.ToAddress(params.buyerAddress, {
      lovelace: 2_000_000n * BigInt(params.quantity), // Min ADA per ticket
      ...ticketAssets
    })
    // Attach metadata
    .attachMetadata(721, {
      [params.policyId]: ticketMetadata
    })
    .complete();

  const signedTx = tx.sign.withWallet();
  const completedTx = await signedTx.complete();
  const txHash = await completedTx.submit();

  console.log('✅ Tickets minted! Tx:', txHash);
  
  return txHash;
}

// ============================================
// STOREFRONT LISTING TRANSACTION
// ============================================

export interface ListTicketTxParams {
  ticketAssetName: string;
  policyId: string;
  listingPrice: bigint; // in lovelace
  originalPrice: bigint;
  sellerAddress: string;
  artistAddress: string;
  royaltyRate: number; // basis points (e.g., 100 = 10%)
}

/**
 * List a ticket for sale on the secondary market
 */
export async function buildListTicketTx(
  lucid: LucidInstance,
  params: ListTicketTxParams
): Promise<string> {
  
  console.log('📝 Building listing transaction...');

  // Step 1: Get storefront validator address
  const config = lucid.config();
  const storefrontAddress = config.network === 'Mainnet'
    ? `addr1${STOREFRONT_VALIDATOR!.hash}`
    : `addr_test1${STOREFRONT_VALIDATOR!.hash}`;

  // Step 2: Build ticket datum (listing details) with proper structure
  const ticketDatum = Data.to(
    new Constr(0, [
      params.listingPrice,
      params.sellerAddress,
      params.artistAddress,
      BigInt(params.royaltyRate),
      params.originalPrice
    ])
  );

  // Step 3: Send ticket to storefront contract
  const tx = await lucid
    .newTx()
    .pay.ToAddressWithData(
      storefrontAddress,
      { kind: 'inline', value: ticketDatum },
      {
        lovelace: 2_000_000n,
        [`${params.policyId}${params.ticketAssetName}`]: 1n
      }
    )
    .complete();

  const signedTx = tx.sign.withWallet();
  const completedTx = await signedTx.complete();
  const txHash = await completedTx.submit();

  console.log('✅ Ticket listed! Tx:', txHash);
  
  return txHash;
}

// ============================================
// STOREFRONT PURCHASE TRANSACTION
// ============================================

export interface PurchaseTicketTxParams {
  ticketUtxo: UTxO; // The UTxO containing the listed ticket
  buyerAddress: string;
  platformTreasury: string;
  settingsUtxo: UTxO;
}

/**
 * Purchase a ticket from the secondary market
 */
export async function buildPurchaseTicketTx(
  lucid: LucidInstance,
  params: PurchaseTicketTxParams
): Promise<string> {

  console.log('💳 Building purchase transaction...');

  // Step 1: Decode ticket datum
  if (!params.ticketUtxo.datum) {
    throw new Error('Ticket UTxO has no datum');
  }
  const ticketDatum = Data.from<any>(params.ticketUtxo.datum);

  // Step 2: Calculate payment splits
  const price = BigInt(ticketDatum.fields[0].int);
  const sellerAddress = ticketDatum.fields[1].bytes;
  const artistAddress = ticketDatum.fields[2].bytes;
  const royaltyRate = BigInt(ticketDatum.fields[3].int);

  const platformFee = (price * 25n) / 1000n; // 2.5%
  const artistRoyalty = (price * royaltyRate) / 1000n;
  const sellerPayout = price - platformFee - artistRoyalty;

  // Step 3: Get first ticket asset from UTxO
  const ticketAssets = Object.keys(params.ticketUtxo.assets).filter(
    asset => asset !== 'lovelace'
  );
  if (ticketAssets.length === 0) {
    throw new Error('No ticket asset found in UTxO');
  }

  // Step 4: Build transaction
  const tx = await lucid
    .newTx()
    // Spend the listing
    .collectFrom(
      [params.ticketUtxo],
      Data.to(new Constr(StorefrontRedeemer.Buy.constructor, StorefrontRedeemer.Buy.fields))
    )
    // Reference settings
    .readFrom([params.settingsUtxo])
    // Payment to seller
    .pay.ToAddress(sellerAddress, {
      lovelace: sellerPayout
    })
    // Royalty to artist
    .pay.ToAddress(artistAddress, {
      lovelace: artistRoyalty
    })
    // Platform fee
    .pay.ToAddress(params.platformTreasury, {
      lovelace: platformFee
    })
    // Send ticket to buyer
    .pay.ToAddress(params.buyerAddress, {
      lovelace: 2_000_000n,
      [ticketAssets[0]]: 1n
    })
    .complete();

  const signedTx = tx.sign.withWallet();
  const completedTx = await signedTx.complete();
  const txHash = await completedTx.submit();

  console.log('✅ Ticket purchased! Tx:', txHash);
  
  return txHash;
}

// ============================================
// UPDATE PLATFORM SETTINGS TRANSACTION
// ============================================

export interface UpdateSettingsTxParams {
  action: 'toggle_market' | 'update_fee' | 'update_supply';
  newValue?: any;
  settingsUtxo: UTxO;
}

/**
 * Update platform settings (admin only)
 */
export async function buildUpdateSettingsTx(
  lucid: LucidInstance,
  params: UpdateSettingsTxParams
): Promise<string> {

  console.log('⚙️ Building settings update transaction...');

  // Step 1: Decode current settings
  if (!params.settingsUtxo.datum) {
    throw new Error('Settings UTxO has no datum');
  }
  const currentSettings = Data.from<any>(params.settingsUtxo.datum);

  // Step 2: Create updated settings
  let newSettings = { ...currentSettings };

  switch (params.action) {
    case 'toggle_market':
      newSettings.fields[4] = {
        constructor: currentSettings.fields[4].constructor === 1 ? 0 : 1,
        fields: []
      };
      break;
    case 'update_fee':
      newSettings.fields[0] = { int: params.newValue };
      break;
    case 'update_supply':
      newSettings.fields[2] = { int: params.newValue };
      break;
  }

  // Step 3: Create redeemer based on action
  const redeemerIndex = params.action === 'toggle_market' ? 0 : params.action === 'update_fee' ? 1 : 2;
  const redeemer = Data.to(new Constr(redeemerIndex, []));

  // Step 4: Build transaction
  const tx = await lucid
    .newTx()
    // Spend current settings
    .collectFrom(
      [params.settingsUtxo],
      redeemer
    )
    // Continue with new settings
    .pay.ToAddressWithData(
      params.settingsUtxo.address,
      { kind: 'inline', value: Data.to(newSettings) },
      params.settingsUtxo.assets
    )
    .complete();

  const signedTx = tx.sign.withWallet();
  const completedTx = await signedTx.complete();
  const txHash = await completedTx.submit();

  console.log('✅ Settings updated! Tx:', txHash);
  
  return txHash;
}

// ============================================
// HELPER: Query UTxOs
// ============================================

/**
 * Find settings UTxO on-chain
 * Note: Settings is an NFT pattern, not a validator. Use ticketService.getSettingsUTxO for full implementation.
 * This is a simplified version that searches for UTxOs containing "Settings" token.
 */
export async function findSettingsUtxo(lucid: LucidInstance, settingsAddress: string): Promise<UTxO | undefined> {
  const utxos = await lucid.utxosAt(settingsAddress);

  // Find UTxO with settings token
  return utxos.find(utxo => {
    // Check if contains settings NFT
    return Object.keys(utxo.assets).some(asset =>
      asset.includes('Settings')
    );
  });
}

/**
 * Find all listings in storefront
 */
export async function findStorefrontListings(lucid: LucidInstance): Promise<UTxO[]> {
  const config = lucid.config();
  const storefrontAddress = config.network === 'Mainnet'
    ? `addr1${STOREFRONT_VALIDATOR!.hash}`
    : `addr_test1${STOREFRONT_VALIDATOR!.hash}`;

  return await lucid.utxosAt(storefrontAddress);
}