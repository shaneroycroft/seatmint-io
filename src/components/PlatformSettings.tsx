import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { burnSettingsNft, initializePlatformSettings, isSettingsInitialized, resetPlatformSettings } from '../services/ticketService';

interface PlatformSettingsProps {
  lucid: any;
  adminAddress: string;
}

interface Settings {
  platformFeePercent: number;
  platformTreasury: string;
  currentMaxSupply: number;
  maxResaleMultiplier: number;
  isMarketActive: boolean;
}

export const PlatformSettings: React.FC<PlatformSettingsProps> = ({ lucid, adminAddress: _adminAddress }) => {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [onChainInitialized, setOnChainInitialized] = useState<boolean | null>(null);
  const [reinitializing, setReinitializing] = useState(false);

  useEffect(() => {
    loadSettings();
    checkOnChainSettings();
  }, []);

  const checkOnChainSettings = async () => {
    try {
      const initialized = await isSettingsInitialized();
      setOnChainInitialized(initialized);
    } catch (err) {
      console.error('Failed to check on-chain settings:', err);
    }
  };

  const handleResetAndReinitialize = async () => {
    if (!lucid) {
      setError('Wallet not connected. Please connect your wallet first.');
      return;
    }

    // Single clear confirmation
    const confirmed = confirm(
      '⚠️ BURN & RESET SETTINGS\n\n' +
      'This will:\n' +
      '• Burn the existing Settings NFT\n' +
      '• Create a new Settings NFT\n' +
      '• Make all existing events UNUSABLE\n\n' +
      'You will need to approve 2 wallet transactions.\n\n' +
      'Continue?'
    );

    if (!confirmed) return;

    setReinitializing(true);
    setError(null);

    try {
      let burnTxHash: string | null = null;

      // Step 1: Try to burn the existing Settings NFT
      // If the UTxO is already gone (testnet reset, spent, etc.), skip burn and just reset DB
      console.log('Step 1: Attempting to burn existing Settings NFT...');
      try {
        burnTxHash = await burnSettingsNft(lucid);
        console.log('Settings NFT burned! TX:', burnTxHash);
      } catch (burnError) {
        const errorMsg = burnError instanceof Error ? burnError.message : String(burnError);
        if (errorMsg.includes('not found on chain') || errorMsg.includes('UTxO not found')) {
          console.log('Settings NFT already gone from chain (testnet reset?). Resetting database reference...');
          await resetPlatformSettings();
          console.log('Database reference cleared.');
        } else {
          // Re-throw if it's a different error
          throw burnError;
        }
      }

      // Step 2: Re-initialize on-chain with new Settings NFT
      console.log('Step 2: Creating new Settings NFT...');
      const result = await initializePlatformSettings(lucid, {
        platformFeeBps: 250,      // 2.5%
        isMarketActive: true,
        currentMaxSupply: 10000,
        maxResaleMultiplier: 300  // 3x
      });

      console.log('New settings created:', result);
      alert(
        '✅ Settings Reset Complete!\n\n' +
        (burnTxHash ? `Burn TX: ${burnTxHash}\n` : '(Old NFT was already gone from chain)\n') +
        `New Settings Policy ID: ${result.settingsPolicyId}\n\n` +
        'Remember: You must create new events - old events will not work.'
      );

      // Refresh state
      await loadSettings();
      await checkOnChainSettings();
    } catch (err) {
      console.error('Re-initialization failed:', err);
      setError(err instanceof Error ? err.message : 'Failed to re-initialize settings');
    } finally {
      setReinitializing(false);
    }
  };

  const loadSettings = async () => {
    try {
      const { data, error } = await supabase
        .from('platform_config')
        .select('*')
        .single();

      if (error) throw error;

      setSettings({
        platformFeePercent: data.platform_fee_percentage || 2.5,
        platformTreasury: data.platform_address,
        currentMaxSupply: data.max_supply || 10000,
        maxResaleMultiplier: data.max_resale_multiplier || 300,
        isMarketActive: data.is_active !== false,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load settings');
    } finally {
      setLoading(false);
    }
  };

  const updateFee = async (newFeePercent: number) => {
    setUpdating(true);
    setError(null);

    try {
      console.log('Updating fee to:', newFeePercent);

      await supabase
        .from('platform_config')
        .update({ platform_fee_percentage: newFeePercent })
        .eq('platform_address', settings?.platformTreasury);

      await loadSettings();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update fee');
    } finally {
      setUpdating(false);
    }
  };

  const toggleMarket = async () => {
    const action = settings?.isMarketActive ? 'STOP' : 'START';

    if (!confirm(`Are you sure you want to ${action} the market?`)) {
      return;
    }

    setUpdating(true);
    setError(null);

    try {
      const newStatus = !settings?.isMarketActive;
      console.log('Toggling market to:', newStatus);

      await supabase
        .from('platform_config')
        .update({ is_active: newStatus })
        .eq('platform_address', settings?.platformTreasury);

      await loadSettings();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to toggle market');
    } finally {
      setUpdating(false);
    }
  };

  const updateSupply = async (newSupply: number) => {
    setUpdating(true);
    setError(null);

    try {
      console.log('Updating max supply to:', newSupply);

      await supabase
        .from('platform_config')
        .update({ max_supply: newSupply })
        .eq('platform_address', settings?.platformTreasury);

      await loadSettings();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update supply');
    } finally {
      setUpdating(false);
    }
  };

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-warm-500">Loading settings...</div>
      </div>
    );
  }

  if (!settings) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="bg-terracotta-50 border border-terracotta-200 rounded-xl p-6">
          <p className="text-terracotta-700 font-medium">Failed to load platform settings</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto bg-white">
      {/* Header */}
      <div className="px-6 py-4 border-b sticky top-0 bg-white/90 backdrop-blur-md z-10">
        <p className="text-terracotta-600 font-semibold text-[10px] uppercase tracking-widest mb-0.5">Admin Panel</p>
        <h2 className="text-xl font-bold text-warm-900">Platform Settings</h2>
      </div>

      <div className="p-5 max-w-3xl mx-auto space-y-4">
        {error && (
          <div className="bg-terracotta-50 border border-terracotta-200 rounded-lg p-3">
            <p className="text-terracotta-700 text-sm font-medium">{error}</p>
          </div>
        )}

        {/* Market Status Card */}
        <div className="bg-white rounded-xl shadow-sm border border-warm-200 p-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="text-sm font-semibold text-warm-900">Market Status</h3>
              <p className="text-xs text-warm-500">Control the marketplace activity</p>
            </div>
            <div className={`w-3 h-3 rounded-full ${settings.isMarketActive ? 'bg-forest-500' : 'bg-terracotta-500'}`} />
          </div>

          <div className="flex items-center gap-4 mb-4">
            <div className={`text-3xl ${settings.isMarketActive ? 'text-forest-500' : 'text-terracotta-500'}`}>
              ●
            </div>
            <div>
              <p className={`text-lg font-bold ${settings.isMarketActive ? 'text-forest-600' : 'text-terracotta-600'}`}>
                {settings.isMarketActive ? 'ACTIVE' : 'STOPPED'}
              </p>
              <p className="text-warm-500 text-xs">
                {settings.isMarketActive
                  ? 'All ticket sales and transfers are enabled'
                  : 'All marketplace activity is paused'}
              </p>
            </div>
          </div>

          <button
            onClick={toggleMarket}
            disabled={updating}
            className={`w-full py-2.5 rounded-lg text-sm font-medium text-white transition-all disabled:opacity-50 ${
              settings.isMarketActive
                ? 'bg-terracotta-500 hover:bg-terracotta-600'
                : 'bg-forest-500 hover:bg-forest-600'
            }`}
          >
            {updating ? 'Updating...' : settings.isMarketActive ? 'Emergency Stop Market' : 'Activate Market'}
          </button>
        </div>

        {/* Platform Fee Card */}
        <div className="bg-white rounded-xl shadow-sm border border-warm-200 p-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="text-sm font-semibold text-warm-900">Platform Fee</h3>
              <p className="text-xs text-warm-500">Fee charged on all ticket sales</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs text-warm-500 mb-1">Current Fee</p>
              <p className="text-2xl font-bold text-warm-900">{settings.platformFeePercent}%</p>
            </div>

            <div>
              <label className="block text-xs text-warm-500 mb-1">Update Fee</label>
              <input
                type="number"
                min="0"
                max="10"
                step="0.5"
                defaultValue={settings.platformFeePercent}
                onBlur={(e) => {
                  const newFee = parseFloat(e.target.value);
                  if (newFee !== settings.platformFeePercent && newFee >= 0 && newFee <= 10) {
                    if (confirm(`Update platform fee to ${newFee}%?`)) {
                      updateFee(newFee);
                    }
                  }
                }}
                className="w-full px-3 py-2 bg-warm-50 border border-warm-200 rounded-lg text-sm text-warm-900 focus:outline-none focus:ring-2 focus:ring-forest-500"
              />
              <p className="text-[10px] text-warm-400 mt-1">Max 10%</p>
            </div>
          </div>
        </div>

        {/* Supply Limit Card */}
        <div className="bg-white rounded-xl shadow-sm border border-warm-200 p-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="text-sm font-semibold text-warm-900">Global Supply Limit</h3>
              <p className="text-xs text-warm-500">Maximum tickets per event</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs text-warm-500 mb-1">Current Limit</p>
              <p className="text-2xl font-bold text-warm-900">{settings.currentMaxSupply.toLocaleString()}</p>
            </div>

            <div>
              <label className="block text-xs text-warm-500 mb-1">Update Limit</label>
              <input
                type="number"
                min="1"
                step="100"
                defaultValue={settings.currentMaxSupply}
                onBlur={(e) => {
                  const newSupply = parseInt(e.target.value);
                  if (newSupply !== settings.currentMaxSupply && newSupply > 0) {
                    if (confirm(`Update max supply to ${newSupply.toLocaleString()} tickets?`)) {
                      updateSupply(newSupply);
                    }
                  }
                }}
                className="w-full px-3 py-2 bg-warm-50 border border-warm-200 rounded-lg text-sm text-warm-900 focus:outline-none focus:ring-2 focus:ring-forest-500"
              />
            </div>
          </div>
        </div>

        {/* Resale Multiplier Card */}
        <div className="bg-white rounded-xl shadow-sm border border-warm-200 p-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="text-sm font-semibold text-warm-900">Anti-Scalping Limit</h3>
              <p className="text-xs text-warm-500">Maximum resale price multiplier</p>
            </div>
          </div>

          <div>
            <p className="text-xs text-warm-500 mb-1">Current Multiplier</p>
            <p className="text-2xl font-bold text-warm-900">{settings.maxResaleMultiplier / 100}x</p>
            <p className="text-warm-500 text-xs mt-1">
              Example: A 50 ADA ticket can be resold for max {(50 * settings.maxResaleMultiplier / 100).toFixed(0)} ADA
            </p>
          </div>
        </div>

        {/* Treasury Card */}
        <div className="bg-white rounded-xl shadow-sm border border-warm-200 p-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="text-sm font-semibold text-warm-900">Platform Treasury</h3>
              <p className="text-xs text-warm-500">Address receiving platform fees</p>
            </div>
          </div>

          <div className="bg-warm-50 rounded-lg p-3">
            <p className="text-[10px] font-mono text-warm-700 break-all">
              {settings.platformTreasury}
            </p>
          </div>
        </div>

        {/* On-Chain Settings Card */}
        <div className="bg-white rounded-xl shadow-sm border border-sand-300 p-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="text-sm font-semibold text-warm-900">On-Chain Settings (Advanced)</h3>
              <p className="text-xs text-warm-500">Manage the on-chain GlobalSettings NFT</p>
            </div>
            <div className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
              onChainInitialized === null
                ? 'bg-warm-100 text-warm-500'
                : onChainInitialized
                  ? 'bg-forest-100 text-forest-700'
                  : 'bg-terracotta-100 text-terracotta-700'
            }`}>
              {onChainInitialized === null ? 'Checking...' : onChainInitialized ? 'Initialized' : 'Not Initialized'}
            </div>
          </div>

          <div className="bg-terracotta-50 border border-terracotta-200 rounded-lg p-3 mb-3">
            <p className="text-terracotta-800 text-xs font-semibold mb-1">Destructive Action</p>
            <ul className="text-terracotta-700 text-[11px] space-y-0.5 list-disc list-inside">
              <li>Burns the existing Settings NFT permanently</li>
              <li>Creates a new Settings NFT with a different Policy ID</li>
              <li><strong>All existing events will become unusable</strong></li>
            </ul>
          </div>

          <button
            onClick={handleResetAndReinitialize}
            disabled={reinitializing || !lucid || !onChainInitialized}
            className="w-full py-2.5 rounded-lg text-sm font-medium text-white bg-terracotta-500 hover:bg-terracotta-600 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {reinitializing ? 'Processing... (Check wallet)' : 'Burn & Reset Settings NFT'}
          </button>

          {!lucid && (
            <p className="text-center text-xs text-warm-500 mt-2">
              Connect your wallet to use this feature
            </p>
          )}
        </div>
      </div>
    </div>
  );
};
