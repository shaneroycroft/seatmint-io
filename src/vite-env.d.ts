/// <reference types="vite/client" />
/// <reference types="vite-plugin-wasm/client" />

interface ImportMetaEnv {
  /**
   * The Blockfrost Project ID for the Cardano network.
   * Enables Lucid to communicate with the blockchain.
   */
  readonly VITE_BLOCKFROST_API_KEY: string;

  /**
   * The target network (e.g., Preview, Preprod, Mainnet).
   */
  readonly VITE_NETWORK: string;

  /**
   * Supabase Project URL for the ticketing database.
   */
  readonly VITE_SUPABASE_URL: string;

  /**
   * Supabase Anonymous Public API Key.
   */
  readonly VITE_SUPABASE_API_KEY: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// Support for Cardano wallet browser extensions
interface Window {
  cardano?: {
    nami?: any;
    eternl?: any;
    flint?: any;
    gerowallet?: any;
    typhon?: any;
    yoroi?: any;
    [key: string]: any;
  };
}