/**
 * SALE CONFIGURATION BUILDER
 * 
 * This provides a simple interface for event organizers to configure
 * advanced features without touching smart contracts.
 * 
 * Usage:
 * const config = new SaleConfigBuilder()
 *   .setBasePrice(50)
 *   .enablePresale(whitelistAddresses, startDate)
 *   .enableAntiScalping(10, 20)
 *   .build();
 */

// ============================================
// USER-FACING CONFIGURATION
// ============================================

export interface SaleConfiguration {
  // Core Settings (Required)
  basePrice: number;              // ADA
  maxSupply: number;
  tierName: string;
  
  // Feature Toggles (Optional)
  presaleEnabled?: boolean;
  antiScalpingEnabled?: boolean;
  dynamicPricingEnabled?: boolean;
  
  // Presale Configuration
  presale?: {
    whitelistAddresses: string[];
    startDate: Date;
    endDate: Date;
    maxPerWhitelisted: number;
  };
  
  // Anti-Scalping Configuration
  antiScalping?: {
    maxPerTransaction: number;     // e.g., 10 tickets per tx
    maxPerWallet: number;          // e.g., 20 tickets total
    cooldownMinutes: number;       // e.g., 5 minutes between purchases
  };
  
  // Dynamic Pricing Configuration
  dynamicPricing?: {
    type: 'early-bird' | 'demand-based' | 'tiered';
    
    // Early Bird Settings
    earlyBirdPrice?: number;       // e.g., 40 ADA (20% off)
    earlyBirdDeadline?: Date;
    
    // Demand-Based Settings
    surgeMultiplier?: number;      // e.g., 1.5 = 50% increase
    surgeThreshold?: number;       // e.g., 50 sales/hour triggers surge
    
    // Tiered Settings
    tiers?: Array<{
      minQuantity: number;         // e.g., Buy 5+
      pricePerTicket: number;      // e.g., Get 10% off
    }>;
  };
  
  // Time Window
  saleWindow?: {
    startDate: Date;
    endDate: Date;
    windowType: 'presale' | 'early-bird' | 'general' | 'last-chance';
  };
}

// ============================================
// BUILDER PATTERN (Easy Configuration)
// ============================================

export class SaleConfigBuilder {
  private config: Partial<SaleConfiguration> = {};
  
  // Core Settings
  setBasePrice(priceAda: number): this {
    this.config.basePrice = priceAda;
    return this;
  }
  
  setMaxSupply(supply: number): this {
    this.config.maxSupply = supply;
    return this;
  }
  
  setTierName(name: string): this {
    this.config.tierName = name;
    return this;
  }
  
  // Presale Feature
  enablePresale(
    whitelistAddresses: string[],
    startDate: Date,
    endDate: Date,
    maxPerWhitelisted: number = 4
  ): this {
    this.config.presaleEnabled = true;
    this.config.presale = {
      whitelistAddresses,
      startDate,
      endDate,
      maxPerWhitelisted,
    };
    return this;
  }
  
  // Anti-Scalping Feature
  enableAntiScalping(
    maxPerTransaction: number = 10,
    maxPerWallet: number = 20,
    cooldownMinutes: number = 5
  ): this {
    this.config.antiScalpingEnabled = true;
    this.config.antiScalping = {
      maxPerTransaction,
      maxPerWallet,
      cooldownMinutes,
    };
    return this;
  }
  
  // Early Bird Pricing
  enableEarlyBirdPricing(
    earlyBirdPrice: number,
    deadline: Date
  ): this {
    this.config.dynamicPricingEnabled = true;
    this.config.dynamicPricing = {
      type: 'early-bird',
      earlyBirdPrice,
      earlyBirdDeadline: deadline,
    };
    return this;
  }
  
  // Demand-Based Pricing (Surge Pricing)
  enableDemandPricing(
    surgeMultiplier: number = 1.5,
    surgeThreshold: number = 50
  ): this {
    this.config.dynamicPricingEnabled = true;
    this.config.dynamicPricing = {
      type: 'demand-based',
      surgeMultiplier,
      surgeThreshold,
    };
    return this;
  }
  
  // Tiered Pricing (Volume Discounts)
  enableTieredPricing(
    tiers: Array<{ minQuantity: number; pricePerTicket: number }>
  ): this {
    this.config.dynamicPricingEnabled = true;
    this.config.dynamicPricing = {
      type: 'tiered',
      tiers,
    };
    return this;
  }
  
  // Sale Window
  setSaleWindow(
    startDate: Date,
    endDate: Date,
    windowType: 'presale' | 'early-bird' | 'general' | 'last-chance' = 'general'
  ): this {
    this.config.saleWindow = {
      startDate,
      endDate,
      windowType,
    };
    return this;
  }
  
  // Build final configuration
  build(): SaleConfiguration {
    if (!this.config.basePrice || !this.config.maxSupply || !this.config.tierName) {
      throw new Error('Base price, max supply, and tier name are required');
    }
    return this.config as SaleConfiguration;
  }
}

// ============================================
// PRESET CONFIGURATIONS (One-Click Setup)
// ============================================

export const SALE_PRESETS = {
  /**
   * Standard Sale - Simple fixed price
   */
  standard: (price: number, supply: number, tierName: string): SaleConfiguration => {
    return new SaleConfigBuilder()
      .setBasePrice(price)
      .setMaxSupply(supply)
      .setTierName(tierName)
      .build();
  },
  
  /**
   * Presale with Whitelist - Early access for approved buyers
   */
  presale: (
    price: number,
    supply: number,
    tierName: string,
    whitelist: string[],
    startDate: Date,
    endDate: Date
  ): SaleConfiguration => {
    return new SaleConfigBuilder()
      .setBasePrice(price)
      .setMaxSupply(supply)
      .setTierName(tierName)
      .enablePresale(whitelist, startDate, endDate)
      .build();
  },
  
  /**
   * Anti-Scalper Sale - Prevents bulk buying
   */
  antiScalper: (
    price: number,
    supply: number,
    tierName: string
  ): SaleConfiguration => {
    return new SaleConfigBuilder()
      .setBasePrice(price)
      .setMaxSupply(supply)
      .setTierName(tierName)
      .enableAntiScalping(10, 20, 5)
      .build();
  },
  
  /**
   * Early Bird Sale - Discounted price for early buyers
   */
  earlyBird: (
    regularPrice: number,
    earlyPrice: number,
    supply: number,
    tierName: string,
    deadline: Date
  ): SaleConfiguration => {
    return new SaleConfigBuilder()
      .setBasePrice(regularPrice)
      .setMaxSupply(supply)
      .setTierName(tierName)
      .enableEarlyBirdPricing(earlyPrice, deadline)
      .build();
  },
  
  /**
   * Premium VIP Sale - All features enabled
   */
  vip: (
    price: number,
    supply: number,
    tierName: string,
    whitelist: string[],
    presaleStart: Date,
    presaleEnd: Date
  ): SaleConfiguration => {
    return new SaleConfigBuilder()
      .setBasePrice(price)
      .setMaxSupply(supply)
      .setTierName(tierName)
      .enablePresale(whitelist, presaleStart, presaleEnd, 2)
      .enableAntiScalping(5, 10, 10)
      .build();
  },
};

// ============================================
// USAGE EXAMPLES
// ============================================

/**
 * Example 1: Simple concert with anti-scalping
 */
export function createConcertSale() {
  return new SaleConfigBuilder()
    .setBasePrice(75)
    .setMaxSupply(500)
    .setTierName('General Admission')
    .enableAntiScalping(6, 12, 5)
    .build();
}

/**
 * Example 2: VIP presale with early bird pricing
 */
export function createVIPPresale() {
  const presaleStart = new Date('2026-02-01');
  const presaleEnd = new Date('2026-02-07');
  const earlyBirdDeadline = new Date('2026-02-14');
  
  return new SaleConfigBuilder()
    .setBasePrice(200)
    .setMaxSupply(50)
    .setTierName('VIP')
    .enablePresale(
      ['addr_test1...', 'addr_test2...'],
      presaleStart,
      presaleEnd,
      2
    )
    .enableEarlyBirdPricing(150, earlyBirdDeadline)
    .enableAntiScalping(2, 4, 15)
    .build();
}

/**
 * Example 3: Sports event with tiered pricing
 */
export function createSportsEventSale() {
  return new SaleConfigBuilder()
    .setBasePrice(100)
    .setMaxSupply(1000)
    .setTierName('Season Pass')
    .enableTieredPricing([
      { minQuantity: 5, pricePerTicket: 90 },   // 10% off for 5+
      { minQuantity: 10, pricePerTicket: 80 },  // 20% off for 10+
    ])
    .build();
}