import { useState } from 'react';
import { Lucid } from '@lucid-evolution/lucid';
import { createClient } from '@supabase/supabase-js';

// Get the return type of Lucid function (the actual instance type)
type LucidInstance = Awaited<ReturnType<typeof Lucid>>;

interface GenesisState {
  isInitialized: boolean;
  isInitializing: boolean;
  platformAddress: string | null;
  error: string | null;
}

interface UseGenesisReturn extends GenesisState {
  initializePlatform: (lucidInstance: LucidInstance, walletAddress: string) => Promise<void>;
  resetGenesis: () => void;
}

// Initialize Supabase client
const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_API_KEY
);

export const useGenesis = (): UseGenesisReturn => {
  const [state, setState] = useState<GenesisState>({
    isInitialized: false,
    isInitializing: false,
    platformAddress: null,
    error: null,
  });

  const initializePlatform = async (lucidInstance: LucidInstance, walletAddress: string) => {
    setState(prev => ({ ...prev, isInitializing: true, error: null }));

    try {
      if (!lucidInstance || !walletAddress) {
        throw new Error('Lucid instance or wallet address not provided');
      }

      console.log('🚀 Initializing Seatmint Platform...');
      console.log('📍 Connected Address:', walletAddress);

      // Step 1: Check if platform is already initialized in Supabase
      const { data: existingPlatform, error: fetchError } = await supabase
        .from('platform_config')
        .select('*')
        .maybeSingle(); // Use maybeSingle() instead of single() to avoid 406 errors

      if (fetchError && fetchError.code !== 'PGRST116') {
        throw new Error(`Database error: ${fetchError.message}`);
      }

      let platformAddress: string;

      if (existingPlatform) {
        // Platform already exists
        platformAddress = existingPlatform.platform_address;
        console.log('✅ Platform already initialized:', platformAddress);
      } else {
        // Step 2: Create genesis transaction (platform initialization)
        console.log('📝 Creating genesis transaction...');

        // OPTION 1: Use your own wallet address for testing
        // This sends the genesis transaction to yourself
        const scriptAddress = walletAddress;
        
        // OPTION 2 (Later): Replace with your actual Aiken validator address
        // const scriptAddress = 'addr_test1wq...'; // Your compiled Aiken script address

        // Build genesis transaction using Lucid Evolution API
        const tx = await lucidInstance
          .newTx()
          .pay.ToAddress(scriptAddress, { lovelace: 10_000_000n }) // 10 ADA minimum
          .attachMetadata(674, {
            msg: ['Seatmint Platform Genesis'],
            platform: 'Seatmint.io',
            version: '1.0.0',
            timestamp: Date.now(),
          })
          .complete();

        const signedTx = await tx.sign.withWallet().complete();
        const txHash = await signedTx.submit();

        console.log('⏳ Genesis transaction submitted:', txHash);
        console.log('⏳ Awaiting confirmation (this may take 30-60 seconds)...');

        // Wait for confirmation with better error handling
        try {
          await lucidInstance.awaitTx(txHash, 60000); // 60 second timeout
          console.log('✅ Genesis transaction confirmed!');
        } catch (awaitError) {
          // Transaction was submitted but confirmation timed out
          // This is okay - we can still proceed
          console.warn('⚠️ Transaction confirmation timed out, but transaction was submitted');
          console.log('🔍 Check transaction status at: https://preview.cardanoscan.io/transaction/' + txHash);
        }

        // Step 3: Store platform configuration in Supabase
        const { error: insertError } = await supabase
          .from('platform_config')
          .insert({
            platform_address: scriptAddress,
            genesis_tx_hash: txHash,
            initialized_at: new Date().toISOString(),
            initialized_by: walletAddress,
            network: import.meta.env.VITE_NETWORK,
          });

        if (insertError) {
          throw new Error(`Failed to store platform config: ${insertError.message}`);
        }

        platformAddress = scriptAddress;
        console.log('💾 Platform configuration saved to database');
      }

      setState({
        isInitialized: true,
        isInitializing: false,
        platformAddress,
        error: null,
      });

      console.log('🎉 Seatmint Platform Ready!');
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred';
      setState(prev => ({
        ...prev,
        isInitializing: false,
        error: errorMessage,
      }));
      console.error('Genesis Transaction Failed:', err);
    }
  };

  const resetGenesis = () => {
    setState({
      isInitialized: false,
      isInitializing: false,
      platformAddress: null,
      error: null,
    });
  };

  return {
    ...state,
    initializePlatform,
    resetGenesis,
  };
};