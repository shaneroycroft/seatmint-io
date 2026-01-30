import React from 'react';
import { useLucid, WalletName } from '../hooks/useLucid';
import { useGenesis } from '../hooks/useGenesis';
import { BRAND } from '../constants';

const WALLET_ICONS: Record<WalletName, string> = {
  nami: '🦎',
  eternl: '♾️',
  flint: '🔥',
  lace: '🎴',
  gerowallet: '⚡',
  typhon: '🌊',
  yoroi: '🦋',
};

const WALLET_NAMES: Record<WalletName, string> = {
  nami: 'Nami',
  eternl: 'Eternl',
  flint: 'Flint',
  lace: 'Lace',
  gerowallet: 'Gero Wallet',
  typhon: 'Typhon',
  yoroi: 'Yoroi',
};

export const WalletConnect: React.FC = () => {
  const {
    lucid,
    address,
    isConnected,
    isConnecting,
    error,
    connectWallet,
    disconnectWallet,
    availableWallets,
  } = useLucid();

  const {
    isInitialized,
    isInitializing,
    platformAddress,
    error: genesisError,
    initializePlatform,
  } = useGenesis();

  const handleGenesisInit = async () => {
    if (lucid && address) {
      await initializePlatform(lucid, address);
    }
  };

  // Not connected state
  if (!isConnected) {
    return (
      <div className="max-w-md mx-auto p-6 bg-white rounded-lg shadow-lg">
        <h2 className="text-2xl font-bold mb-4 text-center text-warm-900">Connect Your Wallet</h2>

        {availableWallets.length === 0 ? (
          <div className="text-center p-6 bg-sand-50 rounded-lg">
            <p className="text-sand-800 mb-2">No Cardano wallets detected</p>
            <p className="text-sm text-sand-600">
              Please install a Cardano wallet extension to use {BRAND.name}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {availableWallets.map((walletName) => (
              <button
                key={walletName}
                onClick={() => connectWallet(walletName)}
                disabled={isConnecting}
                className="w-full flex items-center justify-between p-4 bg-forest-50 hover:bg-forest-100 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <span className="flex items-center gap-3">
                  <span className="text-2xl">{WALLET_ICONS[walletName]}</span>
                  <span className="font-medium text-warm-700">{WALLET_NAMES[walletName]}</span>
                </span>
                {isConnecting && <span className="text-sm text-warm-500">Connecting...</span>}
              </button>
            ))}
          </div>
        )}

        {error && (
          <div className="mt-4 p-3 bg-terracotta-50 border border-terracotta-200 rounded-lg">
            <p className="text-terracotta-700 text-sm">{error}</p>
          </div>
        )}
      </div>
    );
  }

  // Connected state
  return (
    <div className="max-w-2xl mx-auto p-6 bg-white rounded-lg shadow-lg">
      <div className="flex justify-between items-start mb-6">
        <div>
          <h2 className="text-2xl font-bold mb-2 text-warm-900">Wallet Connected</h2>
          <p className="text-sm text-warm-600 font-mono break-all">{address}</p>
        </div>
        <button
          onClick={disconnectWallet}
          className="px-4 py-2 bg-terracotta-500 text-white rounded-lg hover:bg-terracotta-600 transition-colors"
        >
          Disconnect
        </button>
      </div>

      {!isInitialized && (
        <div className="border-t border-warm-200 pt-6">
          <h3 className="text-xl font-bold mb-4 text-warm-900">Platform Initialization</h3>
          <p className="text-warm-600 mb-4">
            Initialize the {BRAND.name} platform to start creating and managing tickets.
          </p>
          <button
            onClick={handleGenesisInit}
            disabled={isInitializing}
            className="w-full px-6 py-3 bg-forest-600 text-white rounded-lg hover:bg-forest-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-medium"
          >
            {isInitializing ? 'Initializing...' : 'Initialize Platform'}
          </button>

          {genesisError && (
            <div className="mt-4 p-3 bg-terracotta-50 border border-terracotta-200 rounded-lg">
              <p className="text-terracotta-700 text-sm">{genesisError}</p>
            </div>
          )}
        </div>
      )}

      {isInitialized && (
        <div className="border-t border-warm-200 pt-6">
          <div className="bg-forest-50 border border-forest-200 rounded-lg p-4">
            <h3 className="font-bold text-forest-800 mb-2">Platform Ready</h3>
            <p className="text-sm text-forest-700 font-mono break-all">
              Platform Address: {platformAddress}
            </p>
          </div>
        </div>
      )}
    </div>
  );
};