import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

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

export const PlatformSettings: React.FC<PlatformSettingsProps> = ({ lucid: _lucid, adminAddress: _adminAddress }) => {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadSettings();
  }, []);

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
        <div className="text-slate-500">Loading settings...</div>
      </div>
    );
  }

  if (!settings) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="bg-red-50 border border-red-200 rounded-xl p-6">
          <p className="text-red-700 font-medium">Failed to load platform settings</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto bg-white">
      {/* Header */}
      <div className="p-8 border-b sticky top-0 bg-white/90 backdrop-blur-md z-10">
        <p className="text-purple-600 font-bold text-xs uppercase tracking-[0.2em] mb-1">Admin Panel</p>
        <h2 className="text-3xl font-black text-slate-900 tracking-tight">Platform Settings</h2>
      </div>

      <div className="p-8 max-w-4xl mx-auto space-y-6">
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4">
            <p className="text-red-700 font-medium">{error}</p>
          </div>
        )}

        {/* Market Status Card */}
        <div className="bg-white rounded-2xl shadow-lg border border-slate-200 p-6">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h3 className="text-lg font-bold text-slate-900">Market Status</h3>
              <p className="text-sm text-slate-500">Control the marketplace activity</p>
            </div>
            <div className={`w-4 h-4 rounded-full ${settings.isMarketActive ? 'bg-green-500' : 'bg-red-500'}`} />
          </div>

          <div className="flex items-center gap-6 mb-6">
            <div className={`text-6xl ${settings.isMarketActive ? 'text-green-500' : 'text-red-500'}`}>
              {settings.isMarketActive ? '●' : '●'}
            </div>
            <div>
              <p className={`text-2xl font-black ${settings.isMarketActive ? 'text-green-600' : 'text-red-600'}`}>
                {settings.isMarketActive ? 'ACTIVE' : 'STOPPED'}
              </p>
              <p className="text-slate-500 text-sm">
                {settings.isMarketActive
                  ? 'All ticket sales and transfers are enabled'
                  : 'All marketplace activity is paused'}
              </p>
            </div>
          </div>

          <button
            onClick={toggleMarket}
            disabled={updating}
            className={`w-full py-4 rounded-xl font-bold text-white transition-all disabled:opacity-50 ${
              settings.isMarketActive
                ? 'bg-red-500 hover:bg-red-600'
                : 'bg-green-500 hover:bg-green-600'
            }`}
          >
            {updating ? 'Updating...' : settings.isMarketActive ? 'Emergency Stop Market' : 'Activate Market'}
          </button>
        </div>

        {/* Platform Fee Card */}
        <div className="bg-white rounded-2xl shadow-lg border border-slate-200 p-6">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h3 className="text-lg font-bold text-slate-900">Platform Fee</h3>
              <p className="text-sm text-slate-500">Fee charged on all ticket sales</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-6">
            <div>
              <p className="text-sm text-slate-500 mb-2">Current Fee</p>
              <p className="text-5xl font-black text-slate-900">{settings.platformFeePercent}%</p>
            </div>

            <div>
              <label className="block text-sm text-slate-500 mb-2">Update Fee</label>
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
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p className="text-xs text-slate-400 mt-2">Max 10% | Changes limited to 2% per update</p>
            </div>
          </div>
        </div>

        {/* Supply Limit Card */}
        <div className="bg-white rounded-2xl shadow-lg border border-slate-200 p-6">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h3 className="text-lg font-bold text-slate-900">Global Supply Limit</h3>
              <p className="text-sm text-slate-500">Maximum tickets per event</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-6">
            <div>
              <p className="text-sm text-slate-500 mb-2">Current Limit</p>
              <p className="text-5xl font-black text-slate-900">{settings.currentMaxSupply.toLocaleString()}</p>
            </div>

            <div>
              <label className="block text-sm text-slate-500 mb-2">Update Limit</label>
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
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
        </div>

        {/* Resale Multiplier Card */}
        <div className="bg-white rounded-2xl shadow-lg border border-slate-200 p-6">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h3 className="text-lg font-bold text-slate-900">Anti-Scalping Limit</h3>
              <p className="text-sm text-slate-500">Maximum resale price multiplier</p>
            </div>
          </div>

          <div>
            <p className="text-sm text-slate-500 mb-2">Current Multiplier</p>
            <p className="text-5xl font-black text-slate-900">{settings.maxResaleMultiplier / 100}x</p>
            <p className="text-slate-500 text-sm mt-2">
              Example: A 50 ADA ticket can be resold for max {(50 * settings.maxResaleMultiplier / 100).toFixed(0)} ADA
            </p>
          </div>
        </div>

        {/* Treasury Card */}
        <div className="bg-white rounded-2xl shadow-lg border border-slate-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-lg font-bold text-slate-900">Platform Treasury</h3>
              <p className="text-sm text-slate-500">Address receiving platform fees</p>
            </div>
          </div>

          <div className="bg-slate-50 rounded-xl p-4">
            <p className="text-xs font-mono text-slate-700 break-all">
              {settings.platformTreasury}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
