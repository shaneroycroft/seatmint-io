import { useState } from 'react';
import { Lucid } from '@lucid-evolution/lucid';
import { supabase } from '../lib/supabase';
import { initializePlatformSettings } from '../services/ticketService';

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

      // Step 1: Check if platform Settings NFT is already initialized
      const { data: existingPlatform, error: fetchError } = await supabase
        .from('platform_config')
        .select('settings_policy_id, settings_utxo_ref, admin_address')
        .eq('id', 'main')
        .maybeSingle();

      if (fetchError && fetchError.code !== 'PGRST116') {
        throw new Error(`Database error: ${fetchError.message}`);
      }

      let platformAddress: string;

      // Check if Settings NFT was actually minted (not just row exists)
      if (existingPlatform?.settings_policy_id && existingPlatform?.settings_utxo_ref) {
        // Platform Settings NFT already exists
        platformAddress = existingPlatform.admin_address || walletAddress;
        console.log('✅ Platform already initialized with Settings NFT');
        console.log('   Policy ID:', existingPlatform.settings_policy_id);
        console.log('   UTxO Ref:', existingPlatform.settings_utxo_ref);
      } else {
        // Step 2: Mint Settings NFT using initializePlatformSettings
        console.log('📝 Minting Settings NFT...');
        console.log('⏳ This will require signing a transaction...');

        const result = await initializePlatformSettings(lucidInstance, {
          platformFeeBps: 250,      // 2.5% platform fee
          isMarketActive: true,
          currentMaxSupply: 10000,
          maxResaleMultiplier: 300, // 3x max resale
        });

        console.log('✅ Settings NFT minted!');
        console.log('   Policy ID:', result.settingsPolicyId);
        console.log('   UTxO Ref:', result.settingsUtxoRef);
        console.log('   TX Hash:', result.txHash);

        platformAddress = walletAddress;
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