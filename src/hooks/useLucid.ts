import { useState, useEffect } from 'react';
import { Lucid, Blockfrost, Network } from '@lucid-evolution/lucid';

// Supported Cardano wallets
export type WalletName = 'nami' | 'eternl' | 'flint' | 'lace' | 'gerowallet' | 'typhon' | 'yoroi';

// Get the return type of Lucid function (the actual instance type)
type LucidInstance = Awaited<ReturnType<typeof Lucid>>;

interface UseLucidReturn {
  lucid: LucidInstance | null;
  address: string | null;
  isConnected: boolean;
  isConnecting: boolean;
  error: string | null;
  connectWallet: (walletName: WalletName) => Promise<void>;
  disconnectWallet: () => void;
  availableWallets: WalletName[];
}

export const useLucid = (): UseLucidReturn => {
  const [lucid, setLucid] = useState<LucidInstance | null>(null);
  const [address, setAddress] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [availableWallets, setAvailableWallets] = useState<WalletName[]>([]);

  // Check which wallets are installed
  useEffect(() => {
    const checkWallets = () => {
      const wallets: WalletName[] = [];
      
      if (window.cardano?.nami) wallets.push('nami');
      if (window.cardano?.eternl) wallets.push('eternl');
      if (window.cardano?.flint) wallets.push('flint');
      if (window.cardano?.lace) wallets.push('lace');
      if (window.cardano?.gerowallet) wallets.push('gerowallet');
      if (window.cardano?.typhon) wallets.push('typhon');
      if (window.cardano?.yoroi) wallets.push('yoroi');
      
      setAvailableWallets(wallets);
    };

    // Check immediately
    checkWallets();

    // Recheck after a delay (wallets may load after page)
    const timeout = setTimeout(checkWallets, 1000);

    return () => clearTimeout(timeout);
  }, []);

  const connectWallet = async (walletName: WalletName) => {
    setIsConnecting(true);
    setError(null);

    try {
      // Check if wallet exists
      if (!window.cardano?.[walletName]) {
        throw new Error(`${walletName} wallet not found. Please install the extension.`);
      }

      // Initialize Lucid with Blockfrost
      const lucidInstance = await Lucid(
        new Blockfrost(
          `https://cardano-${import.meta.env.VITE_NETWORK.toLowerCase()}.blockfrost.io/api/v0`,
          import.meta.env.VITE_BLOCKFROST_API_KEY
        ),
        import.meta.env.VITE_NETWORK as Network
      );

      // Enable the wallet and connect
      const walletApi = await window.cardano[walletName].enable();
      lucidInstance.selectWallet.fromAPI(walletApi);

      // Get the user's address
      const userAddress = await lucidInstance.wallet().address();

      setLucid(lucidInstance);
      setAddress(userAddress);
      setIsConnected(true);

      // Store connected wallet in localStorage
      localStorage.setItem('connectedWallet', walletName);
      
      console.log(`✅ Connected to ${walletName}:`, userAddress);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred';
      setError(errorMessage);
      console.error('Wallet Connection Error:', err);
    } finally {
      setIsConnecting(false);
    }
  };

  const disconnectWallet = () => {
    setLucid(null);
    setAddress(null);
    setIsConnected(false);
    setError(null);
    localStorage.removeItem('connectedWallet');
    console.log('🔌 Wallet disconnected');
  };

  // Auto-reconnect on page load
  useEffect(() => {
    const savedWallet = localStorage.getItem('connectedWallet') as WalletName | null;
    
    if (savedWallet && availableWallets.includes(savedWallet)) {
      connectWallet(savedWallet);
    }
  }, [availableWallets]);

  return {
    lucid,
    address,
    isConnected,
    isConnecting,
    error,
    connectWallet,
    disconnectWallet,
    availableWallets,
  };
};