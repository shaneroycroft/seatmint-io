import { useState, useEffect } from 'react';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_API_KEY
);

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

  // Load current settings from database
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

  // Update platform fee
  const updateFee = async (newFeePercent: number) => {
    setUpdating(true);
    setError(null);

    try {
      // TODO: Build and submit transaction to update settings on-chain
      console.log('Updating fee to:', newFeePercent);
      
      // Update database
      await supabase
        .from('platform_config')
        .update({ platform_fee_percentage: newFeePercent })
        .eq('platform_address', settings?.platformTreasury);

      await loadSettings();
      alert('✅ Platform fee updated successfully!');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update fee');
    } finally {
      setUpdating(false);
    }
  };

  // Emergency market toggle
  const toggleMarket = async () => {
    const action = settings?.isMarketActive ? 'STOP' : 'START';
    
    if (!confirm(`Are you sure you want to ${action} the market?`)) {
      return;
    }

    setUpdating(true);
    setError(null);

    try {
      const newStatus = !settings?.isMarketActive;
      
      // TODO: Build and submit transaction to toggle market on-chain
      console.log('Toggling market to:', newStatus);
      
      // Update database
      await supabase
        .from('platform_config')
        .update({ is_active: newStatus })
        .eq('platform_address', settings?.platformTreasury);

      await loadSettings();
      alert(`✅ Market ${newStatus ? 'activated' : 'stopped'} successfully!`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to toggle market');
    } finally {
      setUpdating(false);
    }
  };

  // Update supply limit
  const updateSupply = async (newSupply: number) => {
    setUpdating(true);
    setError(null);

    try {
      // TODO: Build and submit transaction
      console.log('Updating max supply to:', newSupply);
      
      await supabase
        .from('platform_config')
        .update({ max_supply: newSupply })
        .eq('platform_address', settings?.platformTreasury);

      await loadSettings();
      alert('✅ Supply limit updated successfully!');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update supply');
    } finally {
      setUpdating(false);
    }
  };

  if (loading) {
    return (
      <div style={{ padding: '40px', color: '#fff' }}>
        <p>Loading settings...</p>
      </div>
    );
  }

  if (!settings) {
    return (
      <div style={{ padding: '40px', color: '#ff6b6b' }}>
        <p>Failed to load platform settings</p>
      </div>
    );
  }

  return (
    <div style={{ padding: '40px', maxWidth: '1000px', margin: '0 auto' }}>
      <h1 style={{ color: '#fff', marginBottom: '30px' }}>⚙️ Platform Settings</h1>

      {error && (
        <div style={{
          padding: '15px',
          backgroundColor: '#4d1a1a',
          border: '1px solid #ff6b6b',
          borderRadius: '8px',
          marginBottom: '20px',
          color: '#ff6b6b'
        }}>
          {error}
        </div>
      )}

      {/* Market Status */}
      <div style={{
        backgroundColor: '#2a2a2a',
        padding: '20px',
        borderRadius: '8px',
        marginBottom: '20px',
        border: '1px solid #444'
      }}>
        <h2 style={{ color: '#fff', marginTop: 0 }}>🚦 Market Status</h2>
        
        <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
          <div style={{
            fontSize: '48px',
            color: settings.isMarketActive ? '#4CAF50' : '#ff6b6b'
          }}>
            {settings.isMarketActive ? '🟢' : '🔴'}
          </div>
          
          <div>
            <p style={{ color: '#ccc', margin: 0 }}>
              Market is currently <strong style={{ 
                color: settings.isMarketActive ? '#4CAF50' : '#ff6b6b' 
              }}>
                {settings.isMarketActive ? 'ACTIVE' : 'STOPPED'}
              </strong>
            </p>
            <p style={{ color: '#888', fontSize: '14px', margin: '5px 0 0 0' }}>
              {settings.isMarketActive 
                ? 'All ticket sales are enabled' 
                : 'All ticket sales are paused (emergency stop)'}
            </p>
          </div>
        </div>

        <button
          onClick={toggleMarket}
          disabled={updating}
          style={{
            marginTop: '15px',
            padding: '12px 24px',
            backgroundColor: settings.isMarketActive ? '#ff6b6b' : '#4CAF50',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: updating ? 'not-allowed' : 'pointer',
            fontSize: '16px',
            fontWeight: 'bold',
            opacity: updating ? 0.5 : 1
          }}
        >
          {updating ? 'Updating...' : (settings.isMarketActive ? '🛑 EMERGENCY STOP' : '▶️ START MARKET')}
        </button>
      </div>

      {/* Platform Fee */}
      <div style={{
        backgroundColor: '#2a2a2a',
        padding: '20px',
        borderRadius: '8px',
        marginBottom: '20px',
        border: '1px solid #444'
      }}>
        <h2 style={{ color: '#fff', marginTop: 0 }}>💰 Platform Fee</h2>
        
        <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
          <div style={{ flex: 1 }}>
            <p style={{ color: '#ccc', fontSize: '32px', fontWeight: 'bold', margin: 0 }}>
              {settings.platformFeePercent}%
            </p>
            <p style={{ color: '#888', fontSize: '14px', margin: '5px 0 0 0' }}>
              Current platform fee on all ticket sales
            </p>
          </div>
          
          <div style={{ flex: 1 }}>
            <label style={{ color: '#ccc', display: 'block', marginBottom: '10px' }}>
              New fee percentage:
            </label>
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
              style={{
                width: '100%',
                padding: '10px',
                backgroundColor: '#1a1a1a',
                border: '1px solid #444',
                borderRadius: '4px',
                color: '#fff',
                fontSize: '16px'
              }}
            />
            <p style={{ color: '#888', fontSize: '12px', margin: '5px 0 0 0' }}>
              Max 10% | Changes limited to 2% per update
            </p>
          </div>
        </div>
      </div>

      {/* Supply Limit */}
      <div style={{
        backgroundColor: '#2a2a2a',
        padding: '20px',
        borderRadius: '8px',
        marginBottom: '20px',
        border: '1px solid #444'
      }}>
        <h2 style={{ color: '#fff', marginTop: 0 }}>🎫 Global Supply Limit</h2>
        
        <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
          <div style={{ flex: 1 }}>
            <p style={{ color: '#ccc', fontSize: '32px', fontWeight: 'bold', margin: 0 }}>
              {settings.currentMaxSupply.toLocaleString()}
            </p>
            <p style={{ color: '#888', fontSize: '14px', margin: '5px 0 0 0' }}>
              Maximum tickets per event
            </p>
          </div>
          
          <div style={{ flex: 1 }}>
            <label style={{ color: '#ccc', display: 'block', marginBottom: '10px' }}>
              New supply limit:
            </label>
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
              style={{
                width: '100%',
                padding: '10px',
                backgroundColor: '#1a1a1a',
                border: '1px solid #444',
                borderRadius: '4px',
                color: '#fff',
                fontSize: '16px'
              }}
            />
          </div>
        </div>
      </div>

      {/* Resale Multiplier */}
      <div style={{
        backgroundColor: '#2a2a2a',
        padding: '20px',
        borderRadius: '8px',
        marginBottom: '20px',
        border: '1px solid #444'
      }}>
        <h2 style={{ color: '#fff', marginTop: 0 }}>🔄 Anti-Scalping (Resale Limit)</h2>
        
        <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
          <div style={{ flex: 1 }}>
            <p style={{ color: '#ccc', fontSize: '32px', fontWeight: 'bold', margin: 0 }}>
              {settings.maxResaleMultiplier / 100}x
            </p>
            <p style={{ color: '#888', fontSize: '14px', margin: '5px 0 0 0' }}>
              Maximum resale price multiplier
            </p>
            <p style={{ color: '#666', fontSize: '12px', margin: '5px 0 0 0' }}>
              Example: 50 ADA ticket → Max resale {(50 * settings.maxResaleMultiplier / 100).toFixed(0)} ADA
            </p>
          </div>
        </div>
      </div>

      {/* Treasury Address */}
      <div style={{
        backgroundColor: '#2a2a2a',
        padding: '20px',
        borderRadius: '8px',
        border: '1px solid #444'
      }}>
        <h2 style={{ color: '#fff', marginTop: 0 }}>🏦 Platform Treasury</h2>
        <p style={{ 
          color: '#aaa', 
          fontSize: '14px', 
          wordBreak: 'break-all',
          fontFamily: 'monospace',
          backgroundColor: '#1a1a1a',
          padding: '10px',
          borderRadius: '4px'
        }}>
          {settings.platformTreasury}
        </p>
        <p style={{ color: '#888', fontSize: '12px', margin: '10px 0 0 0' }}>
          All platform fees are sent to this address
        </p>
      </div>
    </div>
  );
};