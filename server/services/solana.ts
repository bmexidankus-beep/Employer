import {
  Connection,
  PublicKey,
  Keypair,
  Transaction,
  SystemProgram,
  LAMPORTS_PER_SOL,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import bs58 from "bs58";
import type { TransactionResult } from "@shared/schema";

// Solana RPC endpoints
const MAINNET_RPC = "https://api.mainnet-beta.solana.com";
const DEVNET_RPC = "https://api.devnet.solana.com";

// Use devnet for testing, mainnet for production
const isProduction = process.env.NODE_ENV === "production";
const RPC_ENDPOINT = isProduction ? MAINNET_RPC : DEVNET_RPC;

const connection = new Connection(RPC_ENDPOINT, "confirmed");

/**
 * Get or create employer wallet from environment
 */
export function getEmployerWallet(): Keypair | null {
  const privateKey = process.env.EMPLOYER_WALLET_PRIVATE_KEY;
  if (!privateKey) {
    console.warn("EMPLOYER_WALLET_PRIVATE_KEY not set - payments will fail");
    return null;
  }

  try {
    const secretKey = bs58.decode(privateKey);
    return Keypair.fromSecretKey(secretKey);
  } catch (error) {
    console.error("Invalid employer wallet private key:", error);
    return null;
  }
}

/**
 * Get SOL balance for a wallet address
 */
export async function getBalance(walletAddress: string): Promise<number> {
  try {
    const publicKey = new PublicKey(walletAddress);
    const balance = await connection.getBalance(publicKey);
    return balance / LAMPORTS_PER_SOL;
  } catch (error) {
    console.error("Error getting balance:", error);
    return 0;
  }
}

/**
 * Validate a Solana wallet address
 */
export function isValidWalletAddress(address: string): boolean {
  try {
    new PublicKey(address);
    return true;
  } catch {
    return false;
  }
}

/**
 * Send SOL payment to a worker
 */
export async function sendPayment(
  toAddress: string,
  amountSol: number
): Promise<TransactionResult> {
  try {
    // Validate recipient address
    if (!isValidWalletAddress(toAddress)) {
      return {
        success: false,
        error: "Invalid recipient wallet address",
      };
    }

    const employerWallet = getEmployerWallet();
    if (!employerWallet) {
      return {
        success: false,
        error: "Employer wallet not configured",
      };
    }

    const toPublicKey = new PublicKey(toAddress);
    const lamports = Math.floor(amountSol * LAMPORTS_PER_SOL);

    // Check employer balance
    const balance = await connection.getBalance(employerWallet.publicKey);
    if (balance < lamports) {
      return {
        success: false,
        error: `Insufficient balance. Have ${balance / LAMPORTS_PER_SOL} SOL, need ${amountSol} SOL`,
      };
    }

    // Create and send transaction
    const transaction = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: employerWallet.publicKey,
        toPubkey: toPublicKey,
        lamports,
      })
    );

    const signature = await sendAndConfirmTransaction(connection, transaction, [
      employerWallet,
    ]);

    console.log(`Payment sent: ${amountSol} SOL to ${toAddress}, signature: ${signature}`);

    return {
      success: true,
      signature,
    };
  } catch (error) {
    console.error("Payment error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown payment error",
    };
  }
}

/**
 * Get recent transactions for a wallet
 */
export async function getRecentTransactions(
  walletAddress: string,
  limit: number = 10
): Promise<Array<{
  signature: string;
  timestamp: number | null;
  status: string;
}>> {
  try {
    const publicKey = new PublicKey(walletAddress);
    const signatures = await connection.getSignaturesForAddress(publicKey, { limit });

    return signatures.map((sig) => ({
      signature: sig.signature,
      timestamp: sig.blockTime,
      status: sig.err ? "failed" : "success",
    }));
  } catch (error) {
    console.error("Error fetching transactions:", error);
    return [];
  }
}

/**
 * Verify a transaction exists and is confirmed
 */
export async function verifyTransaction(signature: string): Promise<{
  confirmed: boolean;
  amount?: number;
  from?: string;
  to?: string;
}> {
  try {
    const tx = await connection.getTransaction(signature, {
      maxSupportedTransactionVersion: 0,
    });

    if (!tx) {
      return { confirmed: false };
    }

    // Parse transfer details from transaction
    const accountKeys = tx.transaction.message.getAccountKeys();
    const instructions = tx.transaction.message.compiledInstructions;

    // Simple SOL transfer detection
    if (instructions.length > 0) {
      const preBalances = tx.meta?.preBalances || [];
      const postBalances = tx.meta?.postBalances || [];
      
      if (preBalances.length >= 2 && postBalances.length >= 2) {
        const amount = (preBalances[0] - postBalances[0]) / LAMPORTS_PER_SOL;
        
        return {
          confirmed: true,
          amount: Math.abs(amount),
          from: accountKeys.get(0)?.toBase58(),
          to: accountKeys.get(1)?.toBase58(),
        };
      }
    }

    return { confirmed: true };
  } catch (error) {
    console.error("Error verifying transaction:", error);
    return { confirmed: false };
  }
}

/**
 * Get employer wallet public address
 */
export function getEmployerAddress(): string | null {
  const wallet = getEmployerWallet();
  return wallet ? wallet.publicKey.toBase58() : null;
}

/**
 * Get connection info
 */
export function getConnectionInfo(): {
  endpoint: string;
  network: string;
} {
  return {
    endpoint: RPC_ENDPOINT,
    network: isProduction ? "mainnet-beta" : "devnet",
  };
}
