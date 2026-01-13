import { useLucid } from "./hooks/useLucid";
import { useGenesis } from "./hooks/useGenesis";

export default function App() {
  const { 
    lucid, 
    address,
    isConnected,
    isConnecting,
    error: walletError,
    connectWallet, 
    disconnectWallet,
    availableWallets 
  } = useLucid();
  
  const { 
    isInitialized,
    isInitializing,
    platformAddress,
    error: genesisError,
    initializePlatform 
  } = useGenesis();

  const handleInitialize = async () => {
    if (lucid && address) {
      await initializePlatform(lucid, address);
    } else {
      alert('Please connect your wallet first!');
    }
  };

  return (
    <div style={{ padding: '40px', maxWidth: '800px', margin: '0 auto', fontFamily: 'system-ui', backgroundColor: '#1a1a1a', minHeight: '100vh' }}>
      <h1 style={{ color: '#fff', marginBottom: '30px' }}>🎫 Seatmint Admin</h1>
      
      <div style={{ 
        backgroundColor: '#2a2a2a', 
        padding: '20px', 
        borderRadius: '8px', 
        marginBottom: '20px',
        border: '1px solid #444'
      }}>
        <h2 style={{ color: '#fff', marginTop: 0 }}>Step 1: Connect Wallet</h2>
        
        {!isConnected ? (
          <>
            {availableWallets.length === 0 ? (
              <p style={{ color: '#ff6b6b' }}>
                ⚠️ No Cardano wallets detected. Please install a wallet extension.
              </p>
            ) : (
              <div>
                <p style={{ color: '#ccc' }}>Available wallets:</p>
                <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginTop: '10px' }}>
                  {availableWallets.map((wallet) => (
                    <button
                      key={wallet}
                      onClick={() => connectWallet(wallet)}
                      disabled={isConnecting}
                      style={{
                        padding: '10px 20px',
                        fontSize: '16px',
                        cursor: isConnecting ? 'not-allowed' : 'pointer',
                        backgroundColor: '#4CAF50',
                        color: 'white',
                        border: 'none',
                        borderRadius: '4px',
                        opacity: isConnecting ? 0.5 : 1
                      }}
                    >
                      {wallet.charAt(0).toUpperCase() + wallet.slice(1)}
                      {wallet === 'lace' && ' 🎴'}
                    </button>
                  ))}
                </div>
              </div>
            )}
            
            {isConnecting && <p style={{ color: '#ffd700' }}>⏳ Connecting...</p>}
            {walletError && <p style={{ color: '#ff6b6b' }}>❌ {walletError}</p>}
          </>
        ) : (
          <div>
            <p style={{ color: '#4CAF50', fontWeight: 'bold' }}>✅ Wallet Connected</p>
            <p style={{ fontSize: '12px', wordBreak: 'break-all', fontFamily: 'monospace', color: '#aaa', backgroundColor: '#1a1a1a', padding: '10px', borderRadius: '4px' }}>
              {address}
            </p>
            <button
              onClick={disconnectWallet}
              style={{
                marginTop: '10px',
                padding: '8px 16px',
                fontSize: '14px',
                cursor: 'pointer',
                backgroundColor: '#ff6b6b',
                color: 'white',
                border: 'none',
                borderRadius: '4px'
              }}
            >
              Disconnect
            </button>
          </div>
        )}
      </div>

      <hr style={{ margin: '30px 0', borderColor: '#444' }} />

      <div style={{ 
        backgroundColor: '#2a2a2a', 
        padding: '20px', 
        borderRadius: '8px',
        border: '1px solid #444',
        opacity: !isConnected ? 0.5 : 1
      }}>
        <h2 style={{ color: '#fff', marginTop: 0 }}>Step 2: Initialize Platform (Genesis)</h2>
        
        {!isConnected ? (
          <p style={{ color: '#999' }}>Connect your wallet first to initialize the platform.</p>
        ) : !isInitialized ? (
          <>
            <p style={{ color: '#ccc' }}>Create the genesis transaction to initialize the Seatmint platform.</p>
            <button
              onClick={handleInitialize}
              disabled={isInitializing}
              style={{
                marginTop: '10px',
                padding: '12px 24px',
                fontSize: '16px',
                cursor: isInitializing ? 'not-allowed' : 'pointer',
                backgroundColor: '#2196F3',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                opacity: isInitializing ? 0.5 : 1
              }}
            >
              {isInitializing ? '⏳ Initializing...' : '🚀 Initialize Platform'}
            </button>
            
            {genesisError && (
              <p style={{ color: '#ff6b6b', marginTop: '10px' }}>❌ {genesisError}</p>
            )}
          </>
        ) : (
          <div style={{ 
            backgroundColor: '#1a4d2e', 
            padding: '15px', 
            borderRadius: '4px',
            border: '1px solid #4CAF50'
          }}>
            <p style={{ color: '#4CAF50', fontWeight: 'bold', marginBottom: '10px' }}>
              ✅ Platform Initialized Successfully!
            </p>
            <p style={{ fontSize: '12px', wordBreak: 'break-all', fontFamily: 'monospace', color: '#a5d6a7' }}>
              Platform Address: {platformAddress}
            </p>
          </div>
        )}
      </div>

      <hr style={{ margin: '30px 0', borderColor: '#444' }} />

      <div style={{ 
        backgroundColor: '#3d2f1f', 
        padding: '15px', 
        borderRadius: '4px',
        border: '1px solid #f4a261'
      }}>
        <p style={{ margin: 0, fontSize: '14px', color: '#f4a261' }}>
          <strong>💡 Next Steps:</strong> <span style={{ color: '#e9c46a' }}>After initialization, you can start creating events and minting tickets on the Cardano blockchain.</span>
        </p>
      </div>
    </div>
  );
}