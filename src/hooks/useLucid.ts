import { useState, useEffect, useRef, useCallback } from 'react';
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
  walletChanged: boolean;  // True when wallet was changed externally
  acknowledgeWalletChange: () => void;  // Call to reset walletChanged flag
}

export const useLucid = (): UseLucidReturn => {
  const [lucid, setLucid] = useState<LucidInstance | null>(null);
  const [address, setAddress] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [availableWallets, setAvailableWallets] = useState<WalletName[]>([]);
  const [walletChanged, setWalletChanged] = useState(false);

  // Track the current wallet API and address for change detection
  const walletApiRef = useRef<any>(null);
  const currentAddressRef = useRef<string | null>(null);
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Acknowledge wallet change (reset flag)
  const acknowledgeWalletChange = useCallback(() => {
    setWalletChanged(false);
  }, []);

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

  // Poll for wallet address changes (detects wallet switching)
  useEffect(() => {
    if (!isConnected || !walletApiRef.current) {
      // Clear polling when disconnected
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
      return;
    }

    const checkForAddressChange = async () => {
      try {
        // Get current addresses from wallet
        const addresses = await walletApiRef.current.getUsedAddresses();
        if (addresses && addresses.length > 0) {
          // Wallet API returns hex-encoded addresses, we need to compare
          // For simplicity, we'll re-query through lucid
          if (lucid) {
            const currentAddress = await lucid.wallet().address();
            if (currentAddressRef.current && currentAddress !== currentAddressRef.current) {
              console.log('🔄 Wallet change detected!');
              console.log('  Previous:', currentAddressRef.current?.slice(0, 20) + '...');
              console.log('  Current:', currentAddress.slice(0, 20) + '...');

              // Update state
              setAddress(currentAddress);
              currentAddressRef.current = currentAddress;
              setWalletChanged(true);
            }
          }
        }
      } catch (err) {
        // Wallet might have been locked or disconnected externally
        console.warn('Error checking wallet address:', err);
      }
    };

    // Poll every 2 seconds
    pollingIntervalRef.current = setInterval(checkForAddressChange, 2000);

    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
    };
  }, [isConnected, lucid]);

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

      // Store refs for change detection
      walletApiRef.current = walletApi;
      currentAddressRef.current = userAddress;

      setLucid(lucidInstance);
      setAddress(userAddress);
      setIsConnected(true);
      setWalletChanged(false);  // Reset on fresh connect

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
    walletApiRef.current = null;
    currentAddressRef.current = null;
    setLucid(null);
    setAddress(null);
    setIsConnected(false);
    setError(null);
    setWalletChanged(false);
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
    walletChanged,
    acknowledgeWalletChange,
  };
};